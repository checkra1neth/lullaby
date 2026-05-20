/**
 * Unit tests for `lib/gen/loadOrder.ts` (Task 13).
 *
 * Exercises every gating branch documented in design §6 + Req 20:
 *   - Order missing → NonRetriableError("order_not_found")
 *   - language ≠ "en" → GenerationFailure("language_not_supported")
 *   - one_off order → no gating, returns the order
 *   - subscription order, missing subscription row →
 *       GenerationFailure("no_eligible_subscription")
 *   - subscription order, status outside {active, trialing} →
 *       GenerationFailure("subscription_not_eligible")
 *   - subscription order, lookup throws →
 *       GenerationFailure("subscription_verification_failed")
 *   - subscription order, lookup exceeds 5s →
 *       GenerationFailure("subscription_verification_failed")
 *   - subscription order, missing stripe_subscription_id →
 *       GenerationFailure("no_eligible_subscription")
 *   - subscription order, status='active' or 'trialing' → returns the order
 *
 * The Supabase admin client is fully stubbed via `vi.mock` so no network /
 * DB calls happen. The stub records the table accessed so we can assert
 * the gating doesn't query `subscriptions` for one-off orders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NonRetriableError } from "inngest";

import { GenerationFailure } from "@/lib/gen/failure";

// ---- vi.mock for the supabase admin client ---------------------------------

type CannedResult<T> = { data: T | null; error: { message: string } | null };

interface OrderRow {
  id: string;
  parent_email: string;
  child_name: string;
  child_age: number;
  favorites: string[];
  mood: "calm" | "playful" | "dreamy";
  language: string;
  narrator_voice_id: string;
  from_name: string | null;
  sku: "one_off" | "subscription";
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string;
}

interface MockState {
  orderResult: CannedResult<OrderRow> | (() => Promise<CannedResult<OrderRow>>);
  subscriptionResult:
    | CannedResult<{ status: string }>
    | (() => Promise<CannedResult<{ status: string }>>);
  tablesQueried: string[];
}

const state: MockState = {
  orderResult: { data: null, error: null },
  subscriptionResult: { data: null, error: null },
  tablesQueried: [],
};

function makeQueryThenable<T>(
  result: CannedResult<T> | (() => Promise<CannedResult<T>>),
) {
  const resolver = () =>
    typeof result === "function" ? result() : Promise.resolve(result);
  // Supabase's PostgrestFilterBuilder is thenable. We mimic the chained API
  // surface used by loadOrderAndGate: .select().eq().maybeSingle()
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle() {
      return resolver();
    },
    then(
      onFulfilled?: (value: CannedResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return resolver().then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      state.tablesQueried.push(table);
      if (table === "orders") {
        return makeQueryThenable(state.orderResult);
      }
      if (table === "subscriptions") {
        return makeQueryThenable(state.subscriptionResult);
      }
      throw new Error(`unexpected table in test mock: ${table}`);
    },
  }),
}));

// ---- helpers ---------------------------------------------------------------

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
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

beforeEach(() => {
  state.orderResult = { data: null, error: null };
  state.subscriptionResult = { data: null, error: null };
  state.tablesQueried = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- tests -----------------------------------------------------------------

describe("loadOrderAndGate", () => {
  it("returns the order on the happy one-off path and never queries subscriptions", async () => {
    const order = makeOrder();
    state.orderResult = { data: order, error: null };

    const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
    const result = await loadOrderAndGate(order.id);

    expect(result.id).toBe(order.id);
    expect(result.sku).toBe("one_off");
    expect(state.tablesQueried).toEqual(["orders"]);
  });

  it("throws NonRetriableError('order_not_found') when the order is missing", async () => {
    state.orderResult = { data: null, error: null };

    const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
    await expect(loadOrderAndGate("missing-id")).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    await expect(loadOrderAndGate("missing-id")).rejects.toMatchObject({
      message: "order_not_found",
    });
  });

  it("rethrows a generic Error when the order lookup itself fails (not NonRetriable)", async () => {
    state.orderResult = {
      data: null,
      error: { message: "connection refused" },
    };

    const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
    await expect(loadOrderAndGate("any-id")).rejects.toThrow(
      /order_lookup_failed/,
    );
  });

  it("rejects non-`en` orders with language_not_supported (Req 21.7)", async () => {
    state.orderResult = {
      data: makeOrder({ language: "fr" }),
      error: null,
    };

    const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
    await expect(loadOrderAndGate("any-id")).rejects.toMatchObject({
      reason: "language_not_supported",
    });
  });

  describe("subscription gating (Req 20)", () => {
    it("throws no_eligible_subscription when the order has no stripe_subscription_id", async () => {
      state.orderResult = {
        data: makeOrder({ sku: "subscription", stripe_subscription_id: null }),
        error: null,
      };

      const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
      const err = await loadOrderAndGate("any-id").catch((e) => e);
      expect(err).toBeInstanceOf(GenerationFailure);
      expect(err.reason).toBe("no_eligible_subscription");
      // We bailed before touching subscriptions table.
      expect(state.tablesQueried).toEqual(["orders"]);
    });

    it("throws no_eligible_subscription when no subscription row exists", async () => {
      state.orderResult = {
        data: makeOrder({
          sku: "subscription",
          stripe_subscription_id: "sub_123",
        }),
        error: null,
      };
      state.subscriptionResult = { data: null, error: null };

      const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
      const err = await loadOrderAndGate("any-id").catch((e) => e);
      expect(err).toBeInstanceOf(GenerationFailure);
      expect(err.reason).toBe("no_eligible_subscription");
      expect(state.tablesQueried).toEqual(["orders", "subscriptions"]);
    });

    it.each([
      ["incomplete"],
      ["past_due"],
      ["canceled"],
      ["unpaid"],
    ])(
      "throws subscription_not_eligible when status='%s'",
      async (status) => {
        state.orderResult = {
          data: makeOrder({
            sku: "subscription",
            stripe_subscription_id: "sub_123",
          }),
          error: null,
        };
        state.subscriptionResult = { data: { status }, error: null };

        const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
        const err = await loadOrderAndGate("any-id").catch((e) => e);
        expect(err).toBeInstanceOf(GenerationFailure);
        expect(err.reason).toBe("subscription_not_eligible");
      },
    );

    it.each([["active"], ["trialing"]])(
      "returns the order when status='%s'",
      async (status) => {
        const order = makeOrder({
          sku: "subscription",
          stripe_subscription_id: "sub_123",
        });
        state.orderResult = { data: order, error: null };
        state.subscriptionResult = { data: { status }, error: null };

        const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
        const result = await loadOrderAndGate(order.id);
        expect(result.id).toBe(order.id);
      },
    );

    it("throws subscription_verification_failed when the subscription lookup errors", async () => {
      state.orderResult = {
        data: makeOrder({
          sku: "subscription",
          stripe_subscription_id: "sub_123",
        }),
        error: null,
      };
      state.subscriptionResult = {
        data: null,
        error: { message: "boom" },
      };

      const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
      const err = await loadOrderAndGate("any-id").catch((e) => e);
      expect(err).toBeInstanceOf(GenerationFailure);
      expect(err.reason).toBe("subscription_verification_failed");
    });

    it("throws subscription_verification_failed when the subscription lookup exceeds 5 seconds (Req 20.5)", async () => {
      state.orderResult = {
        data: makeOrder({
          sku: "subscription",
          stripe_subscription_id: "sub_123",
        }),
        error: null,
      };
      // Simulate a hung lookup by returning a never-resolving promise.
      state.subscriptionResult = () => new Promise(() => {});

      vi.useFakeTimers();

      const { loadOrderAndGate } = await import("@/lib/gen/loadOrder");
      const promise = loadOrderAndGate("any-id");
      // Attach the catch synchronously so the timer-driven rejection has a
      // handler before the timer fires.
      const caught = promise.catch((e) => e);

      // Advance past the 5-second timeout.
      await vi.advanceTimersByTimeAsync(5_000);

      const err = await caught;
      expect(err).toBeInstanceOf(GenerationFailure);
      expect(err.reason).toBe("subscription_verification_failed");
    });
  });
});
