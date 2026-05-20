/**
 * synthesizeNarration — calls the ElevenLabs TTS API to render the
 * lullaby lyrics in the order's chosen narrator voice, uploads the audio
 * to Supabase Storage, and returns the storage object key plus duration.
 *
 * Wired into the Inngest function as
 *   `step.run({ id: "tts", retries: 1, timeout: "30s", delay: "2s" }, …)`
 * matching design §6 and Req 9.1, 9.3 (2 attempts total, 30 s per-attempt
 * cap, 2 s pause between them).
 *
 * Failure mapping (Req 9.3, 9.4):
 *   - Empty `narrator_voice_id` → throws `GenerationFailure("missing_voice_id")`
 *     immediately, NEVER calling the API. The Inngest wrapper catches it
 *     and the outer try/catch persists the documented failure reason on
 *     `generation_jobs`. Throwing GenerationFailure (not a plain Error)
 *     means Inngest's per-step `retries: 1` won't waste an attempt either:
 *     the wrapper rethrows it as `NonRetriableError` upstream.
 *   - Any API error / non-2xx / fetch throw → plain Error so the
 *     Inngest step retries once. After the second failure the wrapper
 *     maps to `GenerationFailure("tts_api_error")`.
 *
 * Output-format note (Req 9.2):
 *   The design wording calls the artifact a "WAV" but the mix step
 *   (Task 17) re-encodes everything via libmp3lame anyway. We request
 *   mp3 from ElevenLabs (constant-bitrate 128 kbps) because it transports
 *   faster and gives us a reliable duration estimate from the response
 *   byte size. The file is stored as `narration/{order_id}.mp3` and the
 *   key is recorded on `generation_jobs.narration_object_key`.
 */
import {
  ELEVENLABS_API_BASE,
  ELEVENLABS_DEFAULT_TTS_MODEL_ID,
  ELEVENLABS_TTS_OUTPUT_BITRATE_KBPS,
  ELEVENLABS_TTS_OUTPUT_CONTENT_TYPE,
  ELEVENLABS_TTS_OUTPUT_FORMAT,
} from "@/lib/elevenlabs";
import { getServerEnv } from "@/lib/env";
import { GenerationFailure } from "@/lib/gen/failure";
import type { LoadedOrder } from "@/lib/gen/loadOrder";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Per-attempt fetch timeout. Slightly under the Inngest 30 s step timeout
 * so the abort surfaces from inside `synthesizeNarration` as a regular
 * Error and Inngest's retry logic kicks in on the same attempt rather
 * than after the step itself times out.
 */
const TTS_FETCH_TIMEOUT_MS = 28_000;

/** Voice settings — gentle, low-variance defaults appropriate for a lullaby. */
const TTS_VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.75,
} as const;

export interface NarrationResult {
  /** Supabase Storage object key inside the `lullabies` bucket. */
  object_key: string;
  /** Estimated duration of the rendered audio in seconds. */
  duration_seconds: number;
}

/**
 * Estimate duration from a constant-bitrate mp3's byte length.
 *
 * `bytes / (kbps * 1000 / 8) = seconds`. Constant-bitrate mp3 has a small
 * frame-alignment overhead (≤2 %), good enough for the music-step's
 * `target_seconds` parameter (Task 16) and the mix-step's narration-length
 * truncation (Task 17). Both downstream callers re-derive duration from
 * ffprobe before persisting to the asset row.
 */
export function estimateMp3DurationSeconds(
  byteLength: number,
  bitrateKbps: number = ELEVENLABS_TTS_OUTPUT_BITRATE_KBPS,
): number {
  if (byteLength <= 0 || bitrateKbps <= 0) return 0;
  const bytesPerSecond = (bitrateKbps * 1000) / 8;
  return byteLength / bytesPerSecond;
}

/**
 * Render `lyrics` in `order.narrator_voice_id` and upload the resulting mp3
 * to Supabase Storage at `narration/{order_id}.mp3`.
 *
 * Throws `GenerationFailure("missing_voice_id")` when the order has no
 * voice id (Req 9.4). Throws a plain Error on API / network / upload
 * failure so the Inngest step's per-attempt retry runs once.
 */
export async function synthesizeNarration(
  order: LoadedOrder,
  lyrics: string,
): Promise<NarrationResult> {
  const voiceId = order.narrator_voice_id?.trim() ?? "";
  if (voiceId.length === 0) {
    // Req 9.4 — never call the API when we have no voice. GenerationFailure
    // is the upstream signal so the outer wrapper persists the right reason.
    throw new GenerationFailure("missing_voice_id");
  }

  const env = getServerEnv();

  const url = `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(
    voiceId,
  )}?output_format=${ELEVENLABS_TTS_OUTPUT_FORMAT}`;

  const body = JSON.stringify({
    text: lyrics,
    model_id: ELEVENLABS_DEFAULT_TTS_MODEL_ID,
    voice_settings: TTS_VOICE_SETTINGS,
  });

  // Per-attempt 28 s wall-clock guard. AbortController is the portable
  // way to honour Req 9.1 ("per-attempt timeout of 30 seconds") even when
  // the underlying fetch is slow to fail.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        Accept: ELEVENLABS_TTS_OUTPUT_CONTENT_TYPE,
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Distinguish abort from other network errors only for the message —
    // both map to a retriable plain Error so the Inngest step retries.
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));
    throw new Error(
      isAbort ? "tts_request_timeout" : "tts_request_failed",
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Drain the body so the connection releases cleanly. We don't
    // surface the upstream error message — it can include the API key
    // or other non-PII details we'd rather not log unguarded.
    try {
      await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(`tts_http_${response.status}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.byteLength === 0) {
    throw new Error("tts_empty_audio");
  }

  const objectKey = `narration/${order.id}.mp3`;

  const supabase = getSupabaseAdmin();
  const { error: uploadError } = await supabase.storage
    .from(env.SUPABASE_BUCKET_LULLABIES)
    .upload(objectKey, audioBuffer, {
      contentType: ELEVENLABS_TTS_OUTPUT_CONTENT_TYPE,
      // Allow re-uploads for Inngest retries — the step result is
      // memoized at the Inngest layer (Req 19.3) but the underlying
      // upload may need to overwrite a partial bytes-on-disk artefact.
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`tts_upload_failed: ${uploadError.message}`);
  }

  return {
    object_key: objectKey,
    duration_seconds: estimateMp3DurationSeconds(audioBuffer.byteLength),
  };
}
