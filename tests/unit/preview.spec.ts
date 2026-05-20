/**
 * Unit tests for the preview endpoint (Task 22).
 *
 * Tests the rate limiter logic and the preview route handler behavior
 * using mocked ElevenLabs TTS and Upstash Redis dependencies.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.7
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared mock pipeline object — reset per test in beforeEach
const mockPipeline = {
  incr: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([1, true]),
};

// Mock fetch globally for ElevenLabs TTS calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("POST /api/preview", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the rate limit counter to 1 (allowed) by default
    mockPipeline.exec.mockResolvedValue([1, true]);

    // Default: successful TTS response with ~8 seconds of audio at 128kbps
    // 128kbps = 16000 bytes/sec, so 8 seconds = 128000 bytes
    const fakeAudio = Buffer.alloc(128000, 0x42);
    mockFetch.mockResolvedValue(
      new Response(fakeAudio, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    // Reset module registry so each test gets fresh imports with current mocks
    vi.resetModules();

    // Re-apply mocks after module reset
    vi.doMock("@/lib/env", () => ({
      getServerEnv: () => ({
        ELEVENLABS_API_KEY: "test-api-key",
        UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "fake-token",
        SUPABASE_BUCKET_LULLABIES: "lullabies",
      }),
    }));

    vi.doMock("@upstash/redis", () => ({
      Redis: vi.fn().mockImplementation(() => ({
        pipeline: () => mockPipeline,
      })),
    }));

    // Dynamic import to pick up mocks
    const mod = await import("@/app/api/preview/route");
    POST = mod.POST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 when child_name is empty (Req 3.1)", async () => {
    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({ child_name: "   ", voice_id: "voice_123" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation_failed");
  });

  it("returns 400 when voice_id is missing (Req 3.1)", async () => {
    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({ child_name: "Mira" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limit is exceeded (Req 3.7)", async () => {
    // Simulate 6th request (counter > 5)
    mockPipeline.exec.mockResolvedValue([6, false]);

    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({ child_name: "Mira", voice_id: "voice_123" }),
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("limit_reached");
  });

  it("returns 200 with audio_base64 and duration_s on success (Req 3.2)", async () => {
    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({ child_name: "Mira", voice_id: "voice_123" }),
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "10.0.0.1",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audio_base64).toBeDefined();
    expect(typeof body.audio_base64).toBe("string");
    expect(body.duration_s).toBeGreaterThanOrEqual(5);
    expect(body.duration_s).toBeLessThanOrEqual(12);
  });

  it("returns 502 on upstream ElevenLabs error", async () => {
    mockFetch.mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({ child_name: "Mira", voice_id: "voice_123" }),
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "10.0.0.2",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("upstream_error");
  });

  it("returns 504 on timeout (Req 3.5)", async () => {
    // Simulate an AbortError (timeout)
    mockFetch.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      }),
    );

    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({ child_name: "Mira", voice_id: "voice_123" }),
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "10.0.0.3",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe("gateway_timeout");
  });

  it("calls ElevenLabs TTS with the correct voice_id and child_name in script (Req 3.3)", async () => {
    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({ child_name: "Luna", voice_id: "voice_abc" }),
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "10.0.0.4",
      },
    });
    await POST(req);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOpts] = mockFetch.mock.calls[0];

    // Voice ID is in the URL path
    expect(fetchUrl).toContain("/text-to-speech/voice_abc");

    // Child name is in the request body text
    const bodyParsed = JSON.parse(fetchOpts.body);
    expect(bodyParsed.text).toContain("Luna");
  });

  it("trims child_name before using it (Req 3.1)", async () => {
    const req = new Request("http://localhost/api/preview", {
      method: "POST",
      body: JSON.stringify({
        child_name: "  Mira  ",
        voice_id: "voice_123",
      }),
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "10.0.0.5",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // The TTS call should use the trimmed name
    const [, fetchOpts] = mockFetch.mock.calls[0];
    const bodyParsed = JSON.parse(fetchOpts.body);
    expect(bodyParsed.text).toContain("Mira");
    expect(bodyParsed.text).not.toContain("  Mira  ");
  });
});
