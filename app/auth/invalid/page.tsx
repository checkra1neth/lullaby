import React from "react";

/**
 * /auth/invalid — Displayed when a magic link is expired, used, or invalid.
 */
import { GlassPanel } from "@/app/_components/GlassPanel";

export default function AuthInvalidPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <GlassPanel className="mx-auto w-full max-w-sm p-6 text-center">
        <p className="text-lg text-on-surface">
          This link is no longer valid
        </p>
        <a
          href="/auth/sign-in"
          className="mt-4 inline-block text-sm text-accent underline underline-offset-4"
        >
          Request a new sign-in link
        </a>
      </GlassPanel>
    </main>
  );
}
