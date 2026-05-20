// Feature: lullaby-personalized, Property 1: Form validation conformance
//
// **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.2, 15.1**
//
// For any form payload (including arbitrary leading/trailing whitespace on
// string fields, arbitrary integer ages, arbitrary array sizes for favorites,
// arbitrary voice id strings, arbitrary language codes, and arbitrary email
// strings), the form validator returns ok=true if and only if the trimmed
// child_name length is in [1, 40], child_age is an integer in [0, 5],
// favorites length is in [1, 3] with each trimmed entry length in [1, 30],
// narrator_voice_id ∈ env presets, language === "en", and parent_email
// matches RFC 5322 with length ≤ 254.

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { buildLullabyFormSchema } from "@/lib/forms/lullaby";

// ---------------------------------------------------------------------------
// Fixed preset voice ids used throughout this test
// ---------------------------------------------------------------------------
const PRESET_VOICE_IDS = ["voice-alpha", "voice-beta", "voice-gamma"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a string with arbitrary leading/trailing whitespace. */
const withWhitespace = (inner: fc.Arbitrary<string>): fc.Arbitrary<string> =>
  fc
    .tuple(
      inner,
      fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 5 }),
      fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 5 }),
    )
    .map(([s, pre, post]) => `${pre}${s}${post}`);

/**
 * Arbitrary that generates a string of printable ASCII characters (no
 * whitespace) of a given length range. Used to build field values whose
 * trimmed length is controlled.
 */
const printableString = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .stringOf(
      fc.char().filter((c) => c.trim().length > 0 && c !== '"' && c !== "'"),
      { minLength: min, maxLength: max },
    )
    .filter((s) => s.trim().length >= min && s.trim().length <= max);

// ---------------------------------------------------------------------------
// Arbitrary for the full form payload
// ---------------------------------------------------------------------------

/**
 * Generates a raw form payload with:
 * - child_name: arbitrary printable string wrapped in arbitrary whitespace
 * - child_age: arbitrary integer (not constrained to valid range)
 * - favorites: arbitrary-length array of strings wrapped in whitespace
 * - mood: one of the valid moods (mood is not under test for this property)
 * - language: arbitrary short string (may or may not be "en")
 * - narrator_voice_id: arbitrary string (may or may not be a preset)
 * - parent_email: arbitrary string (may or may not be RFC 5322)
 * - from_name: optional arbitrary string
 */
const arbForm = fc.record({
  // child_name: printable content of arbitrary length (0–60), wrapped in whitespace
  child_name: withWhitespace(
    fc.oneof(
      // Likely-valid range
      printableString(1, 40),
      // Likely-invalid: empty
      fc.constant(""),
      // Likely-invalid: too long
      printableString(41, 60),
    ),
  ),

  // child_age: arbitrary integer, including out-of-range values
  child_age: fc.oneof(
    fc.integer({ min: 0, max: 5 }), // valid
    fc.integer({ min: -10, max: -1 }), // below range
    fc.integer({ min: 6, max: 20 }), // above range
    fc.float({ min: 0.1, max: 4.9 }).map((f) => Math.round(f * 10) / 10), // non-integer
  ),

  // favorites: array of arbitrary size (0–6), each item wrapped in whitespace
  favorites: fc.oneof(
    // Valid: 1–3 items, each trimmed length 1–30
    fc
      .array(withWhitespace(printableString(1, 30)), {
        minLength: 1,
        maxLength: 3,
      }),
    // Invalid: empty array
    fc.constant([] as string[]),
    // Invalid: too many items
    fc.array(withWhitespace(printableString(1, 30)), {
      minLength: 4,
      maxLength: 6,
    }),
    // Invalid: item that is empty after trim
    fc
      .array(
        fc.oneof(
          withWhitespace(printableString(1, 30)),
          fc.constant("   "), // whitespace-only → empty after trim
        ),
        { minLength: 1, maxLength: 3 },
      ),
  ),

  // mood: always valid (not under test for this property)
  mood: fc.constantFrom("calm", "playful", "dreamy"),

  // language: arbitrary short string — may or may not be "en"
  language: fc.oneof(
    fc.constant("en"), // valid
    fc.constant("fr"),
    fc.constant("de"),
    fc.constant("es"),
    fc.string({ minLength: 0, maxLength: 5 }),
  ),

  // narrator_voice_id: arbitrary string — may or may not be a preset
  narrator_voice_id: fc.oneof(
    fc.constantFrom(...PRESET_VOICE_IDS), // valid
    fc.string({ minLength: 0, maxLength: 20 }), // arbitrary (likely invalid)
  ),

  // parent_email: mix of valid RFC 5322 and arbitrary strings
  parent_email: fc.oneof(
    // Valid emails
    fc
      .tuple(
        printableString(1, 30).filter((s) => /^[a-zA-Z0-9._+-]+$/.test(s)),
        printableString(1, 10).filter((s) => /^[a-zA-Z0-9]+$/.test(s)),
        fc.constantFrom("com", "net", "org", "io"),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`),
    // Invalid: no @
    fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes("@")),
    // Invalid: empty
    fc.constant(""),
    // Arbitrary string
    fc.string({ minLength: 0, maxLength: 50 }),
  ),

  // from_name: optional — arbitrary string or absent
  from_name: fc.option(
    fc.oneof(
      withWhitespace(printableString(1, 40)),
      fc.constant(""),
      withWhitespace(printableString(41, 60)),
    ),
    { nil: undefined },
  ),
});

// ---------------------------------------------------------------------------
// expectedOk: pure function that computes whether a payload should pass
// ---------------------------------------------------------------------------

/**
 * Compute whether the given raw payload should produce ok=true from the
 * validator, based solely on the trimmed values and the documented rules.
 *
 * This mirrors the zod schema logic without using zod, so the property test
 * is not just testing zod against itself.
 */
function expectedOk(payload: {
  child_name: unknown;
  child_age: unknown;
  favorites: unknown;
  mood: unknown;
  language: unknown;
  narrator_voice_id: unknown;
  parent_email: unknown;
  from_name?: unknown;
}): boolean {
  const voiceSet = new Set<string>(PRESET_VOICE_IDS);

  // child_name: trimmed length 1–40 (Req 2.2, 2.3)
  if (typeof payload.child_name !== "string") return false;
  const name = payload.child_name.trim();
  if (name.length < 1 || name.length > 40) return false;

  // child_age: integer 0–5 (Req 2.4)
  const age = payload.child_age;
  if (typeof age !== "number") return false;
  if (!Number.isInteger(age)) return false;
  if (age < 0 || age > 5) return false;

  // favorites: array length 1–3, each trimmed length 1–30 (Req 2.5)
  if (!Array.isArray(payload.favorites)) return false;
  if (payload.favorites.length < 1 || payload.favorites.length > 3) return false;
  for (const fav of payload.favorites) {
    if (typeof fav !== "string") return false;
    const trimmed = fav.trim();
    if (trimmed.length < 1 || trimmed.length > 30) return false;
  }

  // mood: one of the valid values (not under test but must be valid for overall ok)
  const validMoods = new Set(["calm", "playful", "dreamy"]);
  if (!validMoods.has(payload.mood as string)) return false;

  // language: must be "en" (Req 2.7)
  if (payload.language !== "en") return false;

  // narrator_voice_id: must be one of the presets (Req 2.6)
  if (typeof payload.narrator_voice_id !== "string") return false;
  if (!voiceSet.has(payload.narrator_voice_id)) return false;

  // parent_email: RFC 5322 (loose) + ≤254 chars (Req 4.2, 15.1)
  if (typeof payload.parent_email !== "string") return false;
  const email = payload.parent_email.trim();
  if (email.length < 1 || email.length > 254) return false;
  // Zod's .email() uses a loose RFC 5322 check: must contain exactly one @
  // with non-empty local and domain parts, and domain must contain a dot.
  const atIdx = email.lastIndexOf("@");
  if (atIdx < 1) return false; // no @ or @ at start
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes(".")) return false;
  // Zod rejects emails with spaces in local or domain
  if (/\s/.test(local) || /\s/.test(domain)) return false;

  // from_name: when present (non-empty after trim), trimmed length 1–40 (Req 2.1)
  if (payload.from_name !== undefined && payload.from_name !== null) {
    if (typeof payload.from_name !== "string") return false;
    const fromTrimmed = payload.from_name.trim();
    // Empty string after trim → treated as absent (valid)
    if (fromTrimmed.length > 0 && fromTrimmed.length > 40) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// The property test
// ---------------------------------------------------------------------------

describe("Property 1: Form validation conformance", () => {
  it(
    "validator(payload).ok === expectedOk(trimmed) for all arbitrary payloads",
    () => {
      const schema = buildLullabyFormSchema(PRESET_VOICE_IDS);

      fc.assert(
        fc.property(arbForm, (payload) => {
          const result = schema.safeParse(payload);
          const expected = expectedOk(payload);

          // The core property: validator outcome must match our reference impl
          return result.success === expected;
        }),
        { numRuns: 100 },
      );
    },
  );
});
