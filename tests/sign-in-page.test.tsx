// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignInPage from "@/app/auth/sign-in/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => cleanup());

describe("Sign-in page (Req 15)", () => {
  it("renders form inside .glass-panel of max-width 384 px", () => {
    render(<SignInPage />);
    const panel = document.querySelector(".glass-panel");
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains("max-w-sm")).toBe(true);
  });

  it("applies .ll-input to email field (Req 15.3)", () => {
    render(<SignInPage />);
    const email = screen.getByLabelText(/Email address/);
    expect(email.classList.contains("ll-input")).toBe(true);
  });

  it("submit button is a CtaButton (Req 15.4)", () => {
    render(<SignInPage />);
    const btn = screen.getByRole("button", { name: /Send magic link/i });
    expect(btn.closest(".cta-btn")).not.toBeNull();
  });

  it("shows no off-brand color classes in rendered tree", () => {
    render(<SignInPage />);
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/text-gray-/);
    expect(html).not.toMatch(/bg-indigo-/);
    expect(html).not.toMatch(/border-gray-/);
  });
});
