/**
 * Stripe SDK singleton.
 *
 * Design §3.1 (Order_Service / Stripe_Webhook_Handler) and §8 (Env vars) call
 * for a single Stripe client shared across the app. Req 4.1 mandates a
 * 10-second per-request timeout when creating Checkout sessions; we apply it
 * client-wide so every Stripe call inherits the same upper bound.
 *
 * The client is constructed lazily on first use so `tsc --noEmit` and
 * `next build` don't crash when env values are absent. Validation (including
 * Req 4.6's `sk_test_` rule) happens inside `getServerEnv()` on first call.
 */
import Stripe from "stripe";
import { getServerEnv } from "./env";

/**
 * Pinned Stripe API version. This must match the `LatestApiVersion` literal
 * declared by the installed `stripe@17` types — the SDK only allows the latest
 * version through the typed `apiVersion` option.
 */
export const STRIPE_API_VERSION = "2025-02-24.acacia" as const;

/** Per-request timeout for every Stripe HTTP call (Req 4.1). */
export const STRIPE_REQUEST_TIMEOUT_MS = 10_000;

let cached: Stripe | undefined;

/**
 * Returns a process-wide Stripe client instance. First call validates env via
 * `getServerEnv()` (which enforces the `sk_test_` rule) and constructs the
 * client; subsequent calls return the cached singleton.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const env = getServerEnv();
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    typescript: true,
    // Idempotent retries are added per-call where needed; keep the global
    // default off so checkout creation has a predictable upper bound.
    maxNetworkRetries: 0,
  });
  return cached;
}
