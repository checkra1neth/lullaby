// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Icon } from "@/app/_components/Icon";

afterEach(() => {
  cleanup();
});

describe("Icon", () => {
  it("renders aria-hidden by default when no aria-label is provided (Req 5.3)", () => {
    render(<Icon name="bedtime" />);
    const span = screen.getByText("bedtime");
    expect(span.getAttribute("aria-hidden")).toBe("true");
    expect(span.hasAttribute("role")).toBe(false);
  });

  it("renders role=img and aria-label when labelled (Req 5.3)", () => {
    render(<Icon name="bedtime" aria-label="Bedtime icon" />);
    const span = screen.getByLabelText("Bedtime icon");
    expect(span.getAttribute("role")).toBe("img");
    expect(span.getAttribute("aria-label")).toBe("Bedtime icon");
    expect(span.hasAttribute("aria-hidden")).toBe(false);
  });

  it("sets font-variation-settings for filled=false (Req 5.2)", () => {
    render(<Icon name="spa" filled={false} weight={300} />);
    const span = screen.getByText("spa");
    expect(span.style.fontVariationSettings).toBe("'FILL' 0, 'wght' 300");
  });

  it("sets font-variation-settings for filled=true (Req 5.2)", () => {
    render(<Icon name="spa" filled={true} weight={400} />);
    const span = screen.getByText("spa");
    expect(span.style.fontVariationSettings).toBe("'FILL' 1, 'wght' 400");
  });

  it("sets the pixel size via font-size (Req 5.2)", () => {
    render(<Icon name="music_note" size={32} />);
    const span = screen.getByText("music_note");
    expect(span.style.fontSize).toBe("32px");
  });

  it("keeps inline-block sizing for fallback when font class is absent (Req 5.5)", () => {
    render(<Icon name="bedtime" />);
    const span = screen.getByText("bedtime");
    expect(span.classList.contains("material-symbols-outlined")).toBe(true);
  });

  it("merges additional className", () => {
    render(<Icon name="bedtime" className="my-icon" />);
    const span = screen.getByText("bedtime");
    expect(span.classList.contains("material-symbols-outlined")).toBe(true);
    expect(span.classList.contains("my-icon")).toBe(true);
  });
});
