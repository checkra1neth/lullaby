/**
 * Fresh-checkout cookie (Task 10, design §12 OQ-7 / §3.2 API Surface –
 * Delivery; requirements §13 Acceptance Criterion 7).
 *
 * After a parent is redirected back from Stripe Checkout to
 * `/orders/[order_id]?session_id=...` the app sets a signed, HttpOnly
 * cookie named `lullaby_order_access` whose value is `${order_id}.${hmac}`.
 * It is the alternative to a Supabase Auth session for authorizing
 * delivery-page reads of that one order — the parent does not have to wait
 * for a magic-link email to see their lullaby.
 *
 * Signing
 * -------
 * `${order_id}.${base64url(HMAC-SHA-256(secret, order_id))}`. We use
 * `STRIPE_WEBHOOK_SECRET` as the HMAC key — it's already env-validated
 * (Task 2) and we want to avoid adding a new env var during the hackathon.
 *
 *   PRODUCTION NOTE: a dedicated `LULLABY_COOKIE_SECRET` would be cleaner.
 *   Reusing the Stripe webhook secret means rotating it invalidates every
 *   in-flight delivery cookie. That's acceptable for the demo; revisit
 *   before going live.
 *
 * Web Crypto (`crypto.subtle`) is used for signing/verification so the
 * helpers run unchanged in both the Node.js runtime (route handlers) and
 * the Edge runtime (middleware). This is why `getFreshCheckoutOrderId` and
 * `setFreshCheckoutCookie` are async — Web Crypto is promise-based.
 *
 * Server-only: `next/headers` cookies() is imported here for the read path.
 * The middleware writes via `NextResponse.cookies.set` directly.
 */
import { cookies } from "next/headers";

/** Cookie name shared by the read path (status route) and write path (middleware). */
export const FRESH_CHECKOUT_COOKIE_NAME = "lullaby_order_access";

/** 24-hour lifetime per design §12 OQ-7 / requirements §13 AC-7. */
export const FRESH_CHECKOUT_COOKIE_MAX_AGE = 86_400;

/**
 * Cookie attributes the middleware and any other writer should use. Centralized
 * here so the read-side (status route) can rely on the exact contract.
 *
 * - `httpOnly`: not readable from JS — prevents XSS exfil.
 * - `sameSite: "lax"`: the cookie must travel on the top-level navigation
 *   from `checkout.stripe.com` back to our domain (cross-site GET → "lax"
 *   is the minimum that allows it). "strict" would block the redirect.
 * - `secure`: only on HTTPS in production. In dev we run on `http://localhost`
 *   so we leave it off when `NODE_ENV !== "production"`.
 * - `path: "/"`: the cookie is read by the status endpoint
 *   (`/api/orders/...`) which lives outside `/orders/...`, so we cannot
 *   scope it to `/orders/`.
 */
export const FRESH_CHECKOUT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: FRESH_CHECKOUT_COOKIE_MAX_AGE,
};

// ---------------------------------------------------------------------------
// HMAC primitives — public so tests can exercise them in isolation.
// ---------------------------------------------------------------------------

/** Base64url-encode an `ArrayBuffer` (no padding, `+/` → `-_`). */
function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // `btoa` is available in both Node 18+ and the Edge runtime.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(secret: string, payload: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return crypto.subtle.sign("HMAC", key, enc.encode(payload));
}

/**
 * Constant-time string comparison so signature checks don't leak through
 * timing. Both inputs must be the same length to return true.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Sign an `order_id` with `secret` and return the cookie token
 * `${order_id}.${base64url_hmac}`. Pure async function; no env access.
 */
export async function signOrderToken(
  orderId: string,
  secret: string,
): Promise<string> {
  const sig = await hmacSha256(secret, orderId);
  return `${orderId}.${base64UrlEncode(sig)}`;
}

/**
 * Verify a cookie token against `secret`. Returns the embedded `order_id` on
 * success, or `null` for any failure mode (missing/empty/malformed token,
 * tampered signature, crypto error). Never throws.
 */
export async function verifyOrderToken(
  token: string | undefined | null,
  secret: string,
): Promise<string | null> {
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Use lastIndexOf so a stray dot inside an order id (shouldn't happen for
  // UUIDs, but be defensive) wouldn't split the wrong way.
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot >= trimmed.length - 1) return null;

  const orderId = trimmed.slice(0, dot);
  const provided = trimmed.slice(dot + 1);
  if (!orderId || !provided) return null;

  let expected: string;
  try {
    const sig = await hmacSha256(secret, orderId);
    expected = base64UrlEncode(sig);
  } catch {
    return null;
  }

  return constantTimeEqual(provided, expected) ? orderId : null;
}

// ---------------------------------------------------------------------------
// High-level helpers wired to the env + Next.js cookie store.
// ---------------------------------------------------------------------------

/**
 * Resolve the secret used to sign/verify the cookie. Throws when
 * `STRIPE_WEBHOOK_SECRET` is unset. Read directly from `process.env` (rather
 * than `getServerEnv()`) so this module is safe to import from middleware,
 * which runs in the Edge runtime and must avoid the heavier env validator.
 */
function getFreshCheckoutSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "freshCheckout: STRIPE_WEBHOOK_SECRET must be set to sign/verify the access cookie",
    );
  }
  return secret;
}

/**
 * Read the fresh-checkout cookie from the current request and verify its
 * signature. Returns the embedded `order_id` on success, `null` on missing,
 * empty, malformed, or tampered values.
 *
 * Async because Web Crypto's HMAC API returns a `Promise`.
 */
export async function getFreshCheckoutOrderId(): Promise<string | null> {
  const value = cookies().get(FRESH_CHECKOUT_COOKIE_NAME)?.value;
  if (!value) return null;
  let secret: string;
  try {
    secret = getFreshCheckoutSecret();
  } catch {
    // Without a secret we cannot verify anything. Fail closed.
    return null;
  }
  return verifyOrderToken(value, secret);
}

/**
 * Minimal cookie-store contract — both `next/headers` `cookies()` and
 * `NextResponse.cookies` satisfy this shape. Kept narrow on purpose so the
 * helper is portable across runtimes.
 */
export interface CookieStoreLike {
  set(
    name: string,
    value: string,
    options: typeof FRESH_CHECKOUT_COOKIE_OPTIONS,
  ): unknown;
}

/**
 * Sign an `order_id` and write it into the supplied cookie store with the
 * standard `lullaby_order_access` attributes. Use from a Route Handler or
 * Server Action — middleware uses `NextResponse.cookies.set` directly with
 * the same options exported above.
 */
export async function setFreshCheckoutCookie(
  orderId: string,
  cookieStore: CookieStoreLike,
): Promise<void> {
  const secret = getFreshCheckoutSecret();
  const token = await signOrderToken(orderId, secret);
  cookieStore.set(
    FRESH_CHECKOUT_COOKIE_NAME,
    token,
    FRESH_CHECKOUT_COOKIE_OPTIONS,
  );
}
