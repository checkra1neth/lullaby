/**
 * Unit tests for the download-filename helper used by the delivery page
 * (Task 9, Req 13.4 — filename includes child's first name + a date stamp).
 */
import { describe, expect, it } from "vitest";

import { lullabyFilename } from "@/lib/forms/lullabyFilename";

describe("lullabyFilename", () => {
  it("uses the child's first name lowercased with the ISO date", () => {
    expect(lullabyFilename("Mira", "mp3", "2025-01-15")).toBe(
      "lullaby-mira-2025-01-15.mp3",
    );
  });

  it("only takes the first whitespace-delimited token of the name", () => {
    expect(lullabyFilename("Mira Anne Smith", "mp4", "2025-01-15")).toBe(
      "lullaby-mira-2025-01-15.mp4",
    );
  });

  it("strips diacritics and non-alphanumerics", () => {
    expect(lullabyFilename("Zoë", "mp3", "2025-01-15")).toBe(
      "lullaby-zoe-2025-01-15.mp3",
    );
  });

  it("falls back to 'child' when slugification leaves nothing", () => {
    // Pure CJK characters are stripped by the [^a-z0-9] filter; the helper
    // must still emit a well-formed filename.
    expect(lullabyFilename("葵", "mp3", "2025-01-15")).toBe(
      "lullaby-child-2025-01-15.mp3",
    );
  });

  it("normalizes the extension and drops a leading dot", () => {
    expect(lullabyFilename("Mira", ".MP3", "2025-01-15")).toBe(
      "lullaby-mira-2025-01-15.mp3",
    );
  });

  it("formats a Date as YYYY-MM-DD in UTC", () => {
    const d = new Date("2025-03-09T01:23:45.000Z");
    expect(lullabyFilename("Mira", "mp3", d)).toBe(
      "lullaby-mira-2025-03-09.mp3",
    );
  });

  it("handles leading/trailing whitespace on the name", () => {
    expect(lullabyFilename("   Mira   ", "mp3", "2025-01-15")).toBe(
      "lullaby-mira-2025-01-15.mp3",
    );
  });
});
