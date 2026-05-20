/**
 * Marketing-page price retrieval helpers.
 *
 * Used by the `/` server component (Task 4) to load the One_Off_SKU and
 * Subscription_SKU prices straight from Stripe and format them for display.
 *
 * Req 1.3: prices are shown with a USD currency symbol and two decimal places.
 * Req 1.4: when either price cannot be loaded — env var missing, Stripe error,
 *   or unexpected payload shape — the corresponding SKU button is hidden and a
 *   "temporarily unavailable" notice is shown in its place. Both cases collapse
 *   here to `loadMarketingPrice()` returning `null`.
 *
 * Price IDs are read directly from `process.env` rather than `getServerEnv()`
 * so that operationally removing one of the two price env vars degrades to the
 * "temporarily unavailable" UI path (Req 1.4) rather than a 500 from the env
 * validator. The Stripe client itself still goes through `getStripe()`, which
 * enforces the `sk_test_` invariant from Req 4.6.
 */
import { getStripe } from "@/lib/stripe";

/** A retrieved Stripe price prepared for marketing display (Req 1.3). */
export interface MarketingPrice {
  /** Stripe price id (e.g. `price_…`). */
  id: string;
  /**
   * Price formatted in USD with two decimals, e.g. `"$4.99"`. Currency falls
   * back to USD per the spec (the v1 SKUs are USD-only).
   */
  formatted: string;
}

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Retrieve a Stripe price by its env-var name and return display-ready info.
 *
 * Returns `null` when:
 *   - the env var is missing or empty (Req 1.4 — config not present),
 *   - the Stripe call throws (Req 1.4 — config cannot be loaded),
 *   - the price exists but has no `unit_amount` we can format.
 *
 * Never throws: the marketing page treats any failure mode as "temporarily
 * unavailable" and continues rendering the rest of the headline area.
 */
export async function loadMarketingPrice(
  envVarName: "STRIPE_PRICE_ONE_OFF" | "STRIPE_PRICE_SUBSCRIPTION",
): Promise<MarketingPrice | null> {
  const priceId = process.env[envVarName];
  if (!priceId || priceId.trim() === "") return null;

  try {
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceId);
    if (!price || price.unit_amount == null) return null;

    const currency = (price.currency ?? "usd").toUpperCase();
    // Per spec, default to USD formatting. Stripe always returns lowercase
    // ISO codes; we format with USD symbol regardless since v1 SKUs are USD.
    const formatter =
      currency === "USD"
        ? USD_FORMATTER
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

    return {
      id: price.id,
      formatted: formatter.format(price.unit_amount / 100),
    };
  } catch {
    // Any failure — env validation, network, Stripe 404, etc. — collapses to
    // null so the page renders the "temporarily unavailable" notice (Req 1.4).
    return null;
  }
}
