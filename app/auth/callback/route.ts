/**
 * GET /auth/callback — Magic-link verification endpoint.
 *
 * Called when the parent clicks the magic link in their email. The URL
 * contains `?token_hash=...&type=email` (or `type=magiclink`).
 *
 * On valid token: establishes a Supabase session (24-hour max via project
 * settings), sets the session cookie, and redirects to `?next=` if present,
 * else `/library`.
 *
 * On invalid/expired/used token: redirects to `/auth/invalid` which renders
 * exactly "This link is no longer valid" (Req 15.4).
 *
 * Req: 15.2, 15.3, 15.4
 * Design: §2 Sequence magic-link auth, §3.1 Auth_Service
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { getServerEnv } from "@/lib/env";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "email" | "magiclink" | null;
  const next = searchParams.get("next") || "/library";

  const env = getServerEnv();
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  // If no token_hash is provided, redirect to invalid
  if (!tokenHash) {
    return NextResponse.redirect(new URL("/auth/invalid", baseUrl));
  }

  // Build a Supabase client that can write cookies on the response
  const response = NextResponse.redirect(new URL(next, baseUrl));

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: CookieOptions;
        }[],
      ) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, {
            ...options,
            // Enforce 24-hour max session (Req 15.3)
            maxAge: Math.min(
              (options?.maxAge as number) ?? 86400,
              86400,
            ),
          });
        }
      },
    },
  });

  // Verify the OTP token (Req 15.3, 15.4)
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type === "magiclink" ? "magiclink" : "email",
  });

  if (error) {
    // Invalid, expired, or already-used link → redirect to /auth/invalid (Req 15.4)
    return NextResponse.redirect(new URL("/auth/invalid", baseUrl));
  }

  // Success: session cookie is already set via the setAll callback above.
  // Redirect to the `next` URL (or /library by default).
  return response;
}
