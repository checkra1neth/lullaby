/**
 * Server-only Supabase admin (service-role) client singleton.
 *
 * Used by routes that must read/write tables irrespective of any user session
 * — most notably the checkout routes (Task 6) inserting `orders`, the Stripe
 * webhook (Task 7) upserting `orders`/`subscriptions`/`stripe_events`, and
 * the Inngest pipeline writing `generation_jobs` and `lullaby_assets`.
 *
 * The client is lazy so `next build` and `tsc --noEmit` succeed before env
 * is wired. Calls from the client bundle throw at the first use.
 *
 * Auth options match Supabase's recommended server-only configuration:
 * `persistSession: false` and `autoRefreshToken: false` so the client never
 * tries to read/write cookies or refresh tokens it doesn't own.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

let cached: SupabaseClient | undefined;

/**
 * Returns the process-wide Supabase service-role client. First call validates
 * env via `getServerEnv()`; subsequent calls return the cached instance.
 *
 * Server-only: do not import from a client component.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase/admin.ts: getSupabaseAdmin() must not be called on the client",
    );
  }
  const env = getServerEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
