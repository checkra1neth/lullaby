/**
 * Request-scoped Supabase server client (anon key) for reading the parent's
 * Auth session.
 *
 * Used by routes that need to identify "the signed-in user" — most notably
 * the order-status endpoint (Task 8) and the signed-URL gate (Task 23). The
 * client is built per-request because it has to read cookies via Next.js
 * `next/headers` `cookies()`. Each request gets its own instance.
 *
 * For service-role writes that bypass session/RLS, use
 * `lib/supabase/admin.ts` instead.
 *
 * Server-only: do not import from a client component.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

/**
 * Build a Supabase client bound to the current request's cookies. Reads
 * `cookies()` lazily inside the cookie methods so the function is safe to
 * call from route handlers.
 *
 * `setAll` is wired but tolerant of frameworks that disallow cookie writes
 * mid-render (Next.js Server Components). Per `@supabase/ssr` guidance, in
 * Route Handlers writes succeed; in Server Components they no-op silently.
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase/server.ts: getSupabaseServerClient() must not be called on the client",
    );
  }
  const env = getServerEnv();
  const cookieStore = cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) {
        // Server Components in Next.js cannot set cookies and will throw.
        // Route handlers and middleware can. Swallow the error so reads work
        // in either context (the order-status endpoint is a route handler so
        // writes succeed — refresh-token rotations land correctly).
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // no-op in Server Component contexts
        }
      },
    },
  });
}
