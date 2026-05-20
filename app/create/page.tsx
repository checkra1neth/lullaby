import React from "react";

/**
 * `/create` lullaby form (Req 2, 21.7).
 *
 * Server component that loads the preset narrator voice ids from the
 * server-only env (`ELEVENLABS_VOICE_IDS`) and hands them to the client form.
 * Keeping env access here means the client component never imports `lib/env`
 * or reads `process.env` for server-only secrets.
 *
 * If the env is unparseable at request time we log the error and render a
 * graceful "voices unavailable" fallback (form still renders the rest of the
 * fields disabled, per the implementation note in tasks.md task 5).
 */
import { parseAllowedVoiceIds } from "@/lib/forms/lullaby";
import { LullabyForm } from "./LullabyForm";

export const dynamic = "force-dynamic";

export default function CreatePage() {
  let allowedVoiceIds: string[] = [];
  let voicesError: string | null = null;
  try {
    allowedVoiceIds = parseAllowedVoiceIds(process.env.ELEVENLABS_VOICE_IDS);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[create] failed to load voice ids:", (err as Error).message);
    voicesError = "voices unavailable, please try later";
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10 sm:py-14">
      <header className="mb-8 text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl text-shadow-md">
          Make your child&apos;s{" "}
          <span className="text-accent">lullaby</span>
        </h1>
        <p className="mt-3 text-sm text-on-surface/80 max-w-md mx-auto leading-relaxed text-balance text-shadow-sm">
          Tell us a little about your child. We&apos;ll personalize the lullaby
          with their name, favorite things, and the mood you choose.
        </p>
      </header>

      {voicesError ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          {voicesError}
        </div>
      ) : null}

      <LullabyForm allowedVoiceIds={allowedVoiceIds} />
    </main>
  );
}
