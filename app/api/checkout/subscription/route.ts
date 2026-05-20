/**
 * POST /api/checkout/subscription — Subscription Stripe Checkout
 * (Req 5.1, 5.4, 4.6, design §3.2 API Surface – Checkout).
 *
 * Mirrors the one-off route but with `mode: "subscription"` and
 * `STRIPE_PRICE_SUBSCRIPTION`. The form posts the same payload shape so the
 * client can use a single submit handler; we re-validate it server-side.
 *
 * Per design §3.1 Order_Service, subscription-funded `orders` rows are
 * created later by the webhook + library regen path (Tasks 7 / 25). This
 * route therefore does NOT insert an `orders` row — it simply creates the
 * Stripe Checkout session and returns the URL. The webhook handler creates
 * the `subscriptions` row when `customer.subscription.created` arrives.
 *
 * Failure modes match the one-off route: 400 validation, 503 missing env,
 * 502 on any Stripe failure (non-PII).
 */
import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { getLullabyFormSchema, checkVoiceCloneDenylist } from "@/lib/forms/lullaby";
import {
  buildCheckoutMetadata,
  CHECKOUT_FAILED_BODY,
} from "@/lib/checkout";

export const runtime = "nodejs";

export async function POST(req: Request) {
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
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 503 });
  }

  // Req 21.2: reject voice-clone fields before schema validation (zod strips
  // unknown keys, so we must check the raw payload).
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const denylistError = checkVoiceCloneDenylist(raw as Record<string, unknown>);
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

  let env;
  try {
    env = getServerEnv();
  } catch {
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 503 });
  }
  if (!env.STRIPE_PRICE_SUBSCRIPTION) {
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 503 });
  }

  // Subscription path doesn't pre-insert an `orders` row, but we still pass
  // the form metadata through for observability — the webhook (Task 7) reads
  // metadata.parent_email to reconcile subscription events without relying
  // solely on the customer email Stripe records on its side.
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  // We don't have an order id yet; use the special Stripe placeholder so the
  // success URL still lands on a usable page (the library is created later;
  // for now the parent gets back to /create after subscribing).
  const success_url = `${base}/library?session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = `${base}/create`;
  // Metadata uses a synthetic order id ("subscription-checkout") since no
  // orders row exists yet; the webhook keys subscription events on
  // stripe_subscription_id, not on this metadata field.
  const metadata = buildCheckoutMetadata(form, "subscription-checkout");

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: env.STRIPE_PRICE_SUBSCRIPTION, quantity: 1 }],
      customer_email: form.parent_email,
      metadata,
      success_url,
      cancel_url,
    });
  } catch {
    return NextResponse.json(CHECKOUT_FAILED_BODY, { status: 502 });
  }

  if (!session.url) {
    return NextResponse.json(CHECKOUT_FAILED_BODY, { status: 502 });
  }

  return NextResponse.json({ session_url: session.url }, { status: 200 });
}
