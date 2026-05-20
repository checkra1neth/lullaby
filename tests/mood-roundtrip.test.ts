// @vitest-environment jsdom

/**
 * Feature: lullaby-redesign, Property 2: Mood round-trip is identity
 *
 * For any mood in MOODS, calling applyMood(mood) then readMoodVars()
 * shall return the same (h, s, l) triple defined for that mood.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { MOODS, type Mood } from "@/lib/mood/MOODS";
import { applyMood, readMoodVars } from "@/lib/mood/applyMood";

describe("Mood round-trip (CP-2)", () => {
  it("should return the same HSL triple for every mood", () => {
    const moods = Object.keys(MOODS) as Mood[];
    fc.assert(
      fc.property(fc.constantFrom<Mood>(...moods), (m) => {
        applyMood(m);
        expect(readMoodVars()).toEqual(MOODS[m]);
      }),
      { numRuns: 200 },
    );
  });
});
