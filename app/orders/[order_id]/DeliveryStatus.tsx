"use client";

/**
 * Client-side delivery surface for `/orders/[order_id]` (Req 10–12).
 *
 * Polls `/api/orders/[order_id]/status` every 3 s while the generation job
 * is in `queued` or `running`, with cleanup on unmount and `AbortController`
 * cancellation of in-flight fetches.
 *
 * The polling logic, abort semantics, and failure-reason mapping are preserved
 * verbatim from the existing implementation (Req 10.5, 20).
 */
import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { lullabyFilename } from "@/lib/forms/lullabyFilename";
import { GlassPanel } from "@/app/_components/GlassPanel";
import { CtaButton } from "@/app/_components/CtaButton";
import { RingProgress } from "@/app/_components/RingProgress";
import { StepCard } from "@/app/_components/StepCard";
import { Icon } from "@/app/_components/Icon";

const POLL_INTERVAL_MS = 3_000;
const SUPPORT_EMAIL = "support@lullaby.demo";

type JobStatus = "queued" | "running" | "succeeded" | "failed";

interface StatusResponse {
  status: JobStatus;
  failure_reason?: string;
}

type AuthError = "forbidden" | "not_found";

interface DeliveryStatusProps {
  orderId: string;
  childName: string;
  assetId: string | null;
}

const FAILURE_COPY: Record<string, string> = {
  lyrics_generation_failed:
    "We couldn't write the lyrics this time. Try creating a new lullaby.",
  tts_api_error:
    "The narrator voice service is having a moment. Try creating a new lullaby.",
  missing_voice_id:
    "No narrator voice was selected for this order. Reach out and we'll fix it.",
  music_generation_failed:
    "The music service didn't return a track. Try creating a new lullaby.",
  insufficient_music_duration:
    "The music came back shorter than the narration. Try creating a new lullaby.",
  mixing_failed:
    "Something went wrong while mixing the final audio. Try creating a new lullaby.",
  share_video_upload_failed:
    "We made the lullaby but couldn't upload the share video. Reach out and we'll resend.",
  timeout: "Generation took longer than 5 minutes and we stopped it.",
};

function progressFor(status: JobStatus | null): number {
  if (status === "queued") return 0.15;
  if (status === "running") return 0.55;
  return 0;
}

export function DeliveryStatus({
  orderId,
  childName,
  assetId,
}: DeliveryStatusProps) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [authError, setAuthError] = useState<AuthError | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async (): Promise<JobStatus | null> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "GET",
        signal: ctrl.signal,
        cache: "no-store",
      });

      if (res.status === 403) {
        setAuthError("forbidden");
        return null;
      }
      if (res.status === 404) {
        setAuthError("not_found");
        return null;
      }
      if (!res.ok) {
        return null;
      }

      const body = (await res.json()) as StatusResponse;
      setStatus(body.status);
      setFailureReason(body.failure_reason ?? null);
      setAuthError(null);
      return body.status;
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        return null;
      }
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const initial = await fetchStatus();
      if (cancelled) return;

      if (initial === "queued" || initial === "running" || initial === null) {
        timer = setInterval(async () => {
          const next = await fetchStatus();
          if (
            next === "succeeded" ||
            next === "failed" ||
            (next === null && abortRef.current === null)
          ) {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        }, POLL_INTERVAL_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [fetchStatus]);

  const isTerminal =
    status === "succeeded" || status === "failed" || authError !== null;

  // ---- Render branches --------------------------------------------------

  if (authError === "forbidden") {
    return <ForbiddenNotice orderId={orderId} />;
  }
  if (authError === "not_found") {
    return <NotFoundNotice />;
  }

  if (status === "failed") {
    return (
      <FailedSurface failureReason={failureReason} childName={childName} />
    );
  }

  if (status === "succeeded") {
    if (!assetId) {
      return <SucceededNoAssetSurface />;
    }
    return (
      <SucceededSurface assetId={assetId} childName={childName} />
    );
  }

  // queued | running | initial-loading
  return (
    <PollingSurface
      status={status}
      childName={childName}
      isTerminal={isTerminal}
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function PollingSurface({
  status,
  childName,
  isTerminal,
}: {
  status: JobStatus | null;
  childName: string;
  isTerminal: boolean;
}) {
  const firstName = useMemo(
    () => childName.trim().split(/\s+/, 1)[0] ?? "",
    [childName],
  );

  const label =
    status === "running"
      ? `Recording ${firstName ? firstName + "'s" : "your"} lullaby`
      : `Queued — preparing ${firstName ? firstName + "'s" : "your"} lullaby`;

  return (
    <section className="flex flex-col items-center gap-5 text-center">
      <h1 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {firstName
          ? `${firstName}'s lullaby is on the way`
          : "Your lullaby is on the way"}
      </h1>
      <p className="text-on-surface-v">
        We&rsquo;re writing the lyrics, recording the voice, and composing the
        music. This usually takes a couple of minutes.
      </p>

      <RingProgress progress={progressFor(status)}>
        <Icon name="auto_awesome" filled size={28} />
      </RingProgress>

      <div
        role="progressbar"
        aria-busy={!isTerminal}
        aria-label={label}
        className="sr-only"
      />

      <ol className="step-list flex w-full max-w-sm flex-col gap-3">
        <StepCard
          iconName="auto_awesome"
          label="Writing the lullaby"
          state={status === "running" ? "done" : status === "queued" ? "active" : "pending"}
          index={0}
        />
        <StepCard
          iconName="record_voice_over"
          label="Recording the voice"
          state={status === "running" ? "active" : "pending"}
          index={1}
        />
        <StepCard
          iconName="music_note"
          label="Composing the music"
          state="pending"
          index={2}
        />
      </ol>

      <p className="text-sm text-on-surface-v" aria-live="polite">
        {status === "running"
          ? "Status: recording…"
          : status === "queued"
            ? "Status: queued…"
            : "Checking status…"}
      </p>
    </section>
  );
}

function SucceededSurface({
  assetId,
  childName,
}: {
  assetId: string;
  childName: string;
}) {
  const dateStamp = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const mp3Url = `/api/assets/${assetId}/mp3`;
  const videoUrl = `/api/assets/${assetId}/share-video`;
  const mp3Name = lullabyFilename(childName, "mp3", dateStamp);
  const videoName = lullabyFilename(childName, "mp4", dateStamp);

  const firstName = childName.trim().split(/\s+/, 1)[0] ?? "";

  return (
    <section className="flex flex-col gap-5 page-anim">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {firstName
            ? `${firstName}'s lullaby is ready`
            : "Your lullaby is ready"}
        </h1>
        <p className="text-on-surface-v">
          Press play to listen, or download the files to keep.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
        <GlassPanel
          className="player-anim flex flex-col gap-2 p-4"
          style={{ "--index": 0 } as React.CSSProperties}
        >
          <h2 className="text-xs font-medium uppercase tracking-widest text-accent">
            Lullaby (MP3)
          </h2>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            controls
            preload="metadata"
            src={mp3Url}
            aria-label="Lullaby MP3"
            className="w-full"
          />
          <CtaButton href={mp3Url} download={mp3Name} iconName="download">
            Download MP3
          </CtaButton>
        </GlassPanel>

        <GlassPanel
          className="player-anim flex flex-col gap-2 p-4"
          style={{ "--index": 1 } as React.CSSProperties}
        >
          <h2 className="text-xs font-medium uppercase tracking-widest text-accent">
            Share video (9:16)
          </h2>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            controls
            preload="metadata"
            src={videoUrl}
            aria-label="Lullaby share video"
            className="aspect-[9/16] w-full max-w-[180px] self-center rounded-lg bg-bg lg:max-w-[200px]"
          />
          <CtaButton href={videoUrl} download={videoName} iconName="download">
            Download share video
          </CtaButton>
        </GlassPanel>
      </div>
    </section>
  );
}

function SucceededNoAssetSurface() {
  return (
    <section className="flex flex-col items-center gap-4 text-center page-anim">
      <h1 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        Lullaby ready
      </h1>
      <p className="text-on-surface-v">
        Asset upload is still wrapping up. Refresh in a moment to play and
        download.
      </p>
      <CtaButton href="#" onClick={() => window.location.reload()}>
        Refresh
      </CtaButton>
    </section>
  );
}

function FailedSurface({
  failureReason,
  childName,
}: {
  failureReason: string | null;
  childName: string;
}) {
  let friendly: string;
  try {
    friendly =
      failureReason && FAILURE_COPY[failureReason]
        ? FAILURE_COPY[failureReason]
        : (failureReason ??
          "Something went wrong while generating the lullaby.");
  } catch {
    friendly = "Generation didn't complete";
  }

  const slug = useMemo(
    () =>
      lullabyFilename(childName, "txt").replace(
        /^lullaby-|-\d{4}-\d{2}-\d{2}\.txt$/g,
        "",
      ),
    [childName],
  );
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Lullaby help: ${slug}`,
  )}`;

  return (
    <section className="flex flex-col items-center gap-4 text-center page-anim">
      <GlassPanel className="flex flex-col items-center gap-4 p-6 text-center">
        <Icon name="error_outline" size={32} className="text-accent" />
        <h1 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Generation didn&rsquo;t complete
        </h1>
        <p className="text-on-surface-v">{friendly}</p>
        <div className="w-full rounded-lg bg-surface-lowest p-3 text-left">
          <p className="text-xs text-on-surface-v">Reference code:</p>
          <code className="text-sm text-accent">{failureReason ?? "unknown"}</code>
        </div>
        <CtaButton href={mailto}>Contact support</CtaButton>
      </GlassPanel>
    </section>
  );
}

function ForbiddenNotice({ orderId }: { orderId: string }) {
  const next = encodeURIComponent(`/orders/${orderId}`);
  return (
    <section className="flex flex-col items-center gap-4 text-center page-anim">
      <GlassPanel className="flex flex-col items-center gap-4 p-6 text-center">
        <h1 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          You&rsquo;re not signed in
        </h1>
        <p className="text-on-surface-v">
          Sign in with the email you used at checkout to see this lullaby.
        </p>
        <CtaButton href={`/auth/sign-in?next=${next}`}>
          Send me a sign-in link
        </CtaButton>
      </GlassPanel>
    </section>
  );
}

function NotFoundNotice() {
  return (
    <section className="flex flex-col items-center gap-4 text-center page-anim">
      <GlassPanel className="flex flex-col items-center gap-4 p-6 text-center">
        <h1 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Order not found
        </h1>
        <p className="text-on-surface-v">
          We couldn&rsquo;t find that order. Check the link from your
          confirmation email.
        </p>
      </GlassPanel>
    </section>
  );
}
