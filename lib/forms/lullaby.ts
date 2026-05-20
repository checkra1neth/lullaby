/**
 * Lullaby form validation schema (Req 2.1–2.9, 21.7).
 *
 * Importable from BOTH server and client. Because the list of preset narrator
 * voices comes from `ELEVENLABS_VOICE_IDS` (a JSON-encoded array, server-only),
 * the schema is exposed as a factory `buildLullabyFormSchema(allowedVoiceIds)`.
 * Server code can call `getLullabyFormSchema()` to read the env directly; the
 * client form receives `allowedVoiceIds` as a prop from the server component
 * wrapper and instantiates its own schema.
 *
 * Trimming policy (Req 2.2): every string field is `.trim()`ed before length
 * validation. `favorites` items are trimmed individually and rejected when
 * empty after trim (Req 2.5).
 */
import { z } from "zod";

export const LULLABY_MOODS = ["calm", "playful", "dreamy"] as const;
export type LullabyMood = (typeof LULLABY_MOODS)[number];

const NAME_MIN = 1;
const NAME_MAX = 40;
const FAVORITE_MIN = 1;
const FAVORITE_MAX = 30;
const FAVORITES_MIN = 1;
const FAVORITES_MAX = 3;
const AGE_MIN = 0;
const AGE_MAX = 5;
const EMAIL_MAX = 254;

/**
 * Build the Lullaby form schema with the given list of allowed voice ids.
 * Every string field is trimmed before validation; numeric fields are coerced
 * from form input strings.
 */
export function buildLullabyFormSchema(allowedVoiceIds: readonly string[]) {
  const voiceSet = new Set(allowedVoiceIds);

  return z.object({
    // Req 2.1 / 2.3: child name 1–40 after trim. Errors name the field.
    child_name: z
      .string({ required_error: "child name is required" })
      .trim()
      .min(NAME_MIN, "child name is required")
      .max(NAME_MAX, `child name must be ${NAME_MAX} characters or fewer`),

    // Req 2.1 / 2.4: integer age 0..5. Coerces strings from <input type=number>.
    child_age: z.coerce
      .number({
        required_error: "child age is required",
        invalid_type_error: "child age must be a number",
      })
      .int("child age must be a whole number")
      .min(AGE_MIN, `child age must be between ${AGE_MIN} and ${AGE_MAX}`)
      .max(AGE_MAX, `child age must be between ${AGE_MIN} and ${AGE_MAX}`),

    // Req 2.1 / 2.5: 1–3 favorites; each trimmed 1–30 chars; reject empty after trim.
    favorites: z
      .array(
        z
          .string()
          .trim()
          .min(FAVORITE_MIN, "favorite must not be empty")
          .max(
            FAVORITE_MAX,
            `each favorite must be ${FAVORITE_MAX} characters or fewer`,
          ),
      )
      .min(FAVORITES_MIN, "add at least one favorite thing")
      .max(FAVORITES_MAX, `no more than ${FAVORITES_MAX} favorites`),

    // Req 2.1: mood ∈ {calm, playful, dreamy}.
    mood: z.enum(LULLABY_MOODS, {
      errorMap: () => ({
        message: `mood must be one of: ${LULLABY_MOODS.join(", ")}`,
      }),
    }),

    // Req 2.7 / 21.7: language fixed to "en" in v1, with the exact required wording.
    language: z.literal("en", {
      errorMap: () => ({ message: "only English is supported in v1" }),
    }),

    // Req 2.1 / 2.6: must be one of the configured preset voices.
    narrator_voice_id: z
      .string({ required_error: "narrator voice is required" })
      .min(1, "narrator voice is required")
      .refine((v) => voiceSet.has(v), {
        message: "narrator voice must be one of the available presets",
      }),

    // Req 2.1: optional from_name, 1–40 chars when present.
    // Treat empty/whitespace-only input as absent.
    from_name: z.preprocess(
      (v) => {
        if (typeof v !== "string") return v;
        const trimmed = v.trim();
        return trimmed === "" ? undefined : trimmed;
      },
      z
        .string()
        .min(NAME_MIN, "from name must not be empty")
        .max(NAME_MAX, `from name must be ${NAME_MAX} characters or fewer`)
        .optional(),
    ),

    // Req 4.2 / 15.1: RFC 5322 (zod's loose form) + ≤254 chars.
    parent_email: z
      .string({ required_error: "email is required" })
      .trim()
      .min(1, "email is required")
      .max(EMAIL_MAX, `email must be ${EMAIL_MAX} characters or fewer`)
      .email("email must be a valid address"),
  });
}

export type LullabyFormSchema = ReturnType<typeof buildLullabyFormSchema>;
export type LullabyFormValues = z.infer<LullabyFormSchema>;

/**
 * Parse the JSON-encoded list of preset voice ids from
 * `ELEVENLABS_VOICE_IDS`. Throws a descriptive error if the env value is
 * missing, not valid JSON, not an array, or contains non-string entries.
 *
 * Server-only: do not call from a client component.
 */
export function parseAllowedVoiceIds(raw: string | undefined): string[] {
  if (!raw) {
    throw new Error("ELEVENLABS_VOICE_IDS is not set");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `ELEVENLABS_VOICE_IDS is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("ELEVENLABS_VOICE_IDS must be a JSON array");
  }
  const ids = parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) {
    throw new Error("ELEVENLABS_VOICE_IDS must contain at least one voice id");
  }
  return ids;
}

/**
 * Build the default schema using the env-provided list of voice ids.
 * Server-only: do not call from a client component.
 */
export function getLullabyFormSchema() {
  return buildLullabyFormSchema(parseAllowedVoiceIds(process.env.ELEVENLABS_VOICE_IDS));
}

// ---------------------------------------------------------------------------
// Voice-clone denylist (Req 21.2)
// ---------------------------------------------------------------------------

/**
 * Regex that matches any payload key that starts with `clone_`.
 * Used by `checkVoiceCloneDenylist` to reject voice-cloning fields.
 */
const CLONE_KEY_REGEX = /^clone_/;

/**
 * Explicit field names that are always rejected regardless of the regex above.
 * Req 21.2 calls out `voice_clone_url` by name.
 */
const CLONE_FIELD_NAMES = new Set(["voice_clone_url"]);

/**
 * Inspect a raw request payload (any object) for voice-clone fields.
 *
 * Returns `null` when the payload is clean, or a descriptive error string
 * when a disallowed key is found. The caller is responsible for turning the
 * error string into an HTTP 400 response.
 *
 * Req 21.2: reject any payload key matching `/^clone_/` or named
 * `voice_clone_url` with HTTP 400.
 *
 * @example
 * const err = checkVoiceCloneDenylist({ voice_clone_url: "https://..." });
 * if (err) return NextResponse.json({ error: err }, { status: 400 });
 */
export function checkVoiceCloneDenylist(
  payload: Record<string, unknown>,
): string | null {
  for (const key of Object.keys(payload)) {
    if (CLONE_FIELD_NAMES.has(key) || CLONE_KEY_REGEX.test(key)) {
      return `Field "${key}" is not supported in v1 (voice cloning is unavailable)`;
    }
  }
  return null;
}
