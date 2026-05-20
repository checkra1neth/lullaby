/**
 * renderShareVideo — server-side share-video rendering step (Task 19, Req 12).
 *
 * Wired into the Inngest function as
 *   `step.run({ id: "share-video", retries: 0, timeout: "90s" }, …)`
 * matching design §6 and Req 12. The ffmpeg filter graph is the one fixed
 * by design §7 "Audio Mixing & Video Rendering Specifics – Share video":
 *
 *   [a]  start=t0, end=t0+min(30, mp3_duration-t0)          → [a_seg]
 *   [a_seg] showwaves=mode=cline:rate=24:size=720x320        → [wave]
 *   color=c=#0d0a23:size=720x1280:rate=24                    → [bg]
 *   [bg] drawtext=text='${truncate(child_name, 24)}'         → [bg2]
 *   [bg2][wave] overlay=x=0:y=480                            → [vid]
 *   [vid][a_seg] mux                                         → MP4 H.264 + AAC
 *
 * Segment selection (Req 12.2):
 *   t0 = max(0, mp3_duration_seconds - 30)
 *   segment_length = min(30, mp3_duration_seconds - t0)
 *   The segment is always ≥ 15 s because narration ≥ 150 s (Req 11.2),
 *   so mp3_duration_seconds - t0 ≥ 30 when mp3_duration_seconds ≥ 30.
 *   When mp3_duration_seconds < 30 (impossible given Req 11.2 but guarded
 *   defensively), the whole MP3 is used.
 *
 * Name truncation (Req 12.4):
 *   child_name.length > 24 ? child_name.slice(0, 23) + "…" : child_name
 *
 * Upload path: `share-videos/{asset_id}.mp4` inside the `lullabies` bucket.
 * On success, the caller (generateLullaby.ts) calls `attachShareVideo` to
 * set `lullaby_assets.share_video_object_key` (Req 12.7).
 * On any render or upload failure, we throw `GenerationFailure("share_video_upload_failed")`
 * so the outer catch maps it to the documented enum reason (Req 12.8).
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
import { GenerationFailure } from "@/lib/gen/failure";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** TTL for the internal signed URL that ffmpeg streams (server-side only). */
const SIGNED_URL_TTL_SECONDS = 300;

/** Output object-key prefix inside the `lullabies` bucket. */
const SHARE_VIDEO_KEY_PREFIX = "share-videos";

/** Tail-length of stderr we keep for diagnostic logging on a failed exit. */
const STDERR_TAIL_CHARS = 400;

/** Background color matching the design spec. */
const BG_COLOR = "#0d0a23";

/** Video dimensions (Req 12.1 — 720x1280, 9:16). */
const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 1280;

/** Frame rate (Req 12.1 — ≥24 fps). */
const VIDEO_FPS = 24;

/** Waveform overlay dimensions and position. */
const WAVE_WIDTH = 720;
const WAVE_HEIGHT = 320;
const WAVE_Y = 480;

export interface ShareVideoOptions {
  /** The `lullaby_assets.id` — used as the storage key suffix. */
  assetId: string;
  /** Storage key of the final MP3 produced by the mix step (Req 12.5). */
  mp3ObjectKey: string;
  /** Duration of the final MP3 in seconds (used to compute t0, Req 12.2). */
  mp3DurationSeconds: number;
  /** Child's name for the text overlay (Req 12.4). */
  childName: string;
}

export interface ShareVideoResult {
  /** `share-videos/{asset_id}.mp4` inside the `lullabies` bucket. */
  object_key: string;
}

/**
 * Truncate `name` to 24 characters with an ellipsis when it exceeds that
 * limit (Req 12.4).
 *
 * Rule: `name.length > 24 ? name.slice(0, 23) + "…" : name`
 *
 * The "…" is a single Unicode character (U+2026 HORIZONTAL ELLIPSIS),
 * making the truncated string exactly 24 characters long.
 */
export function truncateName(name: string): string {
  return name.length > 24 ? name.slice(0, 23) + "\u2026" : name;
}

/**
 * Compute the audio segment start time (t0) and length for the share video
 * (Req 12.2).
 *
 * t0 = max(0, mp3_duration_seconds - 30)
 * length = min(30, mp3_duration_seconds - t0)  → always ≥ 15 s given Req 11.2
 */
export function computeSegment(mp3DurationSeconds: number): {
  t0: number;
  segmentLength: number;
} {
  const t0 = Math.max(0, mp3DurationSeconds - 30);
  const segmentLength = Math.min(30, mp3DurationSeconds - t0);
  return { t0, segmentLength };
}

/**
 * Resolve the bundled ffmpeg binary path. `ffmpeg-static`'s default export
 * is typed as `string | null` because some platforms ship a missing binary;
 * for our build target (linux-x64 on Vercel + macOS for dev) it's always a
 * string. We assert non-null and coerce so fluent-ffmpeg's `setFfmpegPath`
 * is satisfied.
 */
function ensureFfmpegPath(): string {
  const candidate = ffmpegStaticPath as unknown as string | null;
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("share_video_setup_failed: ffmpeg-static did not resolve a binary path");
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
    throw new Error(
      `share_video_signed_url_failed: ${error?.message ?? "missing signedUrl"}`,
    );
  }
  return data.signedUrl;
}

/**
 * Escape a string for safe use inside an ffmpeg `drawtext` filter value.
 * ffmpeg's drawtext uses ':' as option separator and '\' as escape character.
 * We escape backslashes first, then single-quotes, then colons.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
}

/**
 * Run ffmpeg with the design §7 share-video filter graph. Resolves on the
 * `end` event, rejects on the `error` event with a plain `Error` whose
 * message carries the tail of stderr for diagnostics.
 */
function runFfmpegShareVideo(args: {
  mp3Url: string;
  outputPath: string;
  t0: number;
  segmentLength: number;
  displayName: string;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stderrBuffer = "";

    // The filter graph follows design §7 exactly:
    //
    //   [0:a] atrim=start={t0}:end={t0+segLen}, asetpts=PTS-STARTPTS → [a_seg]
    //   [a_seg] showwaves=mode=cline:rate=24:size=720x320             → [wave]
    //   color=c=#0d0a23:size=720x1280:rate=24                         → [bg]
    //   [bg] drawtext=text='…'                                        → [bg2]
    //   [bg2][wave] overlay=x=0:y=480                                 → [vid]
    //   [vid][a_seg] mux                                              → MP4
    //
    // We use `lavfi` as the second input source for the color background so
    // fluent-ffmpeg can handle it cleanly without a separate input file.
    // The `asetpts=PTS-STARTPTS` after `atrim` resets the audio timestamps
    // so the segment starts at t=0 in the output (required for showwaves
    // to sync correctly).

    const escapedName = escapeDrawtext(args.displayName);
    const segEnd = args.t0 + args.segmentLength;

    const filterComplex = [
      // Audio segment: trim + reset timestamps, then split into two streams
      // (one for showwaves, one for the final mux output) since each filter
      // input can only be consumed once.
      `[0:a]atrim=start=${args.t0}:end=${segEnd},asetpts=PTS-STARTPTS,asplit=2[a_wave][a_out]`,
      // Waveform from one copy of the audio segment (Req 12.3 — ≥24 samples/s)
      `[a_wave]showwaves=mode=cline:rate=${VIDEO_FPS}:size=${WAVE_WIDTH}x${WAVE_HEIGHT}[wave]`,
      // Solid background (Req 12.1 — 720x1280, 24 fps)
      `color=c=${BG_COLOR}:size=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:rate=${VIDEO_FPS}[bg]`,
      // Child name overlay (Req 12.4)
      `[bg]drawtext=text='${escapedName}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=200[bg2]`,
      // Overlay waveform onto background at y=480
      `[bg2][wave]overlay=x=0:y=${WAVE_Y}[vid]`,
    ].join(";");

    const command = ffmpeg()
      .input(args.mp3Url)
      // Re-use the same audio input for the mux (the [a_seg] stream is
      // already trimmed; we reference it from the filter graph output).
      // We need to pass the audio segment to the output — fluent-ffmpeg
      // maps filter outputs by label, so we map [vid] for video and
      // [a_seg] for audio.
      .complexFilter(filterComplex)
      .outputOptions([
        "-map", "[vid]",
        "-map", "[a_out]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        // Limit output duration to segmentLength as a safety net
        "-t", String(args.segmentLength),
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
      ])
      .on("stderr", (line) => {
        stderrBuffer = (stderrBuffer + line + "\n").slice(-STDERR_TAIL_CHARS);
      })
      .on("error", (err) => {
        const tail = stderrBuffer.trim();
        const baseMsg = err instanceof Error ? err.message : String(err);
        reject(
          new Error(
            `share_video_ffmpeg_failed: ${baseMsg}${tail ? ` | stderr: ${tail}` : ""}`,
          ),
        );
      })
      .on("end", () => {
        resolve();
      });

    command.save(args.outputPath);
  });
}

/**
 * Render a 9:16 share video MP4 from the final MP3 and upload it to
 * Supabase Storage. See module header for full behavior + failure mapping.
 *
 * On any render or upload failure, throws `GenerationFailure("share_video_upload_failed")`
 * so the outer catch in `generateLullaby.ts` maps it to the documented
 * enum reason (Req 12.8).
 */
export async function renderShareVideo(opts: ShareVideoOptions): Promise<ShareVideoResult> {
  const env = getServerEnv();

  // 1. Issue a server-internal signed URL for the MP3 (Req 12.5 — same
  //    mp3_object_key referenced by the parent lullaby_assets row).
  let mp3Url: string;
  try {
    mp3Url = await createInternalSignedUrl(opts.mp3ObjectKey);
  } catch (err) {
    console.error("[shareVideo] createInternalSignedUrl failed:", err);
    throw new GenerationFailure("share_video_upload_failed");
  }

  // 2. Resolve the ffmpeg binary path.
  const ffmpegBinaryPath = ensureFfmpegPath();
  ffmpeg.setFfmpegPath(ffmpegBinaryPath);
  ffmpeg.setFfprobePath(ffprobeStatic.path);

  // 3. Compute the audio segment window (Req 12.2).
  const { t0, segmentLength } = computeSegment(opts.mp3DurationSeconds);

  // 4. Truncate the child name for the overlay (Req 12.4).
  const displayName = truncateName(opts.childName);

  // 5. Render to a temp file. Always cleaned up in the finally block.
  const tmpDir = os.tmpdir();
  const outputPath = path.join(tmpDir, `lullaby-share-${opts.assetId}.mp4`);

  try {
    await runFfmpegShareVideo({
      mp3Url,
      outputPath,
      t0,
      segmentLength,
      displayName,
    });

    // 6. Read back the rendered file and upload to Supabase Storage.
    const fileBytes = await fs.readFile(outputPath);
    const objectKey = `${SHARE_VIDEO_KEY_PREFIX}/${opts.assetId}.mp4`;
    const supabase = getSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(env.SUPABASE_BUCKET_LULLABIES)
      .upload(objectKey, fileBytes, {
        contentType: "video/mp4",
        upsert: true,
      });
    if (uploadError) {
      throw new Error(`share_video_upload_failed: ${uploadError.message}`);
    }

    return { object_key: objectKey };
  } catch (err) {
    // Any render or upload failure maps to the documented enum reason
    // (Req 12.8). Re-throw typed failures unchanged; wrap everything else.
    console.error("[shareVideo] render/upload failed:", err);
    if (err instanceof GenerationFailure) {
      throw err;
    }
    throw new GenerationFailure("share_video_upload_failed");
  } finally {
    // Always remove the tmp file — partial mp4s must not linger.
    await fs.rm(outputPath, { force: true }).catch(() => {
      /* swallow — best-effort cleanup */
    });
  }
}

/**
 * Set `lullaby_assets.share_video_object_key` after a successful upload
 * (Req 12.7). Called from a separate `step.run("attach-share-video", …)`
 * block in `generateLullaby.ts` so Inngest's step memoization makes the
 * DB write idempotent on retries.
 *
 * Throws a plain `Error` on DB failure — there is no documented
 * `failure_reason` enum for this write, so the outer catch lets it
 * propagate as an unknown error.
 */
export async function attachShareVideo(
  assetId: string,
  objectKey: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("lullaby_assets")
    .update({ share_video_object_key: objectKey })
    .eq("id", assetId);
  if (error) {
    throw new Error(`attach_share_video_failed: ${error.message}`);
  }
}

// Exposed for unit tests so the pure helpers are covered without invoking
// ffmpeg or the network path.
export const __internal = {
  truncateName,
  computeSegment,
  escapeDrawtext,
};
