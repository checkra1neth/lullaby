/**
 * Unit tests for `lib/gen/mix.ts` (Task 17).
 *
 * Two layers:
 *
 *   1. Pure helpers (`__internal.chooseBitrate`, `__internal.snapBitrate`,
 *      `__internal.validateMp3Output`) — no mocking, no I/O. Covers the
 *      deterministic-bitrate rule (Req 19.3) and the duration / bitrate
 *      validation gates (Req 11.2, 11.4).
 *
 *   2. Integration smoke for `mixWithFfmpeg` itself with `fluent-ffmpeg`
 *      mocked to a chainable recorder, the Supabase admin client mocked
 *      to capture upload calls + emit signed URLs, and `node:fs` left
 *      alone so the temp-file cleanup path runs against a real (tiny)
 *      placeholder file. Cases:
 *        - Happy path → returns object_key / duration / bitrate, uploads
 *          to `mp3/{order_id}.mp3`, applies the design §7 filter graph.
 *        - Duration < 150 s → plain Error ("mix_validation_failed"),
 *          NO upload (Req 11.5 — partial mp3 must not persist).
 *        - ffmpeg `error` event → plain Error ("ffmpeg_exit_nonzero"),
 *          NO upload, tmp file cleanup still runs.
 *
 * The full integration verification (real ffmpeg, real network, real
 * Supabase) is covered by Task 27 smoke.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// -----------------------------------------------------------------------
// Mocks for the supabase admin client.
// -----------------------------------------------------------------------

interface SignedUrlCall {
  bucket: string;
  objectKey: string;
  ttl: number;
}
interface UploadCall {
  bucket: string;
  objectKey: string;
  contentType: string | undefined;
  upsert: boolean | undefined;
  bytes: Uint8Array;
}

interface SupabaseMockState {
  signedUrlResults: Array<{
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  }>;
  signedUrlCalls: SignedUrlCall[];
  uploadResult: { error: { message: string } | null };
  uploadCalls: UploadCall[];
}

const supabaseState: SupabaseMockState = {
  signedUrlResults: [],
  signedUrlCalls: [],
  uploadResult: { error: null },
  uploadCalls: [],
};

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(objectKey: string, ttl: number) {
            supabaseState.signedUrlCalls.push({ bucket, objectKey, ttl });
            const next = supabaseState.signedUrlResults.shift();
            if (!next) {
              return Promise.resolve({
                data: { signedUrl: `https://signed.example/${objectKey}` },
                error: null,
              });
            }
            return Promise.resolve(next);
          },
          upload(
            objectKey: string,
            payload: ArrayBuffer | Uint8Array | Buffer,
            options: { contentType?: string; upsert?: boolean } | undefined,
          ) {
            const bytes =
              payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
            supabaseState.uploadCalls.push({
              bucket,
              objectKey,
              contentType: options?.contentType,
              upsert: options?.upsert,
              bytes,
            });
            return Promise.resolve(supabaseState.uploadResult);
          },
        };
      },
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    SUPABASE_BUCKET_LULLABIES: "lullabies",
  }),
}));

// -----------------------------------------------------------------------
// Mock for ffmpeg-static (returns a non-empty path string).
// -----------------------------------------------------------------------

vi.mock("ffmpeg-static", () => ({
  default: "/usr/local/bin/ffmpeg-mock",
}));

// -----------------------------------------------------------------------
// Mock for fluent-ffmpeg. The mock records the input URLs and the
// complexFilter spec, then triggers the configured event ("end" or
// "error") on `.save(path)`. In the happy path it also writes a tiny
// placeholder file to `outputPath` so the subsequent `fs.readFile`
// returns deterministic bytes.
// -----------------------------------------------------------------------

interface FfmpegMockCommand {
  inputs: string[];
  complexFilterSpec: unknown;
  complexFilterMap: unknown;
  audioCodec: string | undefined;
  audioBitrate: string | number | undefined;
  format: string | undefined;
  outputOptions: string[];
  saveCalls: string[];
  listeners: Record<string, ((...args: unknown[]) => void) | undefined>;
}

interface FfmpegMockState {
  // Behavior toggle for `runFfmpegMix`: either resolve via `end` (after
  // writing a placeholder mp3 byte to outputPath) or reject via `error`.
  saveBehavior: "end" | "error" | "end-no-file";
  ffprobeQueue: Array<{
    err: Error | null;
    data: {
      format: { duration?: number; bit_rate?: number };
      streams: unknown[];
      chapters: unknown[];
    };
  }>;
  commands: FfmpegMockCommand[];
  setFfmpegPathCalls: string[];
  setFfprobePathCalls: string[];
  ffprobeCalls: string[];
}

const ffmpegState: FfmpegMockState = {
  saveBehavior: "end",
  ffprobeQueue: [],
  commands: [],
  setFfmpegPathCalls: [],
  setFfprobePathCalls: [],
  ffprobeCalls: [],
};

vi.mock("fluent-ffmpeg", () => {
  function createCommand(): unknown {
    const cmd: FfmpegMockCommand = {
      inputs: [],
      complexFilterSpec: undefined,
      complexFilterMap: undefined,
      audioCodec: undefined,
      audioBitrate: undefined,
      format: undefined,
      outputOptions: [],
      saveCalls: [],
      listeners: {},
    };
    // The chainable surface — methods only, no property collision with
    // the recorded `cmd` state. We attach a `__cmd` back-reference so
    // tests can read the captured state via `ffmpegState.commands`.
    const api = {
      input(source: string) {
        cmd.inputs.push(source);
        return api;
      },
      complexFilter(spec: unknown, map: unknown) {
        cmd.complexFilterSpec = spec;
        cmd.complexFilterMap = map;
        return api;
      },
      audioCodec(codec: string) {
        cmd.audioCodec = codec;
        return api;
      },
      audioBitrate(b: string | number) {
        cmd.audioBitrate = b;
        return api;
      },
      format(f: string) {
        cmd.format = f;
        return api;
      },
      outputOptions(opts: string[]) {
        cmd.outputOptions = opts;
        return api;
      },
      on(event: string, cb: (...args: unknown[]) => void) {
        cmd.listeners[event] = cb;
        return api;
      },
      save(out: string) {
        cmd.saveCalls.push(out);
        // Defer event emission to the next microtask so the resolve/reject
        // happens after `.save()` returns and the Promise is constructed.
        queueMicrotask(async () => {
          if (ffmpegState.saveBehavior === "error") {
            const cb = cmd.listeners["error"];
            if (cb) cb(new Error("synthetic ffmpeg failure"), null, "");
            return;
          }
          if (ffmpegState.saveBehavior === "end") {
            // Write a tiny placeholder so fs.readFile returns bytes.
            try {
              await fs.writeFile(out, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
            } catch {
              /* ignore — only matters for the happy path */
            }
          }
          const cb = cmd.listeners["end"];
          if (cb) cb(null, "");
        });
      },
    };
    ffmpegState.commands.push(cmd);
    return api;
  }

  function ffmpegFactory() {
    return createCommand();
  }
  // Module statics used by lib/gen/mix.ts directly.
  ffmpegFactory.setFfmpegPath = (p: string) => {
    ffmpegState.setFfmpegPathCalls.push(p);
  };
  ffmpegFactory.setFfprobePath = (p: string) => {
    ffmpegState.setFfprobePathCalls.push(p);
  };
  ffmpegFactory.ffprobe = (
    file: string,
    cb: (
      err: Error | null,
      data: {
        format: { duration?: number; bit_rate?: number };
        streams: unknown[];
        chapters: unknown[];
      },
    ) => void,
  ) => {
    ffmpegState.ffprobeCalls.push(file);
    const next = ffmpegState.ffprobeQueue.shift();
    if (!next) {
      cb(null, { format: {}, streams: [], chapters: [] });
      return;
    }
    cb(next.err, next.data);
  };

  return {
    default: ffmpegFactory,
  };
});

// -----------------------------------------------------------------------
// Test helpers / setup.
// -----------------------------------------------------------------------

const ORDER_ID = "44444444-5555-6666-7777-888888888888";
const NARRATION_KEY = `narration/${ORDER_ID}.mp3`;
const MUSIC_KEY = `music/${ORDER_ID}.mp3`;

function resetState(): void {
  supabaseState.signedUrlResults = [];
  supabaseState.signedUrlCalls = [];
  supabaseState.uploadResult = { error: null };
  supabaseState.uploadCalls = [];
  ffmpegState.saveBehavior = "end";
  ffmpegState.ffprobeQueue = [];
  ffmpegState.commands = [];
  ffmpegState.setFfmpegPathCalls = [];
  ffmpegState.setFfprobePathCalls = [];
  ffmpegState.ffprobeCalls = [];
}

beforeEach(() => {
  resetState();
});

afterEach(async () => {
  vi.clearAllMocks();
  // Best-effort cleanup of any lingering tmp file from a failed test.
  await fs
    .rm(path.join(os.tmpdir(), `lullaby-mix-${ORDER_ID}.mp3`), {
      force: true,
    })
    .catch(() => undefined);
});

// -----------------------------------------------------------------------
// Pure helper tests.
// -----------------------------------------------------------------------

describe("__internal.chooseBitrate", () => {
  it("returns 128 for narration shorter than 120 s", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(__internal.chooseBitrate(60)).toBe(128);
    expect(__internal.chooseBitrate(119.9)).toBe(128);
  });

  it("returns 160 for narration in [120, 200] s", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(__internal.chooseBitrate(120)).toBe(160);
    expect(__internal.chooseBitrate(180)).toBe(160);
    expect(__internal.chooseBitrate(200)).toBe(160);
  });

  it("returns 192 for narration longer than 200 s", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(__internal.chooseBitrate(200.01)).toBe(192);
    expect(__internal.chooseBitrate(340)).toBe(192);
  });

  it("is deterministic — same input always yields the same bitrate (Req 19.3)", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    for (const s of [50, 119.9, 120, 180, 200, 200.01, 250, 360]) {
      const a = __internal.chooseBitrate(s);
      const b = __internal.chooseBitrate(s);
      expect(a).toBe(b);
    }
  });
});

describe("__internal.snapBitrate", () => {
  it("snaps probed CBR jitter to the nearest allowed bracket", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(__internal.snapBitrate(128)).toBe(128);
    expect(__internal.snapBitrate(129)).toBe(128);
    expect(__internal.snapBitrate(159)).toBe(160);
    expect(__internal.snapBitrate(161)).toBe(160);
    expect(__internal.snapBitrate(190)).toBe(192);
    expect(__internal.snapBitrate(192)).toBe(192);
  });
});

describe("__internal.validateMp3Output", () => {
  it("accepts the documented happy ranges", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(() => __internal.validateMp3Output(150, 128)).not.toThrow();
    expect(() => __internal.validateMp3Output(360, 192)).not.toThrow();
    expect(() => __internal.validateMp3Output(240, 160)).not.toThrow();
  });

  it("rejects duration below the lower bound (Req 11.2)", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(() => __internal.validateMp3Output(149.9, 160)).toThrow(/mix_validation_failed/);
  });

  it("rejects duration above the upper bound (Req 11.2)", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(() => __internal.validateMp3Output(360.1, 160)).toThrow(/mix_validation_failed/);
  });

  it("rejects bitrate outside the [128, 192] kbps band (Req 11.4)", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(() => __internal.validateMp3Output(200, 96)).toThrow(/mix_validation_failed/);
    expect(() => __internal.validateMp3Output(200, 256)).toThrow(/mix_validation_failed/);
  });

  it("rejects non-finite values defensively", async () => {
    const { __internal } = await import("@/lib/gen/mix");
    expect(() => __internal.validateMp3Output(Number.NaN, 160)).toThrow(/mix_validation_failed/);
    expect(() => __internal.validateMp3Output(200, Number.POSITIVE_INFINITY)).toThrow(
      /mix_validation_failed/,
    );
  });
});

// -----------------------------------------------------------------------
// Integration smoke for mixWithFfmpeg.
// -----------------------------------------------------------------------

describe("mixWithFfmpeg", () => {
  it("happy path: signs URLs, runs ffmpeg with the §7 graph, validates, uploads", async () => {
    // Two ffprobe responses queued: (1) narration up-front probe → 180 s;
    // (2) post-encode mp3 probe → 200 s @ 160 kbps.
    ffmpegState.ffprobeQueue = [
      {
        err: null,
        data: {
          format: { duration: 180 },
          streams: [],
          chapters: [],
        },
      },
      {
        err: null,
        data: {
          format: { duration: 200, bit_rate: 160_000 },
          streams: [],
          chapters: [],
        },
      },
    ];

    const { mixWithFfmpeg } = await import("@/lib/gen/mix");
    const result = await mixWithFfmpeg({
      orderId: ORDER_ID,
      narrationObjectKey: NARRATION_KEY,
      musicObjectKey: MUSIC_KEY,
    });

    // Result shape (Req 11.4: object_key + duration + bitrate).
    expect(result.object_key).toBe(`mp3/${ORDER_ID}.mp3`);
    expect(result.duration_seconds).toBe(200);
    expect(result.bitrate_kbps).toBe(160);

    // Signed URLs requested for both narration + music with TTL 300 s.
    expect(supabaseState.signedUrlCalls).toHaveLength(2);
    expect(supabaseState.signedUrlCalls[0].bucket).toBe("lullabies");
    expect(supabaseState.signedUrlCalls[0].objectKey).toBe(NARRATION_KEY);
    expect(supabaseState.signedUrlCalls[0].ttl).toBe(300);
    expect(supabaseState.signedUrlCalls[1].objectKey).toBe(MUSIC_KEY);
    expect(supabaseState.signedUrlCalls[1].ttl).toBe(300);

    // ffmpeg binary path was set (defense-in-depth: both ffmpeg + ffprobe
    // paths configured against the bundled binary).
    expect(ffmpegState.setFfmpegPathCalls).toContain("/usr/local/bin/ffmpeg-mock");
    expect(ffmpegState.setFfprobePathCalls).toContain("/usr/local/bin/ffmpeg-mock");

    // The encode command captured the expected filter graph + codec.
    // (One command — the up-front narration probe uses ffmpeg.ffprobe()
    // module-level, not a chainable command.)
    expect(ffmpegState.commands).toHaveLength(1);
    const cmd = ffmpegState.commands[0];
    expect(cmd.inputs).toHaveLength(2);
    expect(cmd.inputs[0]).toBe(`https://signed.example/${NARRATION_KEY}`);
    expect(cmd.inputs[1]).toBe(`https://signed.example/${MUSIC_KEY}`);
    expect(cmd.audioCodec).toBe("libmp3lame");
    expect(cmd.audioBitrate).toBe("160k");
    expect(cmd.format).toBe("mp3");
    // Verify the design §7 mixing graph: −12 dB attenuation + amix +
    // loudnorm. Stored as the array passed to `complexFilter`.
    const spec = cmd.complexFilterSpec as string[];
    expect(spec.join("\n")).toContain("volume=-12dB[a1d]");
    expect(spec.join("\n")).toContain("amix=inputs=2:duration=first:dropout_transition=0");
    expect(spec.join("\n")).toContain("loudnorm[out]");

    // Output saved to a tmp path — keyed on the order id for traceability.
    expect(cmd.saveCalls).toHaveLength(1);
    expect(cmd.saveCalls[0]).toBe(path.join(os.tmpdir(), `lullaby-mix-${ORDER_ID}.mp3`));

    // Uploaded once with the right key, content type, and upsert flag.
    expect(supabaseState.uploadCalls).toHaveLength(1);
    const up = supabaseState.uploadCalls[0];
    expect(up.bucket).toBe("lullabies");
    expect(up.objectKey).toBe(`mp3/${ORDER_ID}.mp3`);
    expect(up.contentType).toBe("audio/mpeg");
    expect(up.upsert).toBe(true);
    // Bytes round-tripped from the placeholder we wrote in the mock.
    expect(up.bytes.byteLength).toBeGreaterThan(0);
  });

  it("throws plain Error and does NOT upload when the rendered mp3 fails the duration gate (Req 11.5)", async () => {
    // narration probe → 180 s, post-encode probe → 100 s (< 150 s).
    ffmpegState.ffprobeQueue = [
      {
        err: null,
        data: {
          format: { duration: 180 },
          streams: [],
          chapters: [],
        },
      },
      {
        err: null,
        data: {
          format: { duration: 100, bit_rate: 160_000 },
          streams: [],
          chapters: [],
        },
      },
    ];

    const { mixWithFfmpeg } = await import("@/lib/gen/mix");
    const err = await mixWithFfmpeg({
      orderId: ORDER_ID,
      narrationObjectKey: NARRATION_KEY,
      musicObjectKey: MUSIC_KEY,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/mix_validation_failed/);

    // Crucially: no upload was attempted (Req 11.5 — partial mp3 must
    // not persist).
    expect(supabaseState.uploadCalls).toHaveLength(0);
  });

  it("throws plain Error and does NOT upload on a non-zero ffmpeg exit (Req 11.5)", async () => {
    // Up-front narration probe still succeeds; ffmpeg itself errors.
    ffmpegState.ffprobeQueue = [
      {
        err: null,
        data: {
          format: { duration: 180 },
          streams: [],
          chapters: [],
        },
      },
    ];
    ffmpegState.saveBehavior = "error";

    const { mixWithFfmpeg } = await import("@/lib/gen/mix");
    const err = await mixWithFfmpeg({
      orderId: ORDER_ID,
      narrationObjectKey: NARRATION_KEY,
      musicObjectKey: MUSIC_KEY,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ffmpeg_exit_nonzero/);

    expect(supabaseState.uploadCalls).toHaveLength(0);
  });

  it("propagates a plain Error when the upload errors (mapped to mixing_failed by the wrapper)", async () => {
    ffmpegState.ffprobeQueue = [
      {
        err: null,
        data: {
          format: { duration: 180 },
          streams: [],
          chapters: [],
        },
      },
      {
        err: null,
        data: {
          format: { duration: 200, bit_rate: 160_000 },
          streams: [],
          chapters: [],
        },
      },
    ];
    supabaseState.uploadResult = { error: { message: "storage offline" } };

    const { mixWithFfmpeg } = await import("@/lib/gen/mix");
    const err = await mixWithFfmpeg({
      orderId: ORDER_ID,
      narrationObjectKey: NARRATION_KEY,
      musicObjectKey: MUSIC_KEY,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/mix_upload_failed/);
  });

  it("falls back to 160 kbps when the up-front narration probe fails", async () => {
    // First ffprobe (narration) errors; second (post-encode) succeeds at 160 kbps.
    ffmpegState.ffprobeQueue = [
      {
        err: new Error("probe failed"),
        data: { format: {}, streams: [], chapters: [] },
      },
      {
        err: null,
        data: {
          format: { duration: 200, bit_rate: 160_000 },
          streams: [],
          chapters: [],
        },
      },
    ];

    const { mixWithFfmpeg } = await import("@/lib/gen/mix");
    const result = await mixWithFfmpeg({
      orderId: ORDER_ID,
      narrationObjectKey: NARRATION_KEY,
      musicObjectKey: MUSIC_KEY,
    });
    expect(result.bitrate_kbps).toBe(160);
    // Encode command was configured at the 160 kbps fallback.
    expect(ffmpegState.commands[0].audioBitrate).toBe("160k");
  });
});

// Touch unused import to keep ESLint happy — this also reminds reviewers
// that we deliberately import vitest's `Mock` type alongside the runtime
// helpers above.
type _MockType = Mock;
