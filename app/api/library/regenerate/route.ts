/**
 * POST /api/library/regenerate — Subscription-funded lullaby regeneration
 * (Req 16.2, 16.3, 16.6, 20.1–20.5, design §3.1 Library_Service, §3.2
 * API Surface – Library).
 *
 * Accepts the full form payload (same shape as `/api/checkout/one-off`),
 * gates on the caller's active subscription, inserts an `orders` row with
 * `sku='subscription'`, and dispatches the Inngest generation event.
 *
 * Order of operations
 * -------------------
 *  1. Authenticate: require a Supabase Auth session. 401 if missing.
 *  2. Validate the JSON body with `getLullabyFormSchema()`. 400 on failure.
 *  3. Look up the caller's `subscriptions` row by `parent_email` with a
 *     5-second timeout (Req 16.6, 20.5).
 *       - Timeout → 503 with a retry hint (Req 16.6).
 *       - Missing row or status ∉ {active, trialing} → 403 "resubscribe to
 *         continue" (Req 16.3, 20.3).
 *  4. Insert an `orders` row with `sku='subscription'` and
 *     `stripe_subscription_id` set from the subscription row (Req 20.1).
 *     NOTE: no `generation_jobs` row is created here — `loadOrderAndGate`
 *     inside the Inngest function creates it after re-verifying the
 *     subscription (Req 20, design §6). This satisfies the task requirement
 *     "Never create a generation_jobs row before gating passes."
 *  5. `inngest.send("lullaby/generate.requested", { data: { order_id } })`.
 *  6. Return `202 { order_id }`.
 *
 * The 5-second subscription lookup timeout is implemented with
 * `Promise.race` against a `setTimeout` sentinel, matching the pattern in
 * `lib/gen/loadOrder.ts` (Req 16.6, 20.5).
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest";
import {
  getLullabyFormSchema,
  checkVoiceCloneDenylist,
} from "@/lib/forms/lullaby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 5_000;
const ELIGIBLE_STATUSES = new Set(["active", "trialing"]);

/**
 * Race a promise against a wall-clock timeout. Rejects with a sentinel
 * Error("subscription_lookup_timeout") when the timeout fires first.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(
      () => reject(new Error("subscription_lookup_timeout")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

export async function POST(req: Request) {
  // 1. Authenticate: require a valid Supabase session.
  const supabaseClient = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parentEmail = user.email;

  // 2. Parse + validate the JSON body.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let schema;
  try {
    schema = getLullabyFormSchema();
  } catch {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Req 21.2: reject voice-clone fields before schema validation.
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const denylistError = checkVoiceCloneDenylist(
      raw as Record<string, unknown>,
    );
    if (denylistError) {
      return NextResponse.json({ error: denylistError }, { status: 400 });
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_failed",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const form = parsed.data;

  // 3. Look up the subscription for this parent with a 5-second timeout
  //    (Req 16.6, 20.5). We look up by parent_email (citext, case-insensitive).
  const supabase = getSupabaseAdmin();

  let subRow: { stripe_subscription_id: string; status: string } | null = null;
  try {
    const lookupPromise = supabase
      .from("subscriptions")
      .select("stripe_subscription_id, status")
      .eq("parent_email", parentEmail)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const result = await withTimeout(
      Promise.resolve(lookupPromise),
      SUBSCRIPTION_LOOKUP_TIMEOUT_MS,
    );

    if (result.error) {
      // DB error during lookup — treat as verification failure (Req 20.5).
      return NextResponse.json(
        {
          error: "subscription_lookup_failed",
          hint: "Please try again in a moment.",
        },
        { status: 503 },
      );
    }

    subRow = result.data as { stripe_subscription_id: string; status: string } | null;
  } catch (err) {
    if ((err as Error).message === "subscription_lookup_timeout") {
      // Req 16.6: lookup timed out → 503 with retry hint.
      return NextResponse.json(
        {
          error: "subscription_lookup_timeout",
          hint: "Subscription status could not be verified in time. Please try again.",
        },
        { status: 503 },
      );
    }
    // Any other unexpected error.
    return NextResponse.json(
      {
        error: "subscription_lookup_failed",
        hint: "Please try again in a moment.",
      },
      { status: 503 },
    );
  }

  // Missing subscription row or lapsed status → 403 (Req 16.3, 20.3).
  if (!subRow) {
    return NextResponse.json(
      { error: "no_active_subscription", message: "resubscribe to continue" },
      { status: 403 },
    );
  }

  if (!ELIGIBLE_STATUSES.has(subRow.status)) {
    return NextResponse.json(
      { error: "subscription_lapsed", message: "resubscribe to continue" },
      { status: 403 },
    );
  }

  // 4. Insert the orders row with sku='subscription' (Req 20.1, 20.2).
  //    No generation_jobs row is created here — the Inngest function's
  //    load-order step creates it after re-verifying the subscription gate
  //    (design §6, "Never create a generation_jobs row before gating passes").
  const orderId = randomUUID();

  const { error: insertError } = await supabase.from("orders").insert({
    id: orderId,
    stripe_checkout_session_id: null, // subscription-funded; no checkout session
    stripe_subscription_id: subRow.stripe_subscription_id,
    parent_email: parentEmail,
    child_name: form.child_name,
    child_age: form.child_age,
    favorites: form.favorites,
    mood: form.mood,
    language: form.language,
    narrator_voice_id: form.narrator_voice_id,
    from_name: form.from_name ?? null,
    sku: "subscription",
  });

  if (insertError) {
    return NextResponse.json(
      { error: "order_creation_failed" },
      { status: 500 },
    );
  }

  // 5. Dispatch the Inngest generation event (Req 16.2, 20.2).
  //    The Inngest function will re-verify the subscription gate in its
  //    load-order step before creating the generation_jobs row.
  await inngest.send({
    name: "lullaby/generate.requested",
    data: { order_id: orderId },
  });

  // 6. Return 202 with the new order id (design §3.2 API Surface – Library).
  return NextResponse.json({ order_id: orderId }, { status: 202 });
}
