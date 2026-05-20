// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StepCard } from "@/app/_components/StepCard";

afterEach(() => cleanup());

describe("StepCard", () => {
  it("renders data-state attribute reflecting prop (Req 10.2)", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="pending" />);
    const li = document.querySelector(".step-card");
    expect(li!.getAttribute("data-state")).toBe("pending");
  });

  it("badge text for pending state", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="pending" />);
    expect(screen.getByText("Up next")).not.toBeNull();
  });

  it("badge text for active state", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="active" />);
    expect(screen.getByText("In progress")).not.toBeNull();
  });

  it("badge text for done state", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="done" />);
    expect(screen.getByText("Done")).not.toBeNull();
  });

  it("active state shows a spinner", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="active" />);
    const spinner = document.querySelector(".step-spinner");
    expect(spinner).not.toBeNull();
  });

  it("done state shows a check mark", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="done" />);
    const check = document.querySelector(".step-check");
    expect(check).not.toBeNull();
  });

  it("pending state shows no indicator", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="pending" />);
    expect(document.querySelector(".step-spinner")).toBeNull();
    expect(document.querySelector(".step-check")).toBeNull();
  });

  it("sets inline --index custom property for stagger", () => {
    render(<StepCard iconName="auto_awesome" label="Writing" state="active" index={2} />);
    const li = document.querySelector(".step-card") as HTMLElement;
    expect(li.style.getPropertyValue("--index")).toBe("2");
  });
});
