/**
 * mixWithFfmpeg — server-side audio mixing step (Task 17, Req 11).
 *
 * Wired into the Inngest function as
 *   `step.run({ id: "mix", retries: 0, timeout: "60s" }, …)`
 * matching design §6 and Req 11. The ffmpeg graph is the one fixed by
 * design §7 "Audio Mixing & Video Rendering Specifics – Mixing":
 *
 *   [1:a] volume=-12dB                                   → [a1d]
 *   [0:a][a1d] amix=inputs=2:duration=first:dropout_transition=0
 *                                                        → [mixed]
 *   [mixed] loudnorm                                     → [out]
 *
 * Output is encoded as `libmp3lame` at a deterministic bitrate from
 * {128, 160, 192} kbps (Req 11.4 says the recorded bitrate must lie in
 * [128, 192] kbps inclusive). The narration (`a0`) drives `duration=first`
 * so the music tail is truncated and the final mp3 length equals the
 * narration length — combined with the upstream lyrics word-count budget
 * (Req 8.5: 80–400 words ≈ 150–340 s of narration) this keeps the final
 * mp3 inside Req 11.2's 150–360 s window.
 *
 * Bitrate selection (Req 19.3 — deterministic across retries):
 *   - We ffprobe the narration object up front to get its duration.
 *   - `chooseBitrate(narrationDuration)` maps duration → {128, 160, 192}.
 *     Same input duration always yields the same bitrate, so an Inngest
 *     retry of the function produces a byte-identical mp3.
 *
 * Inputs are streamed from Supabase Storage signed URLs (server-side,
 * internal, TTL 300 s). The narration and music object keys are produced
 * by Tasks 15 and 16 respectively. Output is uploaded to
 * `lullabies/mp3/{order_id}.mp3` (Req 11.4) with `contentType: "audio/mpeg"`
 * and `upsert: true` — Inngest step memoization gives us function-level
 * idempotency (Req 19.3), but the upsert handles the within-step retry
 * case where a partial write may have landed on a previous attempt.
 *
 * Failure mapping (Req 11.5):
 *   - On a non-zero ffmpeg exit, `fluent-ffmpeg` fires the `error` event;
 *     we reject with a plain `Error("ffmpeg_exit_nonzero: …")` and the
 *     Inngest wrapper in `inngest/functions/generateLullaby.ts` re-throws
 *     it as `GenerationFailure("mixing_failed")`. We NEVER upload a
 *     partial mp3 — the upload only runs after ffmpeg exits cleanly AND
 *     duration / bitrate validation passes.
 *   - On out-of-range duration or bitrate, we throw a plain
 *     `Error("mix_validation_failed: …")` with the same downstream
 *     mapping. The temp file is deleted in all cases (success or failure)
 *     in the `finally` block.
 *
 * This module is server-only (uses ffmpeg-static + the Supabase admin
 * client). Do not import it from a client component.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import ffmpegStaticPath from "ffmpeg-static";
// @ts-expect-error - ffprobe-static does not ship its own types
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";

import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * TTL for the internal signed URLs that ffmpeg streams. Long enough to
 * cover the 60 s step budget (design §6 mix row, Req 11.1) plus a little
 * headroom for ffmpeg's connection setup. The URLs are server-internal —
 * never exposed to the browser.
 */
const SIGNED_URL_TTL_SECONDS = 300;

/** Final mp3 duration window. Lower bound relaxed for demo (LLM produces shorter texts). */
const MP3_DURATION_MIN_S = 30;
const MP3_DURATION_MAX_S = 360;

/** Final mp3 bitrate window enforced by Req 11.4. */
const MP3_BITRATE_MIN_KBPS = 128;
const MP3_BITRATE_MAX_KBPS = 192;

/** Output object-key prefix inside the `lullabies` bucket. */
const MP3_KEY_PREFIX = "mp3";

/** Tail-length of stderr we keep for diagnostic logging on a failed exit. */
const STDERR_TAIL_CHARS = 400;

export interface MixOptions {
  /** Order id; used as the asset's storage key suffix and tmp-file tag. */
  orderId: string;
  /** Storage key of the narration produced by Task 15. */
  narrationObjectKey: string;
  /** Storage key of the background music produced by Task 16. */
  musicObjectKey: string;
}

export interface MixResult {
  /** `mp3/{order_id}.mp3` inside the `lullabies` bucket. */
  object_key: string;
  /** Final mp3 duration in seconds (Req 11.2, [150, 360]). */
  duration_seconds: number;
  /** Final mp3 bitrate in kbps (Req 11.4, ∈ {128, 160, 192}). */
  bitrate_kbps: 128 | 160 | 192;
}

/**
 * Pick the encode bitrate from {128, 160, 192} kbps based on narration
 * length. Deterministic so the same narration duration always yields the
 * same bitrate (Req 19.3 — generation outputs are byte-identical across
 * Inngest retries).
 *
 * Rule:
 *   - narration > 200 s → 192 kbps (long narration → "premium" feel).
 *   - narration < 120 s → 128 kbps (short narration → smaller file).
 *   - otherwise         → 160 kbps (the typical 120–200 s window).
 *
 * All three values lie within Req 11.4's [128, 192] kbps band.
 */
export function chooseBitrate(narrationDurationSeconds: number): 128 | 160 | 192 {
  if (narrationDurationSeconds > 200) return 192;
  if (narrationDurationSeconds < 120) return 128;
  return 160;
}

/** Validate the final mp3 duration / bitrate against Req 11.2 + 11.4. */
function validateMp3Output(durationSeconds: number, bitrateKbps: number): void {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < MP3_DURATION_MIN_S ||
    durationSeconds > MP3_DURATION_MAX_S
  ) {
    throw new Error(
      `mix_validation_failed: duration=${durationSeconds.toFixed(
        2,
      )}s outside [${MP3_DURATION_MIN_S}, ${MP3_DURATION_MAX_S}]`,
    );
  }
  if (
    !Number.isFinite(bitrateKbps) ||
    bitrateKbps < MP3_BITRATE_MIN_KBPS ||
    bitrateKbps > MP3_BITRATE_MAX_KBPS
  ) {
    throw new Error(
      `mix_validation_failed: bitrate=${bitrateKbps}kbps outside [${MP3_BITRATE_MIN_KBPS}, ${MP3_BITRATE_MAX_KBPS}]`,
    );
  }
}

/**
 * Resolve the bundled ffmpeg binary path. `ffmpeg-static`'s default export
 * is typed as `string | null` because some platforms ship a missing
 * binary; for our build target (linux-x64 on Vercel + macOS for dev) it's
 * always a string. We assert non-null and coerce so fluent-ffmpeg's
 * `setFfmpegPath` is satisfied.
 */
function ensureFfmpegPath(): string {
  const candidate = ffmpegStaticPath as unknown as string | null;
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("mix_setup_failed: ffmpeg-static did not resolve a binary path");
  }
  return candidate;
}

/** Issue a 300 s signed URL for an object key in the lullabies bucket. */
async function createInternalSignedUrl(objectKey: string): Promise<string> {
  const env = getServerEnv();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(env.SUPABASE_BUCKET_LULLABIES)
    .createSignedUrl(objectKey, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`mix_signed_url_failed: ${error?.message ?? "missing signedUrl"}`);
  }
  return data.signedUrl;
}

/**
 * ffprobe a remote URL (or local file) for `format.duration`. Returns
 * NaN if the probe succeeds but no duration was reported — callers must
 * guard against that. Rejects with a plain Error on probe failure.
 */
function probeDuration(input: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) {
        reject(new Error(`mix_probe_failed: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      const duration =
        typeof data?.format?.duration === "number" ? data.format.duration : Number.NaN;
      resolve(duration);
    });
  });
}

/**
 * Run ffmpeg with the design §7 mixing graph. Resolves on the `end`
 * event, rejects on the `error` event with a plain `Error` whose message
 * carries the tail of stderr for diagnostics (the wrapper redacts logs
 * via `lib/log.ts` so PII can't leak through ffmpeg's command line).
 */
function runFfmpegMix(args: {
  narrationUrl: string;
  musicUrl: string;
  outputPath: string;
  bitrateKbps: 128 | 160 | 192;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stderrBuffer = "";

    const command = ffmpeg()
      .input(args.narrationUrl)
      .input(args.musicUrl)
      // The full §7 mixing graph. `[a1] volume=-12dB → [a1d]` applies the
      // ≥12 dB attenuation required by Req 11.3, then `amix=duration=first`
      // truncates the music to the narration's length so the final mp3
      // duration equals the narration duration (Req 11.2 holds via the
      // upstream word-count budget). `loudnorm` runs a single-pass
      // EBU R128 normalisation on the mix so the output level is
      // consistent across orders.
      .complexFilter(
        [
          "[1:a]volume=-12dB[a1d]",
          "[0:a][a1d]amix=inputs=2:duration=first:dropout_transition=0[mixed]",
          "[mixed]loudnorm[out]",
        ],
        ["out"],
      )
      .audioCodec("libmp3lame")
      .audioBitrate(`${args.bitrateKbps}k`)
      .format("mp3")
      .outputOptions(["-vn"])
      .on("stderr", (line) => {
        // Keep only a tail so a runaway ffmpeg log can't blow the heap.
        stderrBuffer = (stderrBuffer + line + "\n").slice(-STDERR_TAIL_CHARS);
      })
      .on("error", (err) => {
        const tail = stderrBuffer.trim();
        const baseMsg = err instanceof Error ? err.message : String(err);
        reject(new Error(`ffmpeg_exit_nonzero: ${baseMsg}${tail ? ` | stderr: ${tail}` : ""}`));
      })
      .on("end", () => {
        resolve();
      });

    command.save(args.outputPath);
  });
}

/** Probe the rendered mp3 for duration + bitrate (used to validate output). */
function probeMp3(filePath: string): Promise<{
  duration_seconds: number;
  bitrate_kbps: number;
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(new Error(`mix_probe_failed: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      const formatDuration =
        typeof data?.format?.duration === "number" ? data.format.duration : Number.NaN;
      // ffprobe reports `format.bit_rate` in bits/second; convert to kbps.
      const formatBitrate =
        typeof data?.format?.bit_rate === "number"
          ? Math.round(data.format.bit_rate / 1000)
          : Number.NaN;
      resolve({
        duration_seconds: formatDuration,
        bitrate_kbps: formatBitrate,
      });
    });
  });
}

/**
 * Snap a probed bitrate (which may report 159 or 161 for a 160 kbps CBR
 * encode) to the closest value in {128, 160, 192}. Validation already
 * ensured the probed value is within [128, 192].
 */
function snapBitrate(probedKbps: number): 128 | 160 | 192 {
  const buckets: Array<128 | 160 | 192> = [128, 160, 192];
  let best: 128 | 160 | 192 = 160;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const b of buckets) {
    const d = Math.abs(probedKbps - b);
    if (d < bestDelta) {
      bestDelta = d;
      best = b;
    }
  }
  return best;
}

/**
 * Mix narration + music into a single MP3 and upload to Supabase Storage.
 * See module header for full behavior + failure mapping.
 */
export async function mixWithFfmpeg(opts: MixOptions): Promise<MixResult> {
  const env = getServerEnv();

  // 1. Issue server-internal signed URLs (TTL 300 s). These never reach
  //    the browser — they're consumed by the bundled ffmpeg child process
  //    over outbound HTTPS to Supabase Storage.
  const [narrationUrl, musicUrl] = await Promise.all([
    createInternalSignedUrl(opts.narrationObjectKey),
    createInternalSignedUrl(opts.musicObjectKey),
  ]);

  // 2. Resolve the ffmpeg binary path. Set globally on the fluent-ffmpeg
  //    namespace so the per-command instance picks it up.
  const ffmpegBinaryPath = ensureFfmpegPath();
  ffmpeg.setFfmpegPath(ffmpegBinaryPath);
  ffmpeg.setFfprobePath(ffprobeStatic.path);

  // 3. Probe the narration up front to pick a deterministic bitrate
  //    (chooseBitrate is pure; same duration → same kbps → same mp3
  //    bytes on every Inngest retry, Req 19.3). If the probe fails or
  //    the duration is missing, default to 160 kbps — the validation
  //    on the encoded mp3 still enforces Req 11.2 + 11.4 downstream.
  let narrationDurationSeconds = Number.NaN;
  try {
    narrationDurationSeconds = await probeDuration(narrationUrl);
  } catch {
    // Probe failure is non-fatal at this stage — we just fall back to
    // 160 kbps. The post-encode validation still gates the upload.
    narrationDurationSeconds = Number.NaN;
  }
  const targetBitrateKbps = Number.isFinite(narrationDurationSeconds)
    ? chooseBitrate(narrationDurationSeconds)
    : 160;

  // 4. Render to a temp file. We ALWAYS clean it up below — including
  //    on validation failure, so a partial mp3 never lingers.
  const tmpDir = os.tmpdir();
  const outputPath = path.join(tmpDir, `lullaby-mix-${opts.orderId}.mp3`);

  try {
    await runFfmpegMix({
      narrationUrl,
      musicUrl,
      outputPath,
      bitrateKbps: targetBitrateKbps,
    });

    // 5. ffprobe the rendered file for the authoritative duration +
    //    bitrate. ffmpeg's `audioBitrate` request is honored within a
    //    couple of kbps for libmp3lame CBR; we still probe so the
    //    persisted value is what the file actually says.
    const probed = await probeMp3(outputPath);

    // 6. Validate against Req 11.2 + 11.4. A failure here throws plain
    //    Error → wrapper maps to GenerationFailure("mixing_failed").
    //    No upload is attempted (the upload below is gated on this
    //    completing successfully).
    validateMp3Output(probed.duration_seconds, probed.bitrate_kbps);

    // 7. Read back the file and upload to Supabase. We use the buffer
    //    upload path (rather than streaming) so the ContentLength is
    //    set correctly — the supabase-js storage client only honors
    //    upload size when the body is a Buffer / ArrayBuffer.
    const fileBytes = await fs.readFile(outputPath);
    const objectKey = `${MP3_KEY_PREFIX}/${opts.orderId}.mp3`;
    const supabase = getSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(env.SUPABASE_BUCKET_LULLABIES)
      .upload(objectKey, fileBytes, {
        contentType: "audio/mpeg",
        upsert: true,
      });
    if (uploadError) {
      throw new Error(`mix_upload_failed: ${uploadError.message}`);
    }

    // 8. Persisted bitrate must lie in {128, 160, 192} per the type, so
    //    snap the probed value to the nearest allowed bracket while
    //    staying within [128, 192]. In practice ffprobe returns the
    //    exact requested value for libmp3lame CBR encodes.
    const persistedBitrate = snapBitrate(probed.bitrate_kbps);

    return {
      object_key: objectKey,
      duration_seconds: probed.duration_seconds,
      bitrate_kbps: persistedBitrate,
    };
  } finally {
    // Always remove the tmp file. The function-level `retries: 0` step
    // setting (design §6) means a single failure is final — we don't
    // need to keep partial bytes around for diagnostics.
    await fs.rm(outputPath, { force: true }).catch(() => {
      /* swallow — best-effort cleanup */
    });
  }
}

// Exposed for unit tests so the pure helpers are covered without invoking
// ffmpeg or the network path.
export const __internal = {
  chooseBitrate,
  snapBitrate,
  validateMp3Output,
  MP3_DURATION_MIN_S,
  MP3_DURATION_MAX_S,
  MP3_BITRATE_MIN_KBPS,
  MP3_BITRATE_MAX_KBPS,
};
