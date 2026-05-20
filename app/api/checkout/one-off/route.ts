/**
 * POST /api/checkout/one-off — One-off Stripe Checkout (Req 4.1–4.6, design §3.2).
 *
 * Accepts the full form payload (same shape the client sent into validation
 * via `lib/forms/lullaby.ts`), re-validates it server-side with the same zod
 * schema, and creates a Stripe Checkout session in `payment` mode for
 * `STRIPE_PRICE_ONE_OFF`.
 *
 * Order of operations
 * -------------------
 * 1. Validate JSON body with `getLullabyFormSchema()`.
 * 2. Confirm `STRIPE_PRICE_ONE_OFF` is set; if not, return 503.
 * 3. Generate a fresh `order_id` (uuid) so we can interpolate it into
 *    `success_url` *before* creating the Stripe session.
 * 4. Call `stripe.checkout.sessions.create({ ... })` with the order id baked
 *    into the success URL and metadata, plus all form fields trimmed to
 *    ≤500 chars each (Req 4.3).
 * 5. Insert the `orders` row keyed on the same `order_id`, with
 *    `sku='one_off'` and `stripe_checkout_session_id=session.id`. If this
 *    insert fails, return a non-PII 502 — Stripe's unused session simply
 *    times out, which keeps the system in a clean state.
 * 6. Return `200 { session_url }`.
 *
 * The 10-second per-call Stripe timeout is enforced by `getStripe()` so a
 * stalled API call still returns within Req 4.1's 3-second SLO comfortably
 * in the happy path; on timeout we respond 502.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getLullabyFormSchema, checkVoiceCloneDenylist } from "@/lib/forms/lullaby";
import {
  buildCheckoutMetadata,
  buildCheckoutUrls,
  CHECKOUT_FAILED_BODY,
} from "@/lib/checkout";

// Run on the Node.js runtime (Stripe SDK + Supabase node client both need it).
export const runtime = "nodejs";

export async function POST(req: Request) {
  // 1. Parse + validate the JSON body.
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
    // Misconfigured ELEVENLABS_VOICE_IDS — surfaces as "voices unavailable"
    // on the form, but if the client somehow posted anyway we treat the
    // server config as the failing component (Req 4.6 sibling: 503 on env).
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
    // Non-PII validation issues only: just the field path + zod's message.
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

  // 2. Env presence: STRIPE_PRICE_ONE_OFF is `.optional()` in env validation.
  // Recheck here so a missing price degrades to 503 (Req 1.4 sibling: SKU
  // unavailable) rather than a Stripe 400 with a confusing message.
  let env;
  try {
    env = getServerEnv();
  } catch {
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 503 });
  }
  if (!env.STRIPE_PRICE_ONE_OFF) {
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 503 });
  }

  // 3. Generate order id up front so success_url and metadata both reference it.
  const orderId = randomUUID();
  const { success_url, cancel_url } = buildCheckoutUrls(
    env.NEXT_PUBLIC_APP_URL,
    orderId,
  );
  const metadata = buildCheckoutMetadata(form, orderId);

  // 4. Create the Stripe Checkout session.
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: env.STRIPE_PRICE_ONE_OFF, quantity: 1 }],
      customer_email: form.parent_email,
      client_reference_id: orderId,
      metadata,
      success_url,
      cancel_url,
    });
  } catch {
    // Non-PII 502 — the client preserves form state and lets the parent retry.
    return NextResponse.json(CHECKOUT_FAILED_BODY, { status: 502 });
  }

  if (!session.url) {
    return NextResponse.json(CHECKOUT_FAILED_BODY, { status: 502 });
  }

  // 5. Persist the `orders` row keyed on the same id (Req 4.1 — pending order
  // linked to the session). If this insert fails, the unused Stripe session
  // expires harmlessly and we return 502; the client keeps the form state.
  const supabase = getSupabaseAdmin();
  const { error: insertError } = await supabase.from("orders").insert({
    id: orderId,
    stripe_checkout_session_id: session.id,
    parent_email: form.parent_email,
    child_name: form.child_name,
    child_age: form.child_age,
    favorites: form.favorites,
    mood: form.mood,
    language: form.language,
    narrator_voice_id: form.narrator_voice_id,
    from_name: form.from_name ?? null,
    sku: "one_off",
  });
  if (insertError) {
    return NextResponse.json(CHECKOUT_FAILED_BODY, { status: 502 });
  }

  // 6. Return the session URL — the client redirects via window.location.
  return NextResponse.json({ session_url: session.url }, { status: 200 });
}
