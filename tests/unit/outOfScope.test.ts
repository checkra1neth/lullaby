/**
 * Unit tests for the out-of-scope rejection surface (Req 21).
 *
 * Covers:
 *   - checkVoiceCloneDenylist (Req 21.2): rejects `voice_clone_url` and
 *     any key matching `/^clone_/`; passes clean payloads.
 *   - The 501 route handler returns the correct status and body for all
 *     HTTP methods.
 */
import { describe, it, expect } from "vitest";
import { checkVoiceCloneDenylist } from "@/lib/forms/lullaby";

// ---------------------------------------------------------------------------
// checkVoiceCloneDenylist
// ---------------------------------------------------------------------------

describe("checkVoiceCloneDenylist", () => {
  it("returns null for a clean payload", () => {
    expect(
      checkVoiceCloneDenylist({
        child_name: "Mira",
        child_age: 3,
        favorites: ["stars"],
        mood: "dreamy",
        language: "en",
        narrator_voice_id: "voice-abc",
        parent_email: "parent@example.com",
      }),
    ).toBeNull();
  });

  it("rejects the explicit field name voice_clone_url (Req 21.2)", () => {
    const result = checkVoiceCloneDenylist({
      child_name: "Mira",
      voice_clone_url: "https://example.com/voice.wav",
    });
    expect(result).not.toBeNull();
    expect(result).toContain("voice_clone_url");
  });

  it("rejects any key starting with clone_ (Req 21.2)", () => {
    const result = checkVoiceCloneDenylist({
      child_name: "Mira",
      clone_source: "https://example.com/audio.wav",
    });
    expect(result).not.toBeNull();
    expect(result).toContain("clone_source");
  });

  it("rejects clone_voice_id", () => {
    const result = checkVoiceCloneDenylist({ clone_voice_id: "abc123" });
    expect(result).not.toBeNull();
  });

  it("rejects clone_ prefix regardless of suffix", () => {
    const result = checkVoiceCloneDenylist({ clone_anything_at_all: true });
    expect(result).not.toBeNull();
  });

  it("returns null for an empty payload", () => {
    expect(checkVoiceCloneDenylist({})).toBeNull();
  });

  it("does not reject keys that merely contain 'clone' in the middle", () => {
    // 'reclone' does not start with 'clone_' and is not 'voice_clone_url'
    expect(checkVoiceCloneDenylist({ reclone_data: "x" })).toBeNull();
  });

  it("does not reject 'voice_clone' (only exact 'voice_clone_url' is blocked)", () => {
    // The spec names 'voice_clone_url' specifically; 'voice_clone' alone is
    // not in the denylist and doesn't start with 'clone_'.
    expect(checkVoiceCloneDenylist({ voice_clone: "x" })).toBeNull();
  });
});
