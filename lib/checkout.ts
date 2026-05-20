/**
 * Shared helpers for the Stripe Checkout endpoints (Task 6, design §3.1
 * Order_Service, §3.2 API Surface – Checkout).
 *
 * Centralizes:
 *  - Building the Stripe `metadata` payload from a validated form (Req 4.3
 *    — every value ≤500 chars, never PII-leaking via odd shapes).
 *  - Generating the `success_url` / `cancel_url` pair the design mandates.
 *  - Producing the non-PII 502 error response (Req 4.5).
 *  - Re-validating the form payload server-side using the same zod schema
 *    the client uses (Req 2 + Task 5 contract).
 */
import type { LullabyFormValues } from "@/lib/forms/lullaby";

/**
 * Stripe enforces a 500-char ceiling on each metadata value. The form already
 * caps name fields at 40, favorites at 30 each, etc., so the only realistic
 * overflow is the joined `favorites` array if all three slots are at max
 * length (3 × 30 + 2 separators = 92 chars). We still trim defensively here
 * so the helper is safe for any input. (Req 4.3)
 */
const STRIPE_METADATA_MAX = 500;

function clip(value: string): string {
  if (value.length <= STRIPE_METADATA_MAX) return value;
  return value.slice(0, STRIPE_METADATA_MAX);
}

/**
 * Build the Stripe Checkout `metadata` map from a validated form payload.
 *
 * `favorites` is an array of 1–3 trimmed strings; we join them with newlines
 * which preserves order and is trivially round-trippable from the webhook
 * handler (`metadata.favorites.split("\n")`). Optional `from_name` is omitted
 * entirely when absent so the webhook doesn't see literal "undefined".
 *
 * The `order_id` is included so the webhook (Task 7) can correlate a
 * `checkout.session.completed` event to the `orders` row we already inserted
 * even if `client_reference_id` is unset for any reason.
 */
export function buildCheckoutMetadata(
  form: LullabyFormValues,
  orderId: string,
): Record<string, string> {
  const md: Record<string, string> = {
    order_id: clip(orderId),
    child_name: clip(form.child_name),
    child_age: clip(String(form.child_age)),
    favorites: clip(form.favorites.join("\n")),
    mood: clip(form.mood),
    language: clip(form.language),
    narrator_voice_id: clip(form.narrator_voice_id),
    parent_email: clip(form.parent_email),
  };
  if (form.from_name) {
    md.from_name = clip(form.from_name);
  }
  return md;
}

/**
 * Build the Checkout `success_url` for a freshly-inserted order row.
 *
 * Per Task 6: `${NEXT_PUBLIC_APP_URL}/orders/{ORDER_ID}?session_id={CHECKOUT_SESSION_ID}`
 * — `{ORDER_ID}` is interpolated server-side, `{CHECKOUT_SESSION_ID}` is the
 * literal placeholder Stripe substitutes when redirecting (uppercase, in
 * curly braces). The cancel_url returns the parent to the form so they can
 * retry without losing data (the client preserves form state too, Req 4.5).
 */
export function buildCheckoutUrls(appUrl: string, orderId: string): {
  success_url: string;
  cancel_url: string;
} {
  const base = appUrl.replace(/\/+$/, "");
  return {
    success_url: `${base}/orders/${orderId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/create`,
  };
}

/**
 * Standard non-PII 502 error body returned when Stripe API calls fail.
 * Req 4.5 / 5.4: error message must not leak PII; the client preserves form
 * state and surfaces a generic retry prompt.
 */
export const CHECKOUT_FAILED_BODY = { error: "checkout_failed" } as const;

/**
 * Round-trip the `favorites` field that `buildCheckoutMetadata` packs into
 * Stripe `metadata` as a `\n`-joined string. The webhook handler (Task 7)
 * uses this to reconstruct the array when an `orders` row has to be inserted
 * from session metadata as a safety net.
 *
 * Behavior:
 *  - `undefined` / `null` / empty string → `[]`
 *  - splits on newlines, trims each part, drops empties so a stray trailing
 *    newline doesn't produce a `""` entry
 *
 * The DB CHECK on `orders.favorites` requires `1..3` entries, so the caller
 * is responsible for handling a `[]` return (the form schema also rejects it
 * upstream).
 */
export function parseFavoritesMetadata(
  value: string | undefined | null,
): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
