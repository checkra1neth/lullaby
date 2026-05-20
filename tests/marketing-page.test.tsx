// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import MarketingPage from "@/app/page";

vi.mock("@/lib/marketing/prices", () => ({
  loadMarketingPrice: vi.fn().mockResolvedValue({
    formatted: "$4.99",
    unitAmount: 499,
    currency: "usd",
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => cleanup());

describe("Marketing page (Req 6, 7)", () => {
  it("renders navbar with logo and CTA", async () => {
    render(await MarketingPage());
    // Logo appears in both navbar and footer; use first occurrence
    expect(screen.getAllByText("Lullaby")[0]).not.toBeNull();
    // "Get started" appears in navbar and pricing cards
    expect(screen.getAllByText("Get started")[0]).not.toBeNull();
  });

  it("renders hero headline", async () => {
    render(await MarketingPage());
    expect(screen.getByText(/A lullaby made/)).not.toBeNull();
    expect(screen.getByText(/Create a lullaby/)).not.toBeNull();
  });

  it("renders Features section with 4 cards", async () => {
    render(await MarketingPage());
    expect(screen.getByText("Truly personal")).not.toBeNull();
    expect(screen.getByText("Real voices")).not.toBeNull();
    expect(screen.getByText("Yours forever")).not.toBeNull();
    expect(screen.getByText("Private & safe")).not.toBeNull();
  });

  it("renders How it works section with 3 steps", async () => {
    render(await MarketingPage());
    expect(screen.getByText("Tell us about your child")).not.toBeNull();
    expect(screen.getByText("We craft the lullaby")).not.toBeNull();
    expect(screen.getByText("Download & share")).not.toBeNull();
  });

  it("renders pricing cards inside .glass-panel", async () => {
    render(await MarketingPage());
    const panels = document.querySelectorAll(".glass-panel");
    expect(panels.length).toBeGreaterThanOrEqual(2);
  });
});
