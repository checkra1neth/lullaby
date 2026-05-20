/**
 * POST /api/stripe/webhook — Stripe webhook (Req 5.6, 6.1–6.5, 7.1, 19.1).
 *
 * Design §2 (sequence diagram), §3.2 (API surface – Webhook), §6 (generation
 * pipeline trigger).
 *
 * Order of operations
 * -------------------
 *  1. Read raw body via `await req.text()`. Read the `Stripe-Signature` header.
 *     If either is missing, return 400 with no DB write (Req 6.2).
 *  2. Verify the signature using `stripe.webhooks.constructEvent(body, sig,
 *     STRIPE_WEBHOOK_SECRET)`. On failure, return 400 with no DB write.
 *  3. INSERT the event id into `stripe_events ON CONFLICT DO NOTHING
 *     RETURNING event_id`. If zero rows came back, the event is a duplicate
 *     replay — return 200 immediately (Req 6.4).
 *  4. Dispatch by event type:
 *      - `checkout.session.completed` (mode=payment): UPSERT the `orders`
 *        row from session metadata as a safety net (the checkout endpoint
 *        already inserted it; the upsert is no-op when the row exists),
 *        ensure a `generation_jobs(order_id, status='queued')` row exists,
 *        and `inngest.send("lullaby/generate.requested", {data:{order_id}})`.
 *      - `customer.subscription.created|updated`: UPSERT `subscriptions`
 *        keyed on `stripe_subscription_id`.
 *      - `customer.subscription.deleted`: UPDATE existing `subscriptions`
 *        row to status=`canceled`. Per Req 5.5, if no row exists, do not
 *        create one — just ignore.
 *      - Any other event type: ignore (the dedupe row is already written).
 *  5. Return 200 in all valid-signature cases (Req 7.1, non-blocking).
 *
 * Failure semantics
 *  - All side-effect failures are logged via `console.error` (no PII —
 *    `lib/log.ts` redactor lands in Task 12). The handler still returns 200
 *    to Stripe so the event isn't retried into a hot loop; Inngest is the
 *    durable retry surface for the actual generation. The `stripe_events`
 *    row prevents re-dispatch when Stripe DOES retry on its own.
 *
 * Runtime: nodejs (Stripe SDK + Supabase + raw body all need it).
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getServerEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest";
import { parseFavoritesMetadata } from "@/lib/checkout";

export const runtime = "nodejs";
// Force Next.js to never cache or pre-render this route.
export const dynamic = "force-dynamic";

const SIGNATURE_HEADER = "stripe-signature";

const SUBSCRIPTION_STATUSES = new Set([
  "incomplete",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
] as const);

type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES extends Set<infer T>
  ? T
  : never;

function normalizeSubscriptionStatus(value: string): SubscriptionStatus {
  // Stripe also fires `incomplete_expired` and `paused`, neither of which our
  // CHECK constraint accepts. Map them to safe equivalents so the upsert still
  // lands instead of crashing the webhook.
  if (value === "incomplete_expired") return "incomplete";
  if (value === "paused") return "past_due";
  if ((SUBSCRIPTION_STATUSES as Set<string>).has(value)) {
    return value as SubscriptionStatus;
  }
  return "incomplete";
}

export async function POST(req: Request) {
  // 1. Capture the raw body + signature header.
  const sig = req.headers.get(SIGNATURE_HEADER);
  if (!sig) {
    // Req 6.2: missing signature → 400, no DB write, no downstream dispatch.
    return new NextResponse("missing signature", { status: 400 });
  }
  const body = await req.text();

  // 2. Verify signature.
  let env;
  try {
    env = getServerEnv();
  } catch {
    // Misconfigured env → behave like an invalid request without leaking
    // details. Req 4.6 guarantees the boot guard catches live keys earlier.
    return new NextResponse("misconfigured", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    // Req 5.6 / 6.2: invalid signature → 400, no DB write.
    return new NextResponse("invalid signature", { status: 400 });
  }

  // 3. Idempotency: insert before any side effects (Req 6.3, 6.4).
  const supabase = getSupabaseAdmin();
  const { data: inserted, error: insertError } = await supabase
    .from("stripe_events")
    .insert({ event_id: event.id, type: event.type })
    .select("event_id");

  if (insertError) {
    // 23505 = unique_violation (Postgres) — the event was already processed.
    // Treat as idempotent skip (Req 6.4).
    const code = (insertError as { code?: string }).code;
    if (code === "23505") {
      return new NextResponse("", { status: 200 });
    }
    // Any other DB error: log and return 500 so Stripe retries the event.
    console.error("stripe_events insert failed", {
      event_id: event.id,
      type: event.type,
      code,
    });
    return new NextResponse("internal error", { status: 500 });
  }

  if (!inserted || inserted.length === 0) {
    // No row inserted (no error path covered above shouldn't happen, but
    // honor the "zero rows → duplicate" contract for safety). Req 6.4.
    return new NextResponse("", { status: 200 });
  }

  // 4. Dispatch by event type. Any failure here logs without blocking the
  // 200 we owe Stripe — Inngest is the durable retry surface.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") {
          await handleCheckoutSessionCompleted(session);
        }
        // Subscription-mode sessions don't create orders here — the
        // `customer.subscription.created` event populates `subscriptions`.
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertSubscriptionFromEvent(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await markSubscriptionDeleted(subscription);
        break;
      }
      default:
        // Other events are deduped via stripe_events but otherwise ignored.
        break;
    }
  } catch (err) {
    // Log without leaking — the handler still returns 200 (Req 7.1, non-
    // blocking response). Subsequent retries from Stripe are deduped by the
    // already-inserted stripe_events row, so a transient downstream failure
    // does NOT cause repeat side effects on later attempts.
    console.error("webhook dispatch failed", {
      event_id: event.id,
      type: event.type,
      message: (err as Error).message,
    });
  }

  // 5. Always 200 on valid signature (Req 7.1).
  return new NextResponse("", { status: 200 });
}

/**
 * Handle a `checkout.session.completed` event in `mode=payment`.
 *
 * The one-off checkout endpoint already inserted the `orders` row before
 * redirecting (Task 6). This handler is the safety net: if for any reason
 * the row is missing (the checkout DB insert failed mid-flight, or the
 * session was created out-of-band) we reconstruct it from `session.metadata`
 * + `customer_email`. The UNIQUE on `orders.stripe_checkout_session_id`
 * (design §4, Req 19.1) makes this insert idempotent across webhook retries.
 *
 * Then we ensure a `generation_jobs` row with `status='queued'` exists
 * (UNIQUE on `order_id` enforces idempotency), and dispatch the Inngest
 * event that the stub `generateLullaby` listens for.
 */
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  // First, look up an existing order by session id (the happy path).
  const { data: existing, error: lookupError } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`orders lookup failed: ${lookupError.message}`);
  }

  let orderId: string;
  if (existing?.id) {
    orderId = existing.id as string;
  } else {
    // Safety net: reconstruct from metadata. The checkout endpoint set every
    // form field there via `buildCheckoutMetadata` (Task 6), and the metadata
    // `order_id` is the row id we'd have used. The DB CHECK constraints will
    // reject malformed rows so we don't need to re-validate here aggressively.
    const md = session.metadata ?? {};
    const metadataOrderId = (md.order_id ?? "").trim();
    if (!metadataOrderId) {
      throw new Error("checkout.session.completed: missing order_id metadata");
    }
    const favorites = parseFavoritesMetadata(md.favorites);
    if (favorites.length === 0) {
      throw new Error(
        "checkout.session.completed: missing favorites metadata",
      );
    }
    const childAge = Number(md.child_age);
    if (!Number.isInteger(childAge)) {
      throw new Error("checkout.session.completed: invalid child_age");
    }

    const parentEmail =
      session.customer_email ??
      md.parent_email ??
      session.customer_details?.email ??
      null;
    if (!parentEmail) {
      throw new Error(
        "checkout.session.completed: missing parent_email",
      );
    }

    const insertRow = {
      id: metadataOrderId,
      stripe_checkout_session_id: session.id,
      parent_email: parentEmail,
      child_name: md.child_name ?? "",
      child_age: childAge,
      favorites,
      mood: md.mood ?? "calm",
      language: md.language ?? "en",
      narrator_voice_id: md.narrator_voice_id ?? "",
      from_name: md.from_name ?? null,
      sku: "one_off" as const,
    };

    // UPSERT keyed on the unique stripe_checkout_session_id so retried
    // webhooks (or a race with the checkout endpoint) converge on a single
    // row (Req 19.1).
    const { data: upserted, error: upsertError } = await supabase
      .from("orders")
      .upsert(insertRow, {
        onConflict: "stripe_checkout_session_id",
        ignoreDuplicates: false,
      })
      .select("id")
      .single();
    if (upsertError) {
      throw new Error(`orders upsert failed: ${upsertError.message}`);
    }
    orderId = upserted.id as string;
  }

  // Ensure a generation_jobs row exists. UNIQUE(order_id) makes this safe to
  // call repeatedly across webhook retries.
  const { error: jobError } = await supabase
    .from("generation_jobs")
    .upsert(
      { order_id: orderId, status: "queued" },
      { onConflict: "order_id", ignoreDuplicates: true },
    );
  if (jobError) {
    throw new Error(`generation_jobs upsert failed: ${jobError.message}`);
  }

  // Dispatch the Inngest event. The stub `generateLullaby` flips the job
  // through running → succeeded after a 5 s sleep.
  await inngest.send({
    name: "lullaby/generate.requested",
    data: { order_id: orderId },
  });
}

/**
 * UPSERT a `subscriptions` row from a `customer.subscription.created` or
 * `.updated` event (Req 5.2, 5.3).
 *
 * The `subscriptions.parent_email` column is NOT NULL. Resolution order:
 *   1. Existing row's parent_email (preserved on UPDATE).
 *   2. The expanded customer's `email` field on the subscription, when
 *      Stripe expanded it.
 *   3. A `customers.retrieve(customer_id)` call as a last resort.
 *
 * If we still can't resolve an email (rare; would require a customer with no
 * email and no prior row), we abort the upsert without throwing — the row
 * will be created when the customer eventually receives a delivery email.
 */
async function upsertSubscriptionFromEvent(
  subscription: Stripe.Subscription,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // Try to read the existing row first to preserve parent_email.
  const { data: existing, error: lookupError } = await supabase
    .from("subscriptions")
    .select("parent_email")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`subscriptions lookup failed: ${lookupError.message}`);
  }

  let parentEmail: string | null = (existing?.parent_email as string) ?? null;
  if (!parentEmail) {
    parentEmail = await resolveCustomerEmail(subscription.customer, customerId);
  }
  if (!parentEmail) {
    // Can't honor the NOT NULL constraint — log and skip. The next event for
    // this subscription will retry resolution.
    console.warn("subscription event without resolvable email", {
      subscription_id: subscription.id,
    });
    return;
  }

  const status = normalizeSubscriptionStatus(subscription.status);
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error: upsertError } = await supabase.from("subscriptions").upsert(
    {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      parent_email: parentEmail,
      status,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  if (upsertError) {
    throw new Error(`subscriptions upsert failed: ${upsertError.message}`);
  }
}

/**
 * Handle `customer.subscription.deleted`. Per Req 5.5, only update the row
 * if it already exists — never create one from a delete event.
 */
async function markSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const status = normalizeSubscriptionStatus(subscription.status || "canceled");
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from("subscriptions")
    .update({
      // Stripe's deleted event carries the subscription's terminal status
      // (typically "canceled"); honor it rather than hard-coding.
      status,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);
  if (error) {
    throw new Error(`subscriptions delete-update failed: ${error.message}`);
  }
}

/**
 * Resolve a customer email from a possibly-expanded Stripe customer field,
 * falling back to a `customers.retrieve` call. Returns null if the customer
 * exists but has no email (rare).
 */
async function resolveCustomerEmail(
  customer: Stripe.Subscription["customer"],
  customerId: string,
): Promise<string | null> {
  if (typeof customer !== "string") {
    if ("deleted" in customer && customer.deleted) {
      return null;
    }
    const expanded = customer as Stripe.Customer;
    if (expanded.email) return expanded.email;
  }
  try {
    const fetched = await getStripe().customers.retrieve(customerId);
    if ("deleted" in fetched && fetched.deleted) return null;
    return (fetched as Stripe.Customer).email ?? null;
  } catch {
    return null;
  }
}
