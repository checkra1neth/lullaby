/**
 * requestBackgroundMusic — calls the ElevenLabs Music API to generate a
 * background music track sized to the narration, uploads the result to
 * Supabase Storage, and returns the storage object key plus duration.
 *
 * Wired into the Inngest function as
 *   `step.run({ id: "music", retries: 0, timeout: "120s" }, …)`
 * matching design §6 and Req 10. With `retries: 0` a single failure is
 * final, so we set the per-fetch wall-clock guard to ~115 s — under the
 * 120 s step ceiling so the AbortController surfaces the timeout from
 * inside `requestBackgroundMusic` rather than letting Inngest cancel the
 * step (Req 10.4).
 *
 * Failure mapping (Req 10.4, 10.5):
 *   - Music duration < narration duration → throws
 *     `GenerationFailure("insufficient_music_duration")`. The DB-enum
 *     reason persists on `generation_jobs.failure_reason`. We do NOT
 *     upload the under-length track — partial state on a failed job is
 *     a footgun the spec calls out across §6 for every step.
 *   - Any API error / non-2xx / fetch throw / empty body / upload error
 *     → throws a plain `Error`. The Inngest wrapper in `generateLullaby`
 *     catches it and re-throws as
 *     `GenerationFailure("music_generation_failed")` so the documented
 *     enum reason lands on the row.
 *
 * Output-format choice (mirrors `lib/gen/narration.ts`):
 *   We request mp3 at 44.1 kHz / 128 kbps so the byte-rate→duration
 *   estimate (`bytes / 16000 ≈ seconds`) is reliable. The mix step
 *   (Task 17) re-encodes via libmp3lame anyway, so the on-disk format
 *   here doesn't constrain the final asset. The file is stored at
 *   `music/{order_id}.mp3` and the key is recorded on
 *   `generation_jobs.music_object_key`.
 */
import {
  ELEVENLABS_API_BASE,
  ELEVENLABS_DEFAULT_MUSIC_MODEL_ID,
  ELEVENLABS_MUSIC_OUTPUT_BITRATE_KBPS,
  ELEVENLABS_MUSIC_OUTPUT_CONTENT_TYPE,
  ELEVENLABS_MUSIC_OUTPUT_FORMAT,
  ELEVENLABS_MUSIC_PATH,
} from "@/lib/elevenlabs";
import { getServerEnv } from "@/lib/env";
import { GenerationFailure } from "@/lib/gen/failure";

/**
 * Per-attempt fetch timeout. Slightly under the Inngest 120 s step timeout
 * so the abort surfaces from inside `requestBackgroundMusic` as a regular
 * Error and the wrapper translates it to
 * `GenerationFailure("music_generation_failed")` rather than letting the
 * step itself time out.
 */
const MUSIC_FETCH_TIMEOUT_MS = 115_000;

/**
 * The Music API accepts `music_length_ms` between 3,000 and 600,000
 * (skills/music/references/api_reference.md). 600k is irrelevant for our
 * domain (narration always runs 150–360 s, design §6 mix budget) but we
 * still clamp to a 5-minute hard ceiling here as a defense-in-depth guard
 * — the upstream rejection would just become a `music_generation_failed`
 * with less context.
 */
const MUSIC_LENGTH_MAX_MS = 300_000;

/**
 * The model is asked to produce slightly more music than we strictly need
 * so the duration check (`track ≥ narration`, Req 10.3) is comfortable.
 * The mix step truncates to narration length via `amix=duration=first`
 * (design §7 mixing graph), so headroom doesn't extend the final mp3.
 */
const MUSIC_TARGET_HEADROOM_SECONDS = 5;

/** Estimate constant-bitrate mp3 duration from byte length. */
function estimateMp3DurationSeconds(byteLength: number): number {
  if (byteLength <= 0) return 0;
  const bytesPerSecond = (ELEVENLABS_MUSIC_OUTPUT_BITRATE_KBPS * 1000) / 8;
  return byteLength / bytesPerSecond;
}

/**
 * Build the music-generation prompt. Anchored to the chosen mood label so
 * Req 10.1 ("a prompt that includes the chosen mood label") holds, and
 * tuned for a lullaby aesthetic (instrumental, slow, soft, peaceful) so
 * the track underlays the narration without drawing attention.
 *
 * The `target_seconds` value is included as natural-language context.
 * The actual duration is set via `music_length_ms` in the request body —
 * the model's primary length signal — but anchoring the prompt to the
 * same number nudges the composition envelope toward that length.
 */
function buildMusicPrompt(
  mood: "calm" | "playful" | "dreamy",
  targetSeconds: number,
): string {
  const moodDescriptors: Record<typeof mood, string> = {
    calm: "soft and reassuring, gentle piano with warm pads",
    playful: "tender and whimsical, light music-box and soft bells",
    dreamy: "ethereal and floating, slow strings and airy synth pads",
  };
  const descriptor = moodDescriptors[mood];
  // Round target seconds to whole seconds for the prompt so the LLM-style
  // model sees a clean duration hint rather than `186.4`.
  const targetWhole = Math.max(1, Math.round(targetSeconds));
  return [
    `An instrumental ${mood} lullaby underscore, ${descriptor}.`,
    "Soothing, very slow tempo, no vocals, no percussion hits, no lyrics.",
    "Soft bedtime atmosphere — moonlight, stars, drifting to sleep.",
    `Aim for around ${targetWhole} seconds of music with no abrupt endings.`,
  ].join(" ");
}

export interface MusicOptions {
  /** Order id, used to derive the upload object key. */
  orderId: string;
  /** Mood label from the form (Req 2.1). Anchors the music prompt. */
  mood: "calm" | "playful" | "dreamy";
  /** Lower bound (Req 10.3) — narration duration in seconds. */
  target_seconds: number;
  /** Upper bound (Req 10.3) — `target_seconds + 30`. */
  max_seconds: number;
}

export interface MusicResult {
  /** Supabase Storage object key inside the `lullabies` bucket. */
  object_key: string;
  /** Estimated duration of the rendered audio in seconds. */
  duration_seconds: number;
}

/**
 * Compute the `music_length_ms` request parameter. Biases slightly above
 * the lower bound so the duration gate (Req 10.3) is comfortable, then
 * clamps to `max_seconds` (Req 10.3 upper bound) and the API's 5-minute
 * hard ceiling.
 */
function computeMusicLengthMs(
  targetSeconds: number,
  maxSeconds: number,
): number {
  const targetMs = (targetSeconds + MUSIC_TARGET_HEADROOM_SECONDS) * 1000;
  const upperBoundMs = maxSeconds * 1000;
  return Math.min(
    Math.round(targetMs),
    Math.round(upperBoundMs),
    MUSIC_LENGTH_MAX_MS,
  );
}

/**
 * Lazy supabase admin import so the module stays test-friendly:
 * `vi.mock("@/lib/supabase/admin", …)` in the unit test runs before this
 * dynamic import resolves.
 */
async function getStorageUploader(): Promise<
  (bucket: string, key: string, bytes: Buffer) => Promise<void>
> {
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
  return async (bucket, key, bytes) => {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(key, bytes, {
        contentType: ELEVENLABS_MUSIC_OUTPUT_CONTENT_TYPE,
        // Allow re-uploads — Inngest memoizes step results so a function
        // retry of `generateLullaby` skips this step entirely (Req 19.3),
        // but a same-step retry from a transient upload glitch needs to
        // overwrite a partial object.
        upsert: true,
      });
    if (error) {
      throw new Error(`music_upload_failed: ${error.message}`);
    }
  };
}

/**
 * Generate a mood-anchored background music track sized to the narration
 * and upload it to Supabase Storage. Throws
 * `GenerationFailure("insufficient_music_duration")` when the produced
 * track is shorter than `target_seconds` (Req 10.5). Throws a plain Error
 * on any other failure mode so the Inngest wrapper translates it to
 * `GenerationFailure("music_generation_failed")` (Req 10.4).
 */
export async function requestBackgroundMusic(
  opts: MusicOptions,
): Promise<MusicResult> {
  const env = getServerEnv();

  const musicLengthMs = computeMusicLengthMs(
    opts.target_seconds,
    opts.max_seconds,
  );

  const url = `${ELEVENLABS_API_BASE}${ELEVENLABS_MUSIC_PATH}?output_format=${ELEVENLABS_MUSIC_OUTPUT_FORMAT}`;

  const body = JSON.stringify({
    prompt: buildMusicPrompt(opts.mood, opts.target_seconds),
    music_length_ms: musicLengthMs,
    model_id: ELEVENLABS_DEFAULT_MUSIC_MODEL_ID,
    // Lullabies must NEVER include vocals — `force_instrumental` is the
    // upstream guardrail. (api_reference.md, `compose`.)
    force_instrumental: true,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MUSIC_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        Accept: ELEVENLABS_MUSIC_OUTPUT_CONTENT_TYPE,
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));
    throw new Error(
      isAbort ? "music_request_timeout" : "music_request_failed",
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Drain the body so the connection releases cleanly; we don't surface
    // the upstream error message — same reasoning as the TTS path.
    try {
      await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(`music_http_${response.status}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.byteLength === 0) {
    throw new Error("music_empty_audio");
  }

  const durationSeconds = estimateMp3DurationSeconds(audioBuffer.byteLength);

  // Req 10.3 / 10.5: the produced track must be at least as long as the
  // narration. We do NOT upload the under-length track — the partial-state
  // ban applies to every step (design §6). The wrapper sees the typed
  // failure and persists `insufficient_music_duration` on the row.
  if (durationSeconds < opts.target_seconds) {
    throw new GenerationFailure("insufficient_music_duration");
  }

  const objectKey = `music/${opts.orderId}.mp3`;
  const upload = await getStorageUploader();
  await upload(env.SUPABASE_BUCKET_LULLABIES, objectKey, audioBuffer);

  return {
    object_key: objectKey,
    duration_seconds: durationSeconds,
  };
}

// Exposed for unit tests so they can assert the prompt-construction logic
// independently of the network path.
export const __internal = {
  buildMusicPrompt,
  computeMusicLengthMs,
  estimateMp3DurationSeconds,
};
