"use client";

/**
 * /auth/sign-in — Magic-link sign-in form (Req 15).
 *
 * Minimal form that accepts an email address and POSTs to /api/auth/magic.
 * After submission, shows the generic confirmation message regardless of
 * whether the email is registered (Req 15.5).
 *
 * Preserves ?next= so the callback can redirect back to the original page.
 */
import React from "react";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { GlassPanel } from "@/app/_components/GlassPanel";
import { CtaButton } from "@/app/_components/CtaButton";

type FormState = "idle" | "submitting" | "submitted" | "error";

function SignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/library";

  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/auth/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.status === 400) {
        const data = await res.json();
        setErrorMessage(
          data.issues?.[0]?.message || "Please enter a valid email address.",
        );
        setState("error");
        return;
      }

      setState("submitted");
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setState("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <GlassPanel className="mx-auto w-full max-w-sm p-6">
        {state === "submitted" ? (
          <div className="text-center">
            <h1 className="mb-4 text-2xl font-semibold text-on-surface">
              Check your email
            </h1>
            <p className="text-on-surface-v">
              If that email is registered, we sent you a sign-in link. It
              expires in 30 minutes.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mb-2 text-center text-2xl font-semibold text-on-surface">
              Sign in to Lullaby
            </h1>
            <p className="mb-6 text-center text-sm text-on-surface-v">
              We&rsquo;ll send you a magic link to access your lullabies.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-medium text-on-surface"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="parent@example.com"
                  className="ll-input"
                  disabled={state === "submitting"}
                />
              </div>

              {state === "error" && errorMessage && (
                <p className="text-sm text-red-400" role="alert">
                  {errorMessage}
                </p>
              )}

              <CtaButton type="submit" fullWidth>
                {state === "submitting" ? "Sending…" : "Send magic link"}
              </CtaButton>

              {/* Hidden field to preserve the redirect target */}
              <input type="hidden" name="next" value={next} />
            </form>
          </>
        )}
      </GlassPanel>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center px-4">
          <GlassPanel className="mx-auto w-full max-w-sm p-6 text-center">
            <p className="text-on-surface-v">Loading…</p>
          </GlassPanel>
        </main>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
