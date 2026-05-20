import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __internal, log } from "@/lib/log";

// Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5
//
// Req 18.5 says redaction adds ≤50 ms per log call. We assert mean wall-clock
// per-call time over 1,000 redactions of a payload with the full PII set.

describe("log.ts PII redaction", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress stdout/stderr during the benchmark loop and capture for asserts.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function fullPiiPayload() {
    return {
      order_id: "ord_123",
      lullaby_asset_id: "asset_abc",
      event: "generation.started",
      parent_email: "parent@example.com",
      child_name: "Mira",
      child_age: 3,
      favorites: ["stars", "blueberries", "dinosaur"],
      from_name: "Mom",
      mood: "dreamy",
      narrator_voice_id: "voice_test_a",
      nested: {
        request: {
          email: "parent@example.com",
          name: "Mira",
          payload: { from_name: "Mom", favorites: ["stars"] },
        },
      },
      pii: ["Mira", "parent@example.com", "Mom", "stars", "blueberries"],
    };
  }

  it("redacts every PII key at every nesting level (Req 18.1, 18.2)", () => {
    log.info(fullPiiPayload());

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);

    // Every key in PII_KEY_REGEX is replaced with the literal placeholder.
    expect(parsed.parent_email).toBe("[redacted]");
    expect(parsed.child_name).toBe("[redacted]");
    expect(parsed.child_age).toBe("[redacted]");
    expect(parsed.favorites).toBe("[redacted]");
    expect(parsed.from_name).toBe("[redacted]");
    expect(parsed.nested.request.email).toBe("[redacted]");
    expect(parsed.nested.request.name).toBe("[redacted]");
    expect(parsed.nested.request.payload.from_name).toBe("[redacted]");
    expect(parsed.nested.request.payload.favorites).toBe("[redacted]");

    // Trace anchors survive (Req 18.2).
    expect(parsed.order_id).toBe("ord_123");
    expect(parsed.lullaby_asset_id).toBe("asset_abc");
    expect(parsed.event).toBe("generation.started");

    // The `pii` array itself is stripped from output.
    expect(parsed).not.toHaveProperty("pii");

    // Placeholder ≤16 chars and contains no portion of any PII value.
    expect(__internal.REDACTED.length).toBeLessThanOrEqual(16);
    expect(line).not.toContain("Mira");
    expect(line).not.toContain("parent@example.com");
    expect(line).not.toContain("blueberries");
  });

  it("masks PII inside Error.message and Error.stack via the per-call regex (Req 18.3)", () => {
    const err = new Error(
      "Failed to email parent@example.com about Mira's lullaby",
    );
    err.stack = `Error: Failed to email parent@example.com about Mira\n    at handler (app.ts:1:1)`;

    log.error(
      {
        order_id: "ord_xyz",
        event: "email_failed",
        pii: ["parent@example.com", "Mira"],
      },
      err,
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0]![0] as string;
    expect(line).not.toContain("parent@example.com");
    expect(line).not.toContain("Mira");
    expect(line).toContain("[redacted]");
    expect(line).toContain('"order_id":"ord_xyz"');
  });

  it("emits a synthetic redaction_failed entry when the redactor throws (Req 18.4)", () => {
    // Build a payload whose getter throws during JSON.stringify -> redactor.
    const poisoned: Record<string, unknown> = { order_id: "ord_boom" };
    Object.defineProperty(poisoned, "kaboom", {
      enumerable: true,
      get() {
        throw new Error("synthetic getter failure");
      },
    });

    log.info(poisoned);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("warn");
    expect(parsed.event).toBe("redaction_failed");
    expect(parsed.order_id).toBe("ord_boom");
  });

  it("redacts 1,000 payloads with the full PII set in mean ≤ 50 ms per call (Req 18.5)", () => {
    const N = 1000;
    const payload = fullPiiPayload();

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      log.info(payload);
    }
    const meanMs = (performance.now() - start) / N;

    // Confirm we actually emitted N entries (no accidental short-circuit).
    expect(logSpy).toHaveBeenCalledTimes(N);
    expect(meanMs).toBeLessThanOrEqual(50);
  });
});
