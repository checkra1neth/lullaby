// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GlassPanel } from "@/app/_components/GlassPanel";

afterEach(() => cleanup());

describe("GlassPanel", () => {
  it("renders a <div> with .glass-panel by default (Req 2.2)", () => {
    render(<GlassPanel>content</GlassPanel>);
    const el = screen.getByText("content");
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("glass-panel")).toBe(true);
  });

  it("renders as='section' as a <section> (Req 2.2)", () => {
    render(<GlassPanel as="section">content</GlassPanel>);
    const el = screen.getByText("content");
    expect(el.tagName).toBe("SECTION");
  });

  it("merges caller className after .glass-panel (Req 2.2)", () => {
    render(<GlassPanel className="extra">content</GlassPanel>);
    const el = screen.getByText("content");
    expect(el.classList.contains("glass-panel")).toBe(true);
    expect(el.classList.contains("extra")).toBe(true);
  });

  it("passes role and aria-label through (Req 2.2)", () => {
    render(
      <GlassPanel role="region" aria-label="Pricing">
        content
      </GlassPanel>,
    );
    const el = screen.getByText("content");
    expect(el.getAttribute("role")).toBe("region");
    expect(el.getAttribute("aria-label")).toBe("Pricing");
  });
});
