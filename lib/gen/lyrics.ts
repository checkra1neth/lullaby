/**
 * generateLyrics — calls an ElevenLabs Conversational AI agent (text-only,
 * gemini-2.5-flash) via WebSocket and validates the response against the
 * acceptance criteria in Requirement 8 (design §6 lyrics step).
 *
 * The agent is pre-created in the ElevenLabs dashboard / API and its id is
 * stored in `ELEVENLABS_LYRICS_AGENT_ID`. Re-using a pre-created agent
 * avoids the latency of agent creation on every request.
 *
 * Validation rules (Req 8.2–8.5):
 *   - The `child_name` token must appear at least once, case-insensitive,
 *     whole-word match.
 *   - When the order has favorites, each favorite must appear at least once
 *     under the same matching rules (Req 8.3).
 *   - When the order has zero favorites, the literal string "favorite thing"
 *     (case-insensitive) is REJECTED (Req 8.4).
 *   - Word count, after stripping Unicode punctuation and tokenizing on
 *     Unicode whitespace, must fall in [80, 400] (Req 8.5).
 *
 * Failure handling (Req 8.6):
 *   - `generateLyrics` throws a plain `Error` on any failure.
 *   - The Inngest `step.run("lyrics", { retries: 1, ... })` wrapper retries
 *     once. After two attempts the outer catch maps to
 *     `GenerationFailure("lyrics_generation_failed")`.
 */
import type { LoadedOrder } from "@/lib/gen/loadOrder";
import { chatWithAgent } from "@/lib/elevenlabs/agentChat";
import { getServerEnv } from "@/lib/env";

/** Word-count bounds for the lullaby text (Req 8.5). */
export const LYRICS_WORD_COUNT_MIN = 80;
export const LYRICS_WORD_COUNT_MAX = 400;

/**
 * Escape a string for safe interpolation inside a `RegExp` body. Keeps
 * names with regex metacharacters (e.g. `O'Hara`, `Ann-Marie`) from blowing
 * up the validator.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tokenize lyrics into words for the [80, 400] word-count check (Req 8.5).
 * Strategy:
 *   1. Strip all Unicode punctuation (`\p{P}`) so "moon," and "moon" both
 *      count as the single word "moon".
 *   2. Split on Unicode whitespace (`\s+`).
 *   3. Drop empty entries created by leading/trailing whitespace.
 *
 * The Unicode-property regex is built via `new RegExp(...)` rather than a
 * literal so TypeScript doesn't trip on the `u` flag at the project's
 * default ES target — the runtime (Node ≥ 16, modern browsers) supports it.
 */
const PUNCTUATION_REGEX = new RegExp("[\\p{P}]+", "gu");
const WHITESPACE_REGEX = new RegExp("\\s+", "u");

export function tokenizeLyrics(text: string): string[] {
  return text
    .replace(PUNCTUATION_REGEX, "")
    .split(WHITESPACE_REGEX)
    .filter((w) => w.length > 0);
}

/**
 * Case-insensitive substring match. Used for the favorite-thing presence
 * checks (Req 8.3). We use substring (not whole-word) here because users
 * may enter favorites with typos or unusual spellings, and the LLM may
 * pluralize or slightly modify them. Whole-word is too strict for that.
 */
function containsSubstring(haystack: string, needle: string): boolean {
  const trimmed = needle.trim();
  if (trimmed.length === 0) return false;
  return haystack.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * Whole-word, case-insensitive match. Used for the child-name presence
 * check (Req 8.2). Whole-word is correct here because the child's name
 * must appear as a distinct token, not as part of another word.
 */
function containsWholeWord(haystack: string, needle: string): boolean {
  const trimmed = needle.trim();
  if (trimmed.length === 0) return false;
  const re = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i");
  return re.test(haystack);
}

/**
 * Validate a candidate lyrics text. Throws a plain `Error` on the first
 * rule it violates so the caller (the Inngest step) retries the call.
 *
 * Errors are intentionally short and non-PII so a stack trace logged via
 * `lib/log.ts` never echoes the child name (the redactor masks PII via
 * `pii: [order.child_name, ...favorites]` at the call site).
 */
export function validateLyrics(text: string, order: LoadedOrder): void {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("lyrics_empty_response");
  }

  // Req 8.5: word count window.
  const words = tokenizeLyrics(text);
  if (words.length < LYRICS_WORD_COUNT_MIN) {
    throw new Error(
      `lyrics_word_count_too_low:${words.length}<${LYRICS_WORD_COUNT_MIN}`,
    );
  }
  if (words.length > LYRICS_WORD_COUNT_MAX) {
    throw new Error(
      `lyrics_word_count_too_high:${words.length}>${LYRICS_WORD_COUNT_MAX}`,
    );
  }

  // Req 8.2: child name must appear at least once, whole-word, case-insensitive.
  if (!containsWholeWord(text, order.child_name)) {
    throw new Error("lyrics_missing_child_name");
  }

  const favorites = order.favorites
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  if (favorites.length === 0) {
    // Req 8.4: zero favorites → forbid the literal placeholder string.
    if (/favorite\s+thing/i.test(text)) {
      throw new Error("lyrics_contains_favorite_thing_placeholder");
    }
    return;
  }

  // Req 8.3: each favorite must appear at least once (case-insensitive
  // substring — tolerant of typos and LLM-induced pluralizations).
  for (const favorite of favorites) {
    if (!containsSubstring(text, favorite)) {
      throw new Error(`lyrics_missing_favorite:${favorite}`);
    }
  }
}

/**
 * Build the user message sent to the agent. Embeds personalization fields
 * directly so the model has every constraint visible.
 */
function buildPrompt(order: LoadedOrder): string {
  const favorites = order.favorites
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  const fromLine = order.from_name?.trim()
    ? `The lullaby should be sung from ${order.from_name.trim()}.`
    : "";
  const favoritesBlock =
    favorites.length > 0
      ? `CRITICAL: Each of these favorite things MUST appear at least once in the lullaby text, written EXACTLY as shown (verbatim, do NOT correct spelling, do NOT substitute synonyms):\n${favorites
          .map((f) => `  - "${f}" (use this exact spelling)`)
          .join("\n")}`
      : `The child has no favorites listed. Do NOT use the placeholder phrase "favorite thing" anywhere.`;

  return [
    `Write a personalized lullaby in English for a child named ${order.child_name}, age ${order.child_age}.`,
    `The mood should feel ${order.mood}.`,
    fromLine,
    `Include the child's name "${order.child_name}" at least once, naturally.`,
    favoritesBlock,
    `Aim for around 200 words. Keep the total word count between 100 and 350 words. Use four-line rhyming stanzas separated by a blank line.`,
    `Output the lullaby text only — no preface, no title, no commentary.`,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

/**
 * Call the ElevenLabs agent and validate the lyrics. Throws a plain `Error`
 * on any failure. The Inngest step wrapper retries once; after the second
 * failure the outer pipeline maps to `GenerationFailure("lyrics_generation_failed")`.
 */
export async function generateLyrics(order: LoadedOrder): Promise<string> {
  const env = getServerEnv();
  if (!env.ELEVENLABS_LYRICS_AGENT_ID) {
    throw new Error("lyrics_agent_not_configured");
  }

  const message = buildPrompt(order);
  const text = await chatWithAgent({
    agentId: env.ELEVENLABS_LYRICS_AGENT_ID,
    message,
  });

  validateLyrics(text, order);
  return text;
}
