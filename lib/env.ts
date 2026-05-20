/**
 * Server-side environment variable loading and validation.
 *
 * Design §8 (Env vars) lists every key the app needs. Req 4.6 mandates that
 * STRIPE_SECRET_KEY must start with `sk_test_` — anything else (including a
 * production `sk_live_` key) must refuse to boot.
 *
 * This module is server-only. Never import it from a client component.
 * Validation runs lazily on the first call to `getServerEnv()` so the file
 * compiles cleanly during `tsc --noEmit` without any env values set, but
 * the very first server request will throw if config is missing or invalid.
 */
import { z } from "zod";

const ServerEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Supabase — optional for local dev without DB (preview + checkout still work)
  SUPABASE_URL: z.string().default(""),
  SUPABASE_ANON_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_BUCKET_LULLABIES: z.string().default("lullabies"),

  // Req 4.6: refuse to boot on anything other than a test-mode key.
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("sk_test_", {
      message:
        "STRIPE_SECRET_KEY must start with 'sk_test_' (Req 4.6 — live keys are forbidden in v1)",
    }),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  // Price ids are intentionally optional at boot. Req 1.4 says the marketing
  // page must hide the SKU button and show "temporarily unavailable" when a
  // price can't be loaded — that path also handles the env-missing case. The
  // checkout endpoints (Task 6) re-validate presence at the call site.
  STRIPE_PRICE_ONE_OFF: z.string().optional(),
  STRIPE_PRICE_SUBSCRIPTION: z.string().optional(),

  OPENAI_API_KEY: z.string().optional().default(""),

  ELEVENLABS_API_KEY: z.string().min(1),
  // JSON-encoded array of 2–3 preset voice ids (Req 2.1, 9.1). Validated as a
  // non-empty string here; Task 5 parses it into the form schema.
  ELEVENLABS_VOICE_IDS: z.string().min(1),
  // Pre-created agent id for lyrics generation (text-only, gemini-2.5-flash)
  ELEVENLABS_LYRICS_AGENT_ID: z.string().default(""),

  INNGEST_EVENT_KEY: z.string().optional().default(""),
  INNGEST_SIGNING_KEY: z.string().optional().default(""),

  // Upstash Redis — optional; rate limiting fails open when not configured
  UPSTASH_REDIS_REST_URL: z.string().default(""),
  UPSTASH_REDIS_REST_TOKEN: z.string().default(""),

  RESEND_API_KEY: z.string().optional().default(""),
  RESEND_FROM: z.string().optional().default("Lullaby <noreply@example.com>"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Returns the validated server environment. Throws on the first call if any
 * key is missing, malformed, or violates the `sk_test_` rule (Req 4.6).
 *
 * Subsequent calls return the cached, frozen object.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  if (typeof window !== "undefined") {
    throw new Error(
      "lib/env.ts: getServerEnv() must not be called on the client — server-only module",
    );
  }

  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid server environment (see .env.local.example for the full list):\n${issues}`,
    );
  }

  cached = Object.freeze(parsed.data);
  return cached;
}

/**
 * Public env values that are safe to use in client components.
 * Only NEXT_PUBLIC_* keys belong here.
 */
export const publicEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "",
} as const;
