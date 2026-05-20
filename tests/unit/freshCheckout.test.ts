/**
 * Tests for `lib/auth/freshCheckout.ts` (Task 10 — signed access cookie).
 *
 * Two layers of testing:
 *   1. The HMAC primitives (`signOrderToken` / `verifyOrderToken`) — pure
 *      Web-Crypto code, exercised without `next/headers`.
 *   2. The `getFreshCheckoutOrderId` reader — verifies that a tampered or
 *      malformed cookie value never authorizes a request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => {
  // The cookie store is mutable per-test via the `__setCookies` helper below.
  let store: Map<string, { value: string }> = new Map();
  return {
    cookies: () => ({
      get: (name: string) => store.get(name),
    }),
    // Test-only escape hatch to seed the mocked cookie store.
    __setCookies: (entries: Record<string, string>) => {
      store = new Map(
        Object.entries(entries).map(([k, v]) => [k, { value: v }]),
      );
    },
    __clearCookies: () => {
      store = new Map();
    },
  };
});

import {
  FRESH_CHECKOUT_COOKIE_NAME,
  getFreshCheckoutOrderId,
  signOrderToken,
  verifyOrderToken,
} from "@/lib/auth/freshCheckout";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as headersMock from "next/headers";

const mock = headersMock as unknown as {
  __setCookies: (entries: Record<string, string>) => void;
  __clearCookies: () => void;
};

const SECRET = "whsec_test_dummy_secret_for_unit_tests";
const ORDER_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  mock.__clearCookies();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("signOrderToken / verifyOrderToken", () => {
  it("round-trips an order id through a signed token", async () => {
    const token = await signOrderToken(ORDER_ID, SECRET);
    expect(token.startsWith(`${ORDER_ID}.`)).toBe(true);
    expect(await verifyOrderToken(token, SECRET)).toBe(ORDER_ID);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signOrderToken(ORDER_ID, "another-secret");
    expect(await verifyOrderToken(token, SECRET)).toBeNull();
  });

  it("rejects a token whose signature has been tampered with", async () => {
    const token = await signOrderToken(ORDER_ID, SECRET);
    // Flip the last character of the signature.
    const tampered =
      token.slice(0, -1) + (token.slice(-1) === "A" ? "B" : "A");
    expect(await verifyOrderToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a token whose order id has been swapped", async () => {
    const token = await signOrderToken(ORDER_ID, SECRET);
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const otherId = "99999999-8888-7777-6666-555555555555";
    expect(await verifyOrderToken(`${otherId}.${sig}`, SECRET)).toBeNull();
  });

  it("returns null on garbage / malformed input", async () => {
    expect(await verifyOrderToken("garbage", SECRET)).toBeNull();
    expect(await verifyOrderToken("", SECRET)).toBeNull();
    expect(await verifyOrderToken(null, SECRET)).toBeNull();
    expect(await verifyOrderToken(undefined, SECRET)).toBeNull();
    expect(await verifyOrderToken(".onlydot", SECRET)).toBeNull();
    expect(await verifyOrderToken("missing-dot-suffix", SECRET)).toBeNull();
    expect(await verifyOrderToken("trailing-dot.", SECRET)).toBeNull();
  });
});

describe("getFreshCheckoutOrderId", () => {
  it("returns the order id when a valid signed cookie is present", async () => {
    const token = await signOrderToken(ORDER_ID, SECRET);
    mock.__setCookies({ [FRESH_CHECKOUT_COOKIE_NAME]: token });
    expect(await getFreshCheckoutOrderId()).toBe(ORDER_ID);
  });

  it("returns null when the cookie is missing", async () => {
    expect(await getFreshCheckoutOrderId()).toBeNull();
  });

  it("returns null when the cookie value is empty / whitespace", async () => {
    mock.__setCookies({ [FRESH_CHECKOUT_COOKIE_NAME]: "" });
    expect(await getFreshCheckoutOrderId()).toBeNull();
    mock.__setCookies({ [FRESH_CHECKOUT_COOKIE_NAME]: "   " });
    expect(await getFreshCheckoutOrderId()).toBeNull();
  });

  it("returns null when the cookie is unsigned legacy data", async () => {
    // The previous (Task 8) cookie shape was the bare order id — that must
    // no longer authorize anything once Task 10 lands.
    mock.__setCookies({ [FRESH_CHECKOUT_COOKIE_NAME]: ORDER_ID });
    expect(await getFreshCheckoutOrderId()).toBeNull();
  });

  it("returns null when the cookie signature has been tampered with", async () => {
    const token = await signOrderToken(ORDER_ID, SECRET);
    const tampered =
      token.slice(0, -1) + (token.slice(-1) === "A" ? "B" : "A");
    mock.__setCookies({ [FRESH_CHECKOUT_COOKIE_NAME]: tampered });
    expect(await getFreshCheckoutOrderId()).toBeNull();
  });

  it("returns null when STRIPE_WEBHOOK_SECRET is unset", async () => {
    const token = await signOrderToken(ORDER_ID, SECRET);
    mock.__setCookies({ [FRESH_CHECKOUT_COOKIE_NAME]: token });
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(await getFreshCheckoutOrderId()).toBeNull();
  });

  it("uses the documented cookie name", () => {
    expect(FRESH_CHECKOUT_COOKIE_NAME).toBe("lullaby_order_access");
  });
});
