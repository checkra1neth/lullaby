/**
 * Unit tests for `lib/gen/lyrics.ts` (Task 14).
 *
 * Exercises the validator branches mandated by Requirement 8 and the
 * end-to-end happy path through `generateLyrics` with the OpenAI client
 * fully stubbed via `vi.mock`. No network calls happen.
 *
 * Cases (Task 14 testing checklist):
 *   - Valid response with all favorites and child name → resolves with text.
 *   - Missing child name → throws.
 *   - Missing one favorite → throws.
 *   - Word count < 80 → throws.
 *   - Word count > 400 → throws.
 *   - Empty favorites + response contains "favorite thing" → throws.
 *   - Empty favorites + clean response → resolves.
 *   - Empty content → throws.
 *   - Whole-word boundary respected (e.g. "Mira" present but only inside
 *     "miracle" → throws).
 *   - Punctuation around the name still counts as a match.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedOrder } from "@/lib/gen/loadOrder";

// ---- vi.mock for the OpenAI singleton -------------------------------------

interface MockState {
  /** The text the mocked completion call should return. */
  responseText: string;
  /** When set, throws this error instead of returning text. */
  rejectWith?: Error;
  /** Records the messages sent to the API for prompt-shape assertions. */
  capturedMessages: unknown;
}

const state: MockState = {
  responseText: "",
  capturedMessages: undefined,
};

vi.mock("@/lib/openai", () => ({
  OPENAI_DEFAULT_TIMEOUT_MS: 18_000,
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async (req: { messages: unknown }) => {
          state.capturedMessages = req.messages;
          if (state.rejectWith) {
            throw state.rejectWith;
          }
          return {
            choices: [
              { message: { content: state.responseText, role: "assistant" } },
            ],
          };
        }),
      },
    },
  }),
}));

// ---- helpers --------------------------------------------------------------

function makeOrder(overrides: Partial<LoadedOrder> = {}): LoadedOrder {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    parent_email: "parent@example.com",
    child_name: "Mira",
    child_age: 3,
    favorites: ["stars", "blueberries", "dinosaur"],
    mood: "dreamy",
    language: "en",
    narrator_voice_id: "voice_test_a",
    from_name: null,
    sku: "one_off",
    stripe_subscription_id: null,
    stripe_checkout_session_id: "cs_test_abc",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a body of plain words long enough to satisfy the [80, 400] window.
 * Returns a string of `count` space-separated words.
 */
function filler(count: number, base = "soft"): string {
  return Array.from({ length: count }, (_v, i) => `${base}${i}`).join(" ");
}

/**
 * Build a valid lullaby that mentions every favorite and the child name and
 * lands at ~120 words (well within the [80, 400] window).
 */
function validLyrics(
  order: LoadedOrder,
  options: { wordCount?: number } = {},
): string {
  const target = options.wordCount ?? 120;
  // Anchor the required tokens at the start so they always appear regardless
  // of the filler, then pad to hit the desired word count.
  const tokens: string[] = [
    "Goodnight",
    `${order.child_name},`,
    "the",
    "sky",
    "is",
    "soft",
    "and",
    "low.",
  ];
  for (const fav of order.favorites) {
    tokens.push(`Sweet`, `${fav},`, `lull`, `you`, `slow.`);
  }
  while (tokens.length < target) {
    tokens.push(`hush${tokens.length}`);
  }
  // Trim down if we overshot so word count is exact.
  while (tokens.length > target) {
    tokens.pop();
  }
  return tokens.join(" ");
}

beforeEach(() => {
  state.responseText = "";
  state.rejectWith = undefined;
  state.capturedMessages = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- validator-only tests -------------------------------------------------

describe("tokenizeLyrics + validateLyrics", () => {
  it("strips punctuation and counts words on Unicode whitespace", async () => {
    const { tokenizeLyrics } = await import("@/lib/gen/lyrics");
    expect(tokenizeLyrics("Hello, world! It's me.")).toEqual([
      "Hello",
      "world",
      "Its",
      "me",
    ]);
  });

  it("rejects empty responses", async () => {
    const { validateLyrics } = await import("@/lib/gen/lyrics");
    const order = makeOrder();
    expect(() => validateLyrics("", order)).toThrow(/empty_response/);
    expect(() => validateLyrics("    ", order)).toThrow(/empty_response/);
  });

  it("matches the child name with whole-word, case-insensitive boundaries", async () => {
    const { validateLyrics } = await import("@/lib/gen/lyrics");
    const order = makeOrder({ child_name: "Mira", favorites: [] });
    // Substring-only mention ("miracle") must NOT count as a match.
    const text = `${filler(120)} miracle`;
    expect(() => validateLyrics(text, order)).toThrow(/missing_child_name/);
  });

  it("accepts the child name surrounded by punctuation", async () => {
    const { validateLyrics } = await import("@/lib/gen/lyrics");
    const order = makeOrder({ child_name: "Mira", favorites: [] });
    const text = `Hush, mira! ${filler(118)}`;
    expect(() => validateLyrics(text, order)).not.toThrow();
  });
});

// ---- generateLyrics happy path + every failure branch --------------------

describe("generateLyrics", () => {
  it("returns the lyrics text on a valid response with all favorites and child name", async () => {
    const order = makeOrder();
    state.responseText = validLyrics(order);

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    const result = await generateLyrics(order);

    expect(result).toContain(order.child_name);
    for (const fav of order.favorites) {
      expect(result.toLowerCase()).toContain(fav.toLowerCase());
    }
  });

  it("throws when the response is missing the child name (Req 8.2)", async () => {
    const order = makeOrder({ child_name: "Mira" });
    // 120-word body that mentions every favorite but not "Mira".
    const tokens: string[] = [];
    for (const fav of order.favorites) {
      tokens.push("Sweet", `${fav},`, "lull", "you", "slow.");
    }
    while (tokens.length < 120) tokens.push(`hush${tokens.length}`);
    state.responseText = tokens.join(" ");

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await expect(generateLyrics(order)).rejects.toThrow(
      /missing_child_name/,
    );
  });

  it("throws when one of the favorites is missing (Req 8.3)", async () => {
    const order = makeOrder({
      favorites: ["stars", "blueberries", "dinosaur"],
    });
    // Drop "dinosaur" from the body but keep stars + blueberries + child name.
    const tokens: string[] = [
      "Goodnight",
      `${order.child_name},`,
      "the",
      "stars",
      "twinkle",
      "and",
      "blueberries",
      "shine.",
    ];
    while (tokens.length < 120) tokens.push(`hush${tokens.length}`);
    state.responseText = tokens.join(" ");

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await expect(generateLyrics(order)).rejects.toThrow(
      /missing_favorite:dinosaur/,
    );
  });

  it("throws when the word count is below 80 (Req 8.5)", async () => {
    const order = makeOrder();
    // 79 words including child + each favorite at the head.
    const tokens: string[] = [
      `${order.child_name},`,
      "stars",
      "blueberries",
      "dinosaur",
    ];
    while (tokens.length < 79) tokens.push(`hush${tokens.length}`);
    state.responseText = tokens.join(" ");

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await expect(generateLyrics(order)).rejects.toThrow(
      /word_count_too_low/,
    );
  });

  it("throws when the word count is above 400 (Req 8.5)", async () => {
    const order = makeOrder();
    state.responseText = validLyrics(order, { wordCount: 401 });

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await expect(generateLyrics(order)).rejects.toThrow(
      /word_count_too_high/,
    );
  });

  it("rejects the literal 'favorite thing' placeholder when favorites is empty (Req 8.4)", async () => {
    // The runtime path that produces an empty favorites array is the
    // library-funded regen flow with no favorites — the form schema
    // requires 1–3 in the create flow, but the validator must still
    // enforce this rule for any caller.
    const order = makeOrder({ favorites: [] as unknown as string[] });
    const tokens: string[] = [
      `${order.child_name},`,
      "your",
      "favorite",
      "thing",
      "is",
      "the",
      "moon.",
    ];
    while (tokens.length < 120) tokens.push(`hush${tokens.length}`);
    state.responseText = tokens.join(" ");

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await expect(generateLyrics(order)).rejects.toThrow(
      /favorite_thing_placeholder/,
    );
  });

  it("accepts a clean response when favorites is empty (Req 8.4)", async () => {
    const order = makeOrder({ favorites: [] as unknown as string[] });
    const tokens: string[] = [`${order.child_name},`, "sleep", "softly."];
    while (tokens.length < 120) tokens.push(`hush${tokens.length}`);
    state.responseText = tokens.join(" ");

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    const result = await generateLyrics(order);
    expect(result.toLowerCase()).not.toContain("favorite thing");
  });

  it("propagates an OpenAI client error so the Inngest step retries", async () => {
    const order = makeOrder();
    state.rejectWith = new Error("openai_unreachable");

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await expect(generateLyrics(order)).rejects.toThrow(/openai_unreachable/);
  });

  it("embeds child name, favorites, and from_name in the prompt", async () => {
    const order = makeOrder({ from_name: "Auntie Joy" });
    state.responseText = validLyrics(order);

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await generateLyrics(order);

    const messages = state.capturedMessages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages).toHaveLength(2);
    const userMsg = messages[1].content;
    expect(userMsg).toContain(order.child_name);
    expect(userMsg).toContain("Auntie Joy");
    for (const fav of order.favorites) {
      expect(userMsg).toContain(fav);
    }
  });

  it("instructs the model to avoid the 'favorite thing' placeholder when favorites is empty", async () => {
    const order = makeOrder({ favorites: [] as unknown as string[] });
    state.responseText = (() => {
      const tokens: string[] = [`${order.child_name},`, "sleep"];
      while (tokens.length < 120) tokens.push(`hush${tokens.length}`);
      return tokens.join(" ");
    })();

    const { generateLyrics } = await import("@/lib/gen/lyrics");
    await generateLyrics(order);

    const messages = state.capturedMessages as Array<{
      role: string;
      content: string;
    }>;
    const userMsg = messages[1].content;
    expect(userMsg.toLowerCase()).toContain("favorite thing");
  });
});
