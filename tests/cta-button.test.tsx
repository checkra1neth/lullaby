// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CtaButton } from "@/app/_components/CtaButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => cleanup());

describe("CtaButton", () => {
  it("renders Link mode with glow + inner spans (Req 4.1)", () => {
    render(<CtaButton href="/create">Make lullaby</CtaButton>);
    const link = screen.getByText("Make lullaby").closest("a");
    expect(link).not.toBeNull();
    expect(link!.classList.contains("cta-btn")).toBe(true);
    expect(link!.querySelector(".cta-glow")).not.toBeNull();
    expect(link!.querySelector(".cta-inner")).not.toBeNull();
  });

  it("renders button type=submit mode (Req 4.1, 15.4)", () => {
    render(<CtaButton type="submit">Send magic link</CtaButton>);
    const btn = screen.getByText("Send magic link").closest("button");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("type")).toBe("submit");
    expect(btn!.classList.contains("cta-btn")).toBe(true);
  });

  it("sets data-fullwidth when fullWidth is true (Req 4.1)", () => {
    render(
      <CtaButton href="/create" fullWidth>
        Full
      </CtaButton>,
    );
    const link = screen.getByText("Full").closest("a");
    expect(link!.hasAttribute("data-fullwidth")).toBe(true);
  });

  it("accessible name equals visible text (Req 4.6)", () => {
    render(<CtaButton href="/create">Make lullaby</CtaButton>);
    const link = screen.getByRole("link", { name: /Make lullaby/ });
    expect(link).not.toBeNull();
  });

  it("renders icon slot when iconName is provided (Req 4.1)", () => {
    render(
      <CtaButton href="/create" iconName="bedtime">
        Make lullaby
      </CtaButton>,
    );
    const link = screen.getByText("Make lullaby").closest("a");
    expect(link!.querySelector(".material-symbols-outlined")).not.toBeNull();
  });
});
