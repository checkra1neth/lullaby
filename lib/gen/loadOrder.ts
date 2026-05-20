/**
 * loadOrderAndGate — entry-step helper for the `generateLullaby` Inngest
 * function (design §6, Task 13).
 *
 * Responsibilities (called from `step.run("load-order")`):
 *   1. Fetch the `orders` row by id. Missing row → `NonRetriableError`
 *      (`order_not_found`) so Inngest doesn't loop. The webhook inserts the
 *      row before sending the event, so this only fires on a torn write.
 *   2. Defense-in-depth: reject non-`en` orders with
 *      `GenerationFailure("language_not_supported")` (Req 21.7). The form
 *      validator (Req 2.7) and the DB CHECK already enforce this; we re-check
 *      here so `loadOrder` is safe to call from `/api/library/regenerate`
 *      too (Task 25).
 *   3. Subscription gating for library-funded regenerations
 *      (`orders.sku === "subscription"`, Req 20):
 *        - Look up the `subscriptions` row by `stripe_subscription_id`.
 *        - 5-second wall-clock timeout (Req 16.6, 20.5).
 *        - Missing → `no_eligible_subscription` (Req 20.4).
 *        - Status ∉ {active, trialing} → `subscription_not_eligible`
 *          (Req 20.3).
 *        - Lookup throws or times out →
 *          `subscription_verification_failed` (Req 20.5).
 *      None of these create a `generation_jobs` row — the outer wrapper
 *      catches them BEFORE the `mark-running` step.
 *   4. One-off orders (`sku === "one_off"`): the row already exists (the
 *      webhook upserted it, design §6 + Req 19.1). No gating.
 *   5. Returns the loaded order so subsequent steps (lyrics, tts, music)
 *      can read its fields without re-querying.
 *
 * This module is server-only (uses the Supabase service-role client). Do
 * not import it from a client component.
 */

import { NonRetriableError } from "inngest";

import { GenerationFailure } from "@/lib/gen/failure";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Fields read from `orders` and forwarded to downstream pipeline steps.
 * Mirrors the columns in `supabase/migrations/0001_init.sql`.
 */
export interface LoadedOrder {
  id: string;
  parent_email: string;
  child_name: string;
  child_age: number;
  favorites: string[];
  mood: "calm" | "playful" | "dreamy";
  language: "en";
  narrator_voice_id: string;
  from_name: string | null;
  sku: "one_off" | "subscription";
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string;
}

const SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 5_000;
const ELIGIBLE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/**
 * Race a promise against a wall-clock timeout. The timeout rejection is the
 * sentinel `Error("subscription_lookup_timeout")` so the caller can map it
 * to the documented failure reason (Req 20.5).
 *
 * The setTimeout handle is cleared after the race resolves either way to
 * avoid leaking a timer when the underlying call wins.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutTag: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutTag));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

const ORDER_COLUMNS =
  "id,parent_email,child_name,child_age,favorites,mood,language,narrator_voice_id,from_name,sku,stripe_subscription_id,stripe_checkout_session_id,created_at";

/**
 * Load an order and apply pre-pipeline gating. Throws either:
 *   - `NonRetriableError("order_not_found")` for unknown order ids.
 *   - `GenerationFailure(reason)` for documented gating failures.
 *
 * Returns the loaded order on success.
 */
export async function loadOrderAndGate(orderId: string): Promise<LoadedOrder> {
  const supabase = getSupabaseAdmin();

  // 1. Load the order. Missing row = pipeline race; the webhook only emits
  //    `lullaby/generate.requested` after the upsert returns. NonRetriable so
  //    Inngest doesn't loop forever (the row will never appear).
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    // A real DB error (network, schema drift). Let Inngest's outer retry
    // policy decide; the function-level `retries: 0` will surface it once.
    throw new Error(`order_lookup_failed: ${error.message}`);
  }
  if (!data) {
    throw new NonRetriableError("order_not_found");
  }

  const order = data as LoadedOrder;

  // 2. Language gate (Req 21.7). The form rejects non-`en` (Req 2.7) and the
  //    DB CHECK enforces `language='en'`, so this is defense-in-depth.
  if (order.language !== "en") {
    throw new GenerationFailure("language_not_supported");
  }

  // 3. Subscription gating (Req 20) — only for library-funded regenerations.
  if (order.sku === "subscription") {
    const subscriptionId = order.stripe_subscription_id;
    if (!subscriptionId) {
      throw new GenerationFailure("no_eligible_subscription");
    }

    let subRow: { status: string } | null = null;
    try {
      const lookup = supabase
        .from("subscriptions")
        .select("status")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      const result = await withTimeout(
        // The thenable returned by supabase-js is already promise-like; the
        // explicit `Promise.resolve(...)` adapts it for `Promise.race`.
        Promise.resolve(lookup),
        SUBSCRIPTION_LOOKUP_TIMEOUT_MS,
        "subscription_lookup_timeout",
      );
      if (result.error) {
        // Treat any DB-level error as a verification failure (Req 20.5).
        throw new GenerationFailure("subscription_verification_failed");
      }
      subRow = (result.data as { status: string } | null) ?? null;
    } catch (err) {
      if (err instanceof GenerationFailure) {
        throw err;
      }
      // Timeout sentinel or any other thrown error → verification failed
      // (Req 20.5). We deliberately collapse all error shapes here so a
      // transient driver throw and a 5-second wall-clock breach map to the
      // same documented failure mode.
      throw new GenerationFailure("subscription_verification_failed");
    }

    if (!subRow) {
      throw new GenerationFailure("no_eligible_subscription");
    }
    if (!ELIGIBLE_SUBSCRIPTION_STATUSES.has(subRow.status)) {
      throw new GenerationFailure("subscription_not_eligible");
    }
  }

  // 4. one_off orders need no gating — the webhook upserted both the
  //    order and the queued generation_jobs row before this fires.
  return order;
}
