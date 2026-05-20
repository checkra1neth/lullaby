/**
 * OpenAI SDK singleton.
 *
 * Server-only module — do not import from a client component. The constructor
 * is lazy (mirrors `lib/stripe.ts`) so `tsc --noEmit` and `next build` stay
 * green when env values aren't set yet. The first call to `getOpenAI()`
 * validates env via `getServerEnv()` and constructs the client.
 *
 * Used by:
 *   - `lib/gen/lyrics.ts` — Task 14, lyrics generation via gpt-4o-mini
 *     (Req 8.1, design §6 lyrics step).
 */
import OpenAI from "openai";

import { getServerEnv } from "@/lib/env";

/**
 * Per-request timeout default for OpenAI calls, in milliseconds. The lyrics
 * step (Task 14) overrides this on a per-call basis so the model returns
 * before Inngest's 20 s step timeout fires.
 */
export const OPENAI_DEFAULT_TIMEOUT_MS = 18_000;

let cached: OpenAI | undefined;

/**
 * Returns the process-wide OpenAI client. First call validates env; later
 * calls return the cached singleton. Per-call options (e.g. `timeout`) can
 * still be passed at the API call site to override the default.
 */
export function getOpenAI(): OpenAI {
  if (cached) return cached;
  const env = getServerEnv();
  cached = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: OPENAI_DEFAULT_TIMEOUT_MS,
    // We handle our own retries at the Inngest step level (Task 14:
    // `step.run(..., { retries: 1 })` gives 2 attempts). Keep the SDK's
    // built-in retries off so a single Inngest attempt = a single API call.
    maxRetries: 0,
  });
  return cached;
}
