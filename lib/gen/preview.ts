/**
 * generatePreview — calls ElevenLabs TTS to produce a short personalized
 * "Goodnight, {child_name}" clip using the chosen voice.
 *
 * Returns `{ audio_base64, duration_s }` where `duration_s ∈ [5, 12]`.
 *
 * Design ref: §3.2 API Surface – Preview, §3.1 Generator_Service
 * Req: 3.1, 3.2, 3.3, 3.5
 *
 * The script is a templated ~8-second lullaby intro that always includes
 * the child's name. We keep it short and warm so the parent hears the
 * voice quality + personalization before paying.
 */
import {
  ELEVENLABS_API_BASE,
  ELEVENLABS_DEFAULT_TTS_MODEL_ID,
  ELEVENLABS_TTS_OUTPUT_BITRATE_KBPS,
  ELEVENLABS_TTS_OUTPUT_CONTENT_TYPE,
  ELEVENLABS_TTS_OUTPUT_FORMAT,
} from "@/lib/elevenlabs";
import { getServerEnv } from "@/lib/env";

/** Per-request timeout for the preview TTS call (Req 3.5: 15 seconds). */
const PREVIEW_FETCH_TIMEOUT_MS = 15_000;

/** Voice settings — gentle, warm defaults for a lullaby preview. */
const PREVIEW_VOICE_SETTINGS = {
  stability: 0.6,
  similarity_boost: 0.75,
} as const;

export interface PreviewResult {
  /** Base64-encoded audio bytes (mp3). */
  audio_base64: string;
  /** Duration of the preview clip in seconds (5–12). */
  duration_s: number;
}

/**
 * Build the short preview script that includes the child's name.
 * Req 3.3: the Preview_Clip script SHALL include the child's name.
 */
function buildPreviewScript(childName: string): string {
  return (
    `Goodnight, ${childName}. ` +
    `Close your eyes and drift away, ${childName}. ` +
    `The stars are shining just for you tonight. ` +
    `Sweet dreams, little one.`
  );
}

/**
 * Generate a personalized preview clip via ElevenLabs TTS.
 *
 * @param childName - The child's name (already validated/trimmed by the route)
 * @param voiceId - The ElevenLabs voice id to use
 * @returns PreviewResult with base64 audio and duration
 * @throws Error on API failure, timeout, or empty response
 */
export async function generatePreview(
  childName: string,
  voiceId: string,
): Promise<PreviewResult> {
  const env = getServerEnv();
  const script = buildPreviewScript(childName);

  const url = `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(
    voiceId,
  )}?output_format=${ELEVENLABS_TTS_OUTPUT_FORMAT}`;

  const body = JSON.stringify({
    text: script,
    model_id: ELEVENLABS_DEFAULT_TTS_MODEL_ID,
    voice_settings: PREVIEW_VOICE_SETTINGS,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_FETCH_TIMEOUT_MS);

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
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));
    if (isAbort) {
      throw new Error("preview_timeout");
    }
    throw new Error("preview_request_failed");
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Drain body to release the connection.
    try {
      await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(`preview_upstream_error_${response.status}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.byteLength === 0) {
    throw new Error("preview_empty_audio");
  }

  // Estimate duration from constant-bitrate mp3 byte size.
  const bytesPerSecond = (ELEVENLABS_TTS_OUTPUT_BITRATE_KBPS * 1000) / 8;
  const estimatedDuration = audioBuffer.byteLength / bytesPerSecond;

  // Clamp to [5, 12] per Req 3.2. In practice the script is calibrated to
  // land around 8 seconds, but we clamp the reported value defensively.
  const duration_s = Math.max(5, Math.min(12, Math.round(estimatedDuration)));

  const audio_base64 = audioBuffer.toString("base64");

  return { audio_base64, duration_s };
}
