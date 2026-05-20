/**
 * Unit tests for `lib/gen/music.ts` (Task 16).
 *
 * Exercises every documented branch of `requestBackgroundMusic` with the
 * ElevenLabs Music REST endpoint stubbed via `vi.stubGlobal("fetch", …)`
 * and the Supabase admin client stubbed via `vi.mock`. No network or disk
 * I/O happens in any case.
 *
 * Cases:
 *   - Happy path: 200 + non-empty body → uploads to `music/{order_id}.mp3`
 *     and returns `{ object_key, duration_seconds }`.
 *   - Headers: xi-api-key + Content-Type + Accept set.
 *   - Body: prompt mentions the chosen mood; `music_length_ms` clamps to
 *     the documented headroom and the `max_seconds` upper bound.
 *   - Duration < target → `GenerationFailure("insufficient_music_duration")`
 *     and the upload is NOT attempted (Req 10.5, no partial state).
 *   - API non-2xx (500) → plain Error (mapped to `music_generation_failed`
 *     by the wrapper, Req 10.4).
 *   - Network throw → plain Error.
 *   - Empty 200 body → plain Error.
 *   - Supabase upload error → plain Error.
 *
 * `__internal.computeMusicLengthMs` and `__internal.buildMusicPrompt` are
 * also exercised so the prompt+length math is covered without depending
 * on the network path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationFailure } from "@/lib/gen/failure";

// ---- vi.mock for the supabase admin client --------------------------------

interface UploadCall {
  bucket: string;
  objectKey: string;
  contentType: string | undefined;
  upsert: boolean | undefined;
  bytes: Uint8Array;
}

interface MockState {
  uploadResult: { error: { message: string } | null };
  uploadCalls: UploadCall[];
}

const supabaseState: MockState = {
  uploadResult: { error: null },
  uploadCalls: [],
};

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from(bucket: string) {
        return {
          upload(
            objectKey: string,
            payload: ArrayBuffer | Uint8Array | Buffer,
            options: { contentType?: string; upsert?: boolean } | undefined,
          ) {
            const bytes =
              payload instanceof Uint8Array
                ? payload
                : new Uint8Array(payload as ArrayBuffer);
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

// ---- vi.mock for getServerEnv so we don't need real env values ------------

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    ELEVENLABS_API_KEY: "test-elevenlabs-key",
    SUPABASE_BUCKET_LULLABIES: "lullabies",
  }),
}));

// ---- helpers --------------------------------------------------------------

interface FetchCallRecord {
  url: string;
  init: RequestInit | undefined;
}

function installFetchStub(
  impl: (
    url: string,
    init: RequestInit | undefined,
  ) => Promise<Response> | Response,
): { calls: FetchCallRecord[] } {
  const calls: FetchCallRecord[] = [];
  vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    calls.push({ url, init });
    return Promise.resolve(impl(url, init));
  }) as typeof fetch);
  return { calls };
}

function audioResponse(bytes: Uint8Array): Response {
  // Cast through `BodyInit` — Node 22+'s `Response` typings restrict
  // `Uint8Array<ArrayBufferLike>` against `URLSearchParams`, but the
  // runtime accepts any typed-array body just fine.
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

/** 128 kbps mp3 = 16,000 bytes per second. */
function bytesForSeconds(seconds: number): Uint8Array {
  return new Uint8Array(Math.round(seconds * 16_000));
}

const ORDER_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  supabaseState.uploadResult = { error: null };
  supabaseState.uploadCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---- tests ----------------------------------------------------------------

describe("requestBackgroundMusic", () => {
  it("returns object_key + duration on the happy path and uploads to music/{order_id}.mp3", async () => {
    // Narration is 200 s; we ask for music sized to that. Produce 205 s
    // back so the duration gate (track ≥ narration) passes comfortably.
    const audio = bytesForSeconds(205);
    const fetchStub = installFetchStub(() => audioResponse(audio));

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    const result = await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "dreamy",
      target_seconds: 200,
      max_seconds: 230,
    });

    expect(result.object_key).toBe(`music/${ORDER_ID}.mp3`);
    expect(result.duration_seconds).toBeCloseTo(205, 0);

    // Hit the music endpoint with the right output format query param.
    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0];
    expect(call.url).toContain("/v1/music");
    expect(call.url).toContain("output_format=mp3_44100_128");
    expect(call.init?.method).toBe("POST");

    // Headers.
    const headers = new Headers(call.init?.headers ?? {});
    expect(headers.get("xi-api-key")).toBe("test-elevenlabs-key");
    expect(headers.get("Accept")).toBe("audio/mpeg");
    expect(headers.get("Content-Type")).toBe("application/json");

    // Body shape (prompt + music_length_ms + model_id + force_instrumental).
    const body = JSON.parse(call.init?.body as string);
    expect(typeof body.prompt).toBe("string");
    // Mood must be present in the prompt (Req 10.1).
    expect(body.prompt.toLowerCase()).toContain("dreamy");
    // music_length_ms biases above target (target + 5 s = 205 s = 205,000 ms),
    // clamped to max_seconds * 1000 = 230,000 ms — so 205,000 wins.
    expect(body.music_length_ms).toBe(205_000);
    expect(typeof body.model_id).toBe("string");
    expect(body.force_instrumental).toBe(true);

    // Uploaded to the expected key/bucket/content-type with upsert true.
    expect(supabaseState.uploadCalls).toHaveLength(1);
    const up = supabaseState.uploadCalls[0];
    expect(up.bucket).toBe("lullabies");
    expect(up.objectKey).toBe(`music/${ORDER_ID}.mp3`);
    expect(up.contentType).toBe("audio/mpeg");
    expect(up.upsert).toBe(true);
    expect(up.bytes.byteLength).toBe(audio.byteLength);
  });

  it("includes the calm mood label in the prompt", async () => {
    const audio = bytesForSeconds(205);
    const fetchStub = installFetchStub(() => audioResponse(audio));

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "calm",
      target_seconds: 200,
      max_seconds: 230,
    });
    const body = JSON.parse(fetchStub.calls[0].init?.body as string);
    expect(body.prompt.toLowerCase()).toContain("calm");
  });

  it("includes the playful mood label in the prompt", async () => {
    const audio = bytesForSeconds(205);
    const fetchStub = installFetchStub(() => audioResponse(audio));

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "playful",
      target_seconds: 200,
      max_seconds: 230,
    });
    const body = JSON.parse(fetchStub.calls[0].init?.body as string);
    expect(body.prompt.toLowerCase()).toContain("playful");
  });

  it("clamps music_length_ms to max_seconds when target+headroom would exceed it", async () => {
    // target + 5 s = 235 s > max_seconds (230). Expect 230 s = 230_000 ms.
    const audio = bytesForSeconds(235);
    const fetchStub = installFetchStub(() => audioResponse(audio));

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "dreamy",
      target_seconds: 230,
      max_seconds: 230,
    });
    const body = JSON.parse(fetchStub.calls[0].init?.body as string);
    expect(body.music_length_ms).toBe(230_000);
  });

  it("throws GenerationFailure('insufficient_music_duration') and does NOT upload when the produced track is shorter than narration (Req 10.5)", async () => {
    // Narration = 200 s but the API returns only 150 s of audio.
    const audio = bytesForSeconds(150);
    const fetchStub = installFetchStub(() => audioResponse(audio));

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    const err = await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "dreamy",
      target_seconds: 200,
      max_seconds: 230,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GenerationFailure);
    expect(err.reason).toBe("insufficient_music_duration");

    // We hit the API once, but did NOT upload anything (no partial state).
    expect(fetchStub.calls).toHaveLength(1);
    expect(supabaseState.uploadCalls).toHaveLength(0);
  });

  it("throws a plain Error when the API returns a non-2xx status (mapped to music_generation_failed by the wrapper, Req 10.4)", async () => {
    installFetchStub(() => new Response("upstream boom", { status: 500 }));

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    const err = await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "dreamy",
      target_seconds: 200,
      max_seconds: 230,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/music_http_500/);
    expect(supabaseState.uploadCalls).toHaveLength(0);
  });

  it("throws a plain Error when fetch itself throws (network failure)", async () => {
    installFetchStub(() => {
      throw new Error("ECONNRESET");
    });

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    const err = await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "dreamy",
      target_seconds: 200,
      max_seconds: 230,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/music_request_failed/);
  });

  it("throws when the API returns 200 with an empty body", async () => {
    installFetchStub(() => audioResponse(new Uint8Array(0)));

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    const err = await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "dreamy",
      target_seconds: 200,
      max_seconds: 230,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/music_empty_audio/);
  });

  it("throws a plain Error when the Supabase upload errors", async () => {
    const audio = bytesForSeconds(205);
    installFetchStub(() => audioResponse(audio));
    supabaseState.uploadResult = {
      error: { message: "storage offline" },
    };

    const { requestBackgroundMusic } = await import("@/lib/gen/music");
    const err = await requestBackgroundMusic({
      orderId: ORDER_ID,
      mood: "dreamy",
      target_seconds: 200,
      max_seconds: 230,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/music_upload_failed/);
  });
});

describe("__internal.computeMusicLengthMs", () => {
  it("biases above target by 5 s when there's room before max", async () => {
    const { __internal } = await import("@/lib/gen/music");
    expect(__internal.computeMusicLengthMs(200, 230)).toBe(205_000);
  });

  it("clamps to max_seconds when target+5 would exceed it", async () => {
    const { __internal } = await import("@/lib/gen/music");
    expect(__internal.computeMusicLengthMs(230, 230)).toBe(230_000);
  });

  it("clamps to the 5-minute API hard ceiling", async () => {
    const { __internal } = await import("@/lib/gen/music");
    // target 700 s, max 800 s → 705_000 ms target / 800_000 ms max
    // both exceed the 300_000 ms hard ceiling → clamps to 300_000.
    expect(__internal.computeMusicLengthMs(700, 800)).toBe(300_000);
  });
});

describe("__internal.buildMusicPrompt", () => {
  it("mentions the mood label and the target duration", async () => {
    const { __internal } = await import("@/lib/gen/music");
    const prompt = __internal.buildMusicPrompt("dreamy", 187.4);
    expect(prompt.toLowerCase()).toContain("dreamy");
    // Rounded target seconds appear as "187 seconds".
    expect(prompt).toMatch(/187 seconds/);
  });

  it("rounds and clamps the duration hint to a clean integer ≥1 second", async () => {
    const { __internal } = await import("@/lib/gen/music");
    const prompt = __internal.buildMusicPrompt("calm", 0.2);
    expect(prompt).toMatch(/1 seconds/);
  });
});

describe("__internal.estimateMp3DurationSeconds", () => {
  it("returns 0 for non-positive byte length", async () => {
    const { __internal } = await import("@/lib/gen/music");
    expect(__internal.estimateMp3DurationSeconds(0)).toBe(0);
    expect(__internal.estimateMp3DurationSeconds(-1)).toBe(0);
  });

  it("computes seconds from bytes at 128 kbps", async () => {
    const { __internal } = await import("@/lib/gen/music");
    expect(__internal.estimateMp3DurationSeconds(16_000)).toBeCloseTo(1, 5);
    expect(__internal.estimateMp3DurationSeconds(160_000)).toBeCloseTo(10, 5);
  });
});
