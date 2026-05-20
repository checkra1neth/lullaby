/**
 * POST /api/auth/magic — Magic-link issuance endpoint.
 *
 * Accepts `{ email }`, validates RFC 5322 + ≤254 chars, hashes the email
 * (SHA-256, lowercased) for both the Upstash rate-limit counter
 * `rl:magic:{hash}` and a `magic_link_issuance_log` insert.
 *
 * On counter ≤ 5, calls `supabase.auth.signInWithOtp`. Always responds with
 * the same 200 body regardless of whether the email exists, is rate-limited,
 * or the OTP send fails — this prevents enumeration (Req 15.5).
 *
 * Jittered latency is added to remove timing oracles (design §7).
 *
 * Req: 15.1, 15.2, 15.5, 15.6
 * Design: §3.1 Auth_Service, §2 Sequence magic-link auth, §7 Security
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";

// RFC 5322 email validation + ≤254 chars (Req 15.1, 4.2)
const MagicLinkRequestSchema = z.object({
  email: z
    .string()
    .email("Invalid email format")
    .max(254, "Email must be at most 254 characters"),
});

/** Constant response body — never reveals account existence (Req 15.5). */
const GENERIC_RESPONSE = {
  ok: true,
  message: "Check your email if it's registered",
} as const;

/**
 * SHA-256 hash of the lowercased email, returned as a hex string.
 * Used for both the Upstash rate-limit key and the audit log insert.
 */
async function hashEmail(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(req: Request) {
  const startTime = Date.now();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = MagicLinkRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { email } = parsed.data;
  const emailHash = await hashEmail(email);

  // Rate limit: 5 requests per email per hour (Req 15.6)
  const rateResult = await checkRateLimit("magic", emailHash, 5, 3600);

  const env = getServerEnv();
  const supabaseAdmin = getSupabaseAdmin();

  // Log the issuance attempt (audit trail) — hash only, never the email (Req 18)
  try {
    await supabaseAdmin.from("magic_link_issuance_log").insert({
      email_hash: `\\x${emailHash}`,
      issued_at: new Date().toISOString(),
    });
  } catch {
    // Non-critical: audit log failure should not block the response
  }

  // If under rate limit, issue the magic link via Supabase Auth (Req 15.1)
  if (rateResult.allowed) {
    try {
      // Use a dedicated client with the anon key for signInWithOtp —
      // this triggers Supabase's built-in email sending (Req 15.2: 30-min TTL).
      const supabaseAuth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await supabaseAuth.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        },
      });
    } catch {
      // Swallow errors — response must be constant (Req 15.5)
    }
  }
  // If rate-limited (counter > 5), silently drop — same response (Req 15.6)

  // Ensure minimum jittered latency to prevent timing oracle
  const elapsed = Date.now() - startTime;
  const minLatency = 50 + Math.random() * 150;
  if (elapsed < minLatency) {
    await new Promise((resolve) => setTimeout(resolve, minLatency - elapsed));
  }

  return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
}
