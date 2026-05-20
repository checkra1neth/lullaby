/**
 * Edge middleware: issue the OQ-7 fresh-checkout access cookie when the
 * parent is redirected back from Stripe Checkout to
 * `/orders/[order_id]?session_id=...`.
 *
 * Design §12 OQ-7 / §3.2 API Surface – Delivery; requirements §13 AC-7
 * (Task 10). Without this cookie the parent would have to wait for a
 * magic-link email to view their lullaby — the demo flow stalls right
 * after Stripe success. With it, the delivery page authorizes the
 * polling status calls immediately on first paint.
 *
 * Why middleware
 * --------------
 * The `/orders/[order_id]/page.tsx` server component cannot reliably set
 * cookies during render. A Route Handler at the same path collides with
 * `page.tsx`. Middleware runs *before* the page renders and can set
 * cookies on the outgoing response without rerouting. The downside is
 * the Edge runtime: the Stripe Node SDK uses `https.request` (not
 * available on Edge), so we hit the Stripe REST API directly with
 * `fetch` instead.
 *
 * What we verify
 * --------------
 * Before signing the cookie we must be sure the redirect is legitimate.
 * The session is fetched from Stripe, then we check:
 *
 *   1. `client_reference_id === order_id`  (set by Task 6 checkout route)
 *   2. `metadata.order_id === order_id`    (defense in depth)
 *   3. `payment_status === "paid"` OR `status === "complete"`
 *      (treat both shapes as "the parent actually paid")
 *
 * Only when all three pass do we sign and set the cookie. Anything else
 * — invalid session id, mismatched order, unpaid session — we silently
 * fall through without setting the cookie. The page then renders as
 * usual; if the parent isn't signed in either, the status endpoint will
 * return 403 and the polling UI will show the empty progress state.
 *
 * Idempotency
 * -----------
 * The Stripe success URL keeps `?session_id=...` in the address bar after
 * the page loads. To avoid hitting Stripe on every refresh we short-circuit
 * when the request already carries a valid `lullaby_order_access` cookie
 * for this `order_id`.
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  FRESH_CHECKOUT_COOKIE_MAX_AGE,
  FRESH_CHECKOUT_COOKIE_NAME,
  signOrderToken,
  verifyOrderToken,
} from "@/lib/auth/freshCheckout";

/**
 * RFC 4122 v1–v5 / variant 1 — same shape Postgres accepts for `orders.id`
 * and what the page's UUID guard uses. We re-validate here so a tampered
 * URL never reaches Stripe with a non-UUID `order_id` candidate.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Path matcher: only orders pages, never the API or other routes. */
export const config = {
  matcher: ["/orders/:order_id*"],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, searchParams } = req.nextUrl;
  const sessionId = searchParams.get("session_id");

  // Extract the `order_id` from the path. Pattern: `/orders/<id>` (optionally
  // with a trailing path segment we don't care about).
  const match = pathname.match(/^\/orders\/([^/]+)/);
  if (!match) return NextResponse.next();

  const orderId = match[1];
  if (!UUID_REGEX.test(orderId)) return NextResponse.next();

  // Nothing to do without a Stripe session id in the query string.
  if (!sessionId) return NextResponse.next();

  // Idempotency: if the cookie already authorizes this order, skip the
  // Stripe round trip entirely.
  const existing = req.cookies.get(FRESH_CHECKOUT_COOKIE_NAME)?.value;
  if (existing) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (secret) {
      const verified = await verifyOrderToken(existing, secret);
      if (verified === orderId) return NextResponse.next();
    }
  }

  // Validate the session against Stripe's REST API. We use `fetch` rather
  // than the Stripe Node SDK because the SDK relies on `https.request`,
  // which is not available in the Edge runtime.
  const validated = await validateStripeSession(sessionId, orderId);
  if (!validated) return NextResponse.next();

  // Sign and set the cookie. Build the response *before* setting cookies so
  // the cookie attaches to the same response we forward.
  const res = NextResponse.next();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res; // Cannot sign — fall through silently.

  let token: string;
  try {
    token = await signOrderToken(orderId, secret);
  } catch {
    return res;
  }

  res.cookies.set(FRESH_CHECKOUT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FRESH_CHECKOUT_COOKIE_MAX_AGE,
  });
  return res;
}

/**
 * Hit `GET https://api.stripe.com/v1/checkout/sessions/{session_id}` and
 * decide whether the session legitimately belongs to `orderId` and was
 * actually paid. Returns `true` only on a clean match.
 *
 * Any error path (network, non-2xx, malformed JSON, mismatched order id,
 * unpaid session) returns `false`. We do not log the failure here —
 * middleware runs on every request, so noisy logs would dwarf the signal.
 */
async function validateStripeSession(
  sessionId: string,
  orderId: string,
): Promise<boolean> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return false;

  // Defensive shape check — the value comes straight from a query string.
  // Stripe checkout session ids look like `cs_test_...` / `cs_live_...`.
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;

  let res: Response;
  try {
    res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          // Pin the API version so an upstream rev doesn't change the
          // shape we read below.
          "Stripe-Version": "2025-02-24.acacia",
        },
        // Edge fetch has no per-call timeout knob; the runtime caps it at
        // a few seconds anyway, which is fine for this UX-only path.
        cache: "no-store",
      },
    );
  } catch {
    return false;
  }

  if (!res.ok) return false;

  let body: {
    client_reference_id?: string | null;
    metadata?: Record<string, string> | null;
    payment_status?: string | null;
    status?: string | null;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return false;
  }

  if (body.client_reference_id !== orderId) return false;
  if (body.metadata?.order_id !== orderId) return false;

  // Stripe test card 4242 4242 4242 4242 marks the session `payment_status`
  // = "paid" and `status` = "complete". Accept either signal so we tolerate
  // small differences across Stripe API versions.
  const paid =
    body.payment_status === "paid" ||
    body.payment_status === "no_payment_required" ||
    body.status === "complete";
  if (!paid) return false;

  return true;
}
