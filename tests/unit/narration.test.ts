/**
 * Unit tests for `lib/gen/narration.ts` (Task 15).
 *
 * Exercises every documented branch of `synthesizeNarration` with the
 * ElevenLabs TTS REST endpoint stubbed via `vi.stubGlobal("fetch", …)`
 * and the Supabase admin client stubbed via `vi.mock`. No network or
 * disk I/O happens in any case.
 *
 * Cases:
 *   - Happy path: 200 + non-empty audio body → uploads to the expected
 *     object key with audio/mpeg content-type and returns
 *     `{ object_key, duration_seconds }`.
 *   - Empty `narrator_voice_id` → throws `GenerationFailure("missing_voice_id")`
 *     and never calls fetch (Req 9.4).
 *   - API non-2xx (500) → throws a plain Error (Req 9.3 — retriable).
 *   - Network throw → throws a plain Error (Req 9.3 — retriable).
 *   - Empty 200 body → throws a plain Error.
 *   - Supabase upload error → throws a plain Error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationFailure } from "@/lib/gen/failure";
import type { LoadedOrder } from "@/lib/gen/loadOrder";

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

function makeOrder(overrides: Partial<LoadedOrder> = {}): LoadedOrder {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    parent_email: "parent@example.com",
    child_name: "Mira",
    child_age: 3,
    favorites: ["stars", "blueberries", "dinosaur"],
    mood: "dreamy",
    language: "en",
    narrator_voice_id: "voice_test_a",
    from_name: null,
    sku: "one_off",
    stripe_subscription_id: null,
    stripe_checkout_session_id: "cs_test_abc",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

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

beforeEach(() => {
  supabaseState.uploadResult = { error: null };
  supabaseState.uploadCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---- tests ----------------------------------------------------------------

describe("synthesizeNarration", () => {
  it("returns object_key + duration on the happy path and uploads to narration/{order_id}.mp3", async () => {
    const order = makeOrder();
    // Roughly 1 second of audio at 128 kbps = 16,000 bytes.
    const audio = new Uint8Array(16_000).fill(0x42);
    const fetchStub = installFetchStub(() => audioResponse(audio));

    const { synthesizeNarration } = await import("@/lib/gen/narration");
    const result = await synthesizeNarration(order, "Goodnight Mira.");

    expect(result.object_key).toBe(`narration/${order.id}.mp3`);
    // 16,000 bytes / (128 kbps × 1000 / 8) = 1.0 s
    expect(result.duration_seconds).toBeCloseTo(1.0, 5);

    // Hit the right voice id with the right output format.
    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0];
    expect(call.url).toContain(
      `/text-to-speech/${order.narrator_voice_id}`,
    );
    expect(call.url).toContain("output_format=mp3_44100_128");
    expect(call.init?.method).toBe("POST");
    const headers = new Headers(call.init?.headers ?? {});
    expect(headers.get("xi-api-key")).toBe("test-elevenlabs-key");
    expect(headers.get("Accept")).toBe("audio/mpeg");
    expect(headers.get("Content-Type")).toBe("application/json");
    const body = JSON.parse(call.init?.body as string);
    expect(body.text).toBe("Goodnight Mira.");
    expect(typeof body.model_id).toBe("string");
    expect(body.voice_settings).toBeDefined();

    // Uploaded to the expected key/bucket/content-type with upsert true.
    expect(supabaseState.uploadCalls).toHaveLength(1);
    const up = supabaseState.uploadCalls[0];
    expect(up.bucket).toBe("lullabies");
    expect(up.objectKey).toBe(`narration/${order.id}.mp3`);
    expect(up.contentType).toBe("audio/mpeg");
    expect(up.upsert).toBe(true);
    expect(up.bytes.byteLength).toBe(audio.byteLength);
  });

  it("throws GenerationFailure('missing_voice_id') and never calls fetch when narrator_voice_id is empty", async () => {
    const order = makeOrder({ narrator_voice_id: "" });
    const fetchStub = installFetchStub(() =>
      audioResponse(new Uint8Array(1)),
    );

    const { synthesizeNarration } = await import("@/lib/gen/narration");
    const err = await synthesizeNarration(order, "any lyrics").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GenerationFailure);
    expect(err.reason).toBe("missing_voice_id");

    expect(fetchStub.calls).toHaveLength(0);
    expect(supabaseState.uploadCalls).toHaveLength(0);
  });

  it("throws GenerationFailure('missing_voice_id') when narrator_voice_id is whitespace only", async () => {
    const order = makeOrder({ narrator_voice_id: "   " });
    const fetchStub = installFetchStub(() =>
      audioResponse(new Uint8Array(1)),
    );

    const { synthesizeNarration } = await import("@/lib/gen/narration");
    const err = await synthesizeNarration(order, "any lyrics").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GenerationFailure);
    expect(err.reason).toBe("missing_voice_id");
    expect(fetchStub.calls).toHaveLength(0);
  });

  it("throws a retriable plain Error when the API returns a non-2xx status (Req 9.3)", async () => {
    const order = makeOrder();
    installFetchStub(
      () => new Response("upstream boom", { status: 500 }),
    );

    const { synthesizeNarration } = await import("@/lib/gen/narration");
    const err = await synthesizeNarration(order, "any lyrics").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/tts_http_500/);
    expect(supabaseState.uploadCalls).toHaveLength(0);
  });

  it("throws a retriable plain Error when fetch itself throws (network failure)", async () => {
    const order = makeOrder();
    installFetchStub(() => {
      throw new Error("ECONNRESET");
    });

    const { synthesizeNarration } = await import("@/lib/gen/narration");
    const err = await synthesizeNarration(order, "any lyrics").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/tts_request_failed/);
  });

  it("throws when the API returns 200 with an empty body", async () => {
    const order = makeOrder();
    installFetchStub(() => audioResponse(new Uint8Array(0)));

    const { synthesizeNarration } = await import("@/lib/gen/narration");
    const err = await synthesizeNarration(order, "any lyrics").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/tts_empty_audio/);
  });

  it("throws a retriable plain Error when the Supabase upload errors", async () => {
    const order = makeOrder();
    installFetchStub(() => audioResponse(new Uint8Array(16_000)));
    supabaseState.uploadResult = {
      error: { message: "storage offline" },
    };

    const { synthesizeNarration } = await import("@/lib/gen/narration");
    const err = await synthesizeNarration(order, "any lyrics").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GenerationFailure);
    expect((err as Error).message).toMatch(/tts_upload_failed/);
  });
});

describe("estimateMp3DurationSeconds", () => {
  it("returns 0 for non-positive byteLength", async () => {
    const { estimateMp3DurationSeconds } = await import(
      "@/lib/gen/narration"
    );
    expect(estimateMp3DurationSeconds(0)).toBe(0);
    expect(estimateMp3DurationSeconds(-100)).toBe(0);
  });

  it("computes seconds from bytes at 128 kbps", async () => {
    const { estimateMp3DurationSeconds } = await import(
      "@/lib/gen/narration"
    );
    // 128 kbps = 16,000 bytes per second.
    expect(estimateMp3DurationSeconds(16_000)).toBeCloseTo(1.0, 5);
    expect(estimateMp3DurationSeconds(160_000)).toBeCloseTo(10.0, 5);
  });

  it("respects an explicit non-default bitrate", async () => {
    const { estimateMp3DurationSeconds } = await import(
      "@/lib/gen/narration"
    );
    // 192 kbps = 24,000 bytes per second.
    expect(estimateMp3DurationSeconds(24_000, 192)).toBeCloseTo(1.0, 5);
  });
});
