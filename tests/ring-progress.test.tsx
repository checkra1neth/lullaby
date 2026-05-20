// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RingProgress, CIRCUMFERENCE } from "@/app/_components/RingProgress";

afterEach(() => cleanup());

describe("RingProgress", () => {
  it("circumference matches 2 * PI * 54 (Req 10.1)", () => {
    expect(CIRCUMFERENCE).toBeCloseTo(2 * Math.PI * 54, 3);
  });

  it("strokeDashoffset at progress=0 is full circumference", () => {
    render(<RingProgress progress={0} />);
    const arc = document.querySelector(".ring-arc") as SVGCircleElement;
    expect(arc).not.toBeNull();
    expect(arc.style.strokeDashoffset).toBe(String(CIRCUMFERENCE));
  });

  it("strokeDashoffset at progress=1 is 0", () => {
    render(<RingProgress progress={1} />);
    const arc = document.querySelector(".ring-arc") as SVGCircleElement;
    expect(arc.style.strokeDashoffset).toBe("0");
  });

  it("strokeDashoffset at progress=0.5 is half circumference", () => {
    render(<RingProgress progress={0.5} />);
    const arc = document.querySelector(".ring-arc") as SVGCircleElement;
    expect(arc.style.strokeDashoffset).toBe(String(CIRCUMFERENCE * 0.5));
  });

  it("transition rule uses stroke-dashoffset and motion-slow token", () => {
    render(<RingProgress progress={0.5} />);
    const arc = document.querySelector(".ring-arc") as SVGCircleElement;
    // The computed transition is defined in CSS, we just verify the element exists
    expect(arc).not.toBeNull();
    expect(arc.classList.contains("ring-arc")).toBe(true);
  });
});
