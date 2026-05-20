import { describe, it, expect } from "vitest";

import {
  buildCheckoutMetadata,
  buildCheckoutUrls,
  CHECKOUT_FAILED_BODY,
  parseFavoritesMetadata,
} from "@/lib/checkout";
import type { LullabyFormValues } from "@/lib/forms/lullaby";

const baseForm: LullabyFormValues = {
  child_name: "Mira",
  child_age: 3,
  favorites: ["stars", "blueberries", "dinosaur"],
  mood: "dreamy",
  language: "en",
  narrator_voice_id: "voice_test_a",
  from_name: undefined,
  parent_email: "parent@example.com",
};

describe("buildCheckoutMetadata", () => {
  it("includes every required field plus the order id", () => {
    const md = buildCheckoutMetadata(baseForm, "order-1");
    expect(md.order_id).toBe("order-1");
    expect(md.child_name).toBe("Mira");
    expect(md.child_age).toBe("3");
    expect(md.favorites).toBe("stars\nblueberries\ndinosaur");
    expect(md.mood).toBe("dreamy");
    expect(md.language).toBe("en");
    expect(md.narrator_voice_id).toBe("voice_test_a");
    expect(md.parent_email).toBe("parent@example.com");
  });

  it("omits from_name when the form left it blank", () => {
    const md = buildCheckoutMetadata(baseForm, "order-1");
    expect(md.from_name).toBeUndefined();
  });

  it("includes from_name when present", () => {
    const md = buildCheckoutMetadata(
      { ...baseForm, from_name: "Mom" },
      "order-1",
    );
    expect(md.from_name).toBe("Mom");
  });

  it("clips every value to 500 chars (Req 4.3)", () => {
    // Build a synthetic huge value through favorites; even if the form caps
    // each item at 30, the join could theoretically grow if the schema were
    // ever relaxed. The clip pass is a defense-in-depth check.
    const big = "x".repeat(600);
    const formWithBig: LullabyFormValues = {
      ...baseForm,
      favorites: [big, big, big] as unknown as LullabyFormValues["favorites"],
    };
    const md = buildCheckoutMetadata(formWithBig, "order-1");
    for (const value of Object.values(md)) {
      expect(value.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("buildCheckoutUrls", () => {
  it("interpolates the order id and leaves the Stripe session placeholder literal", () => {
    const urls = buildCheckoutUrls("https://example.com", "abc-123");
    expect(urls.success_url).toBe(
      "https://example.com/orders/abc-123?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(urls.cancel_url).toBe("https://example.com/create");
  });

  it("strips trailing slashes from the app url", () => {
    const urls = buildCheckoutUrls("https://example.com//", "abc");
    expect(urls.success_url.startsWith("https://example.com/orders/abc")).toBe(
      true,
    );
    expect(urls.cancel_url).toBe("https://example.com/create");
  });
});

describe("CHECKOUT_FAILED_BODY", () => {
  it("is a stable non-PII shape", () => {
    expect(CHECKOUT_FAILED_BODY).toEqual({ error: "checkout_failed" });
  });
});

describe("parseFavoritesMetadata", () => {
  it("round-trips the joined metadata back to the original array", () => {
    const md = buildCheckoutMetadata(baseForm, "order-x");
    expect(parseFavoritesMetadata(md.favorites)).toEqual(baseForm.favorites);
  });

  it("returns an empty array for missing or empty input", () => {
    expect(parseFavoritesMetadata(undefined)).toEqual([]);
    expect(parseFavoritesMetadata(null)).toEqual([]);
    expect(parseFavoritesMetadata("")).toEqual([]);
  });

  it("trims each entry and drops empties (e.g. trailing newline)", () => {
    expect(parseFavoritesMetadata("stars\n  blueberries  \n\ndinosaur\n")).toEqual(
      ["stars", "blueberries", "dinosaur"],
    );
  });
});
