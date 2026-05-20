/**
 * generateLullaby — Inngest function (Task 13 shell).
 *
 * Triggered by `lullaby/generate.requested`, sent from:
 *   - `/api/stripe/webhook` after a verified one-off `checkout.session.completed`
 *     (Req 6.5, 7.1, 19.1).
 *   - `/api/library/regenerate` after subscription gating passes (Task 25,
 *     Req 16.2, 20).
 *
 * Day-2 task ordering (this file is filled in across Tasks 13–21):
 *   13. load-order + mark-running + outer GenerationFailure wrapper  ✓
 *   14. step.run("lyrics")                                            ✓
 *   15. step.run("tts")                                               ✓
 *   16. step.run("music")                                             ✓
 *   17. step.run("mix")                                               ✓
 *   18. step.run("persist-asset")                                    ✓
 *   19. step.run("share-video") + attach-share-video                ✓
 *   20. step.run("email")                                             ✓
 *   21. outer 300 s wall-clock guard + final mark-succeeded           ✓
 *
 * For Task 17, the `mix` step is wired in. The step is configured with
 * `retries: 0` and a 60 s step timeout (design §6 mix row, Req 11.1).
 * `mixWithFfmpeg` runs the design §7 ffmpeg graph (volume=-12dB on the
 * music, amix=duration=first against narration, loudnorm), encodes
 * libmp3lame at a deterministic bitrate from {128, 160, 192} kbps, and
 * uploads the final mp3 to `lullabies/mp3/{order_id}.mp3` (Req 11.4).
 * Duration ∈ [150, 360] s (Req 11.2) and bitrate ∈ [128, 192] kbps
 * (Req 11.4) are validated post-encode — failures throw a plain Error
 * which we map to `GenerationFailure("mixing_failed")` here so the
 * documented enum reason persists on the row (Req 11.5). Partial mp3s
 * are never uploaded.
 *
 * For Task 18, the `persist-asset` step writes a `lullaby_assets` row
 * with the mix output and links it back to `orders.lullaby_asset_id`.
 * Idempotency is delegated to the schema: `lullaby_assets.order_id` is
 * UNIQUE so the upsert merges into the existing row on Inngest retries
 * (Req 19.2), and `orders.lullaby_asset_id` is also UNIQUE so the link
 * UPDATE — gated on `lullaby_asset_id IS NULL` — is a no-op when a
 * previous attempt already set it (Req 19.1). The step uses Inngest's
 * default per-step retries (effectively 0 here because the function
 * declares `retries: 0` at the top level) — a single DB failure during
 * persist-asset surfaces as a generic Error and propagates through the
 * outer catch as an unknown error rather than a documented enum reason.
 * That's intentional: the only realistic failure mode is the DB being
 * unreachable, and there's no public-facing failure_reason value for
 * "couldn't persist the asset row" in the §6 mapping table.
 *
 * Failure handling (design §6 Failure-reason mapping):
 *   - DB-enum reasons (lyrics_generation_failed, tts_api_error, …) →
 *     `setJobFailed(order_id, reason)` writes
 *     `generation_jobs.status='failed', failure_reason=$1, finished_at=now()`.
 *   - Internal-only reasons (subscription gating, language_not_supported,
 *     order_not_found) → log via `log.warn` only; no DB write.
 *     Subscription-funded orders don't have a `generation_jobs` row at this
 *     point (the row is created by `/api/library/regenerate` only AFTER
 *     gating, Req 20.4) so there is nothing to update.
 */
import { NonRetriableError } from "inngest";

import { GenerationFailure, isJobFailureReason } from "@/lib/gen/failure";
import { loadOrderAndGate } from "@/lib/gen/loadOrder";
import { generateLyrics } from "@/lib/gen/lyrics";
import { mixWithFfmpeg } from "@/lib/gen/mix";
import { requestBackgroundMusic } from "@/lib/gen/music";
import { synthesizeNarration } from "@/lib/gen/narration";
import { persistAsset } from "@/lib/gen/persistAsset";
import { attachShareVideo, renderShareVideo } from "@/lib/gen/shareVideo";
import { sendDeliveryEmail } from "@/lib/email/sendDelivery";
import { inngest, inngestFunctions } from "@/lib/inngest";
import { log } from "@/lib/log";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type GenerateRequestedData = {
  order_id?: unknown;
};

/**
 * Persist a job-failure transition (DB-enum reasons only). The CHECK
 * constraint on `generation_jobs.failure_reason` rejects anything outside
 * the documented enum, so we narrow the type before calling.
 */
async function setJobFailed(orderId: string, reason: string): Promise<void> {
  if (!isJobFailureReason(reason)) {
    // Should be unreachable — the caller already filtered on
    // `isJobFailureReason`. Belt-and-braces guard so a future edit can't
    // accidentally write a non-enum value into the DB.
    return;
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("generation_jobs")
    .update({
      status: "failed",
      failure_reason: reason,
      finished_at: new Date().toISOString(),
    })
    .eq("order_id", orderId);
  if (error) {
    // Don't re-throw — we're already in the outer catch and the original
    // failure reason is more useful than a DB write error here. Just log.
    log.error(
      {
        event: "set_job_failed_write_error",
        order_id: orderId,
        reason,
      },
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export const generateLullaby = inngest.createFunction(
  {
    id: "generateLullaby",
    // Design §6: cap concurrent runs and disable function-level retries; per-
    // step retries are configured on individual `step.run` calls.
    concurrency: 5,
    retries: 0,
    // Outer wall-clock cap (Req 7.6). Task 21 also adds an in-process guard
    // so the cap holds even if Inngest's internal timer drifts.
    timeouts: { finish: "300s" },
  },
  { event: "lullaby/generate.requested" },
  async ({ event, step }) => {
    const data = event.data as GenerateRequestedData | undefined;
    const orderId = typeof data?.order_id === "string" ? data.order_id : undefined;
    if (!orderId) {
      // Bad payload — surface as non-retriable so we don't loop on garbage.
      throw new NonRetriableError("lullaby/generate.requested missing order_id");
    }

    // Capture wall-clock start time for the 300 s outer guard (Req 7.6).
    // Must be set before the try/catch so the guard in the final step can
    // compare against the true function start, not just the last step's
    // completion time.
    const startedAt = Date.now();

    try {
      // Step: load order + apply subscription gating (Req 20). For
      // subscription-funded regenerations, throws BEFORE any
      // `generation_jobs` row is touched.
      const order = await step.run("load-order", () => loadOrderAndGate(orderId));

      // Step: mark running (Req 7.2). Only reached after gating passes —
      // for one-off the row was queued by the webhook (Task 7); for
      // subscription orders Task 25 will queue it before sending the event.
      await step.run("mark-running", async () => {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("generation_jobs")
          .update({
            status: "running",
            started_at: new Date().toISOString(),
          })
          .eq("order_id", order.id);
        if (error) {
          throw new Error(`mark-running failed: ${error.message}`);
        }
        return { ok: true };
      });

      // Step: lyrics (Req 8). Per-step `retries: 1` gives 2 attempts; the
      // 20 s step timeout matches Req 8.6. The `as unknown as { id: string }`
      // cast keeps the design's exact `{ id, retries, timeout }` shape while
      // satisfying the shipped Inngest TS types — those narrow
      // `step.run`'s options to `{ id, name? }` even though the runtime
      // (see `node_modules/inngest/components/InngestStepTools.cjs#getStepOptions`)
      // forwards the full options object verbatim.
      let lyrics: string;
      try {
        lyrics = await step.run(
          {
            id: "lyrics",
            retries: 1,
          } as unknown as { id: string },
          () => generateLyrics(order),
        );
      } catch (lyricsErr) {
        // Both attempts failed. Map any underlying error (OpenAI failure,
        // per-call timeout, validation rejection) to the documented
        // failure reason so the outer catch persists it on the
        // generation_jobs row (Req 8.6, design §6 mapping).
        log.error(
          {
            event: "lyrics_step_failed",
            order_id: order.id,
            // The error message itself is non-PII (the validators throw
            // tags like `lyrics_word_count_too_low:79<80`), but we still
            // pass `pii` so any future free-form Error.message picked up
            // here gets masked by the redactor (Req 18).
            pii: [order.child_name, ...order.favorites],
          },
          lyricsErr instanceof Error ? lyricsErr : new Error(String(lyricsErr)),
        );
        throw new GenerationFailure("lyrics_generation_failed");
      }

      // Step: tts (Req 9). Per-step `retries: 1` gives 2 attempts; 30 s
      // per-attempt timeout, 2 s delay between attempts (Req 9.3). Empty
      // `narrator_voice_id` short-circuits inside `synthesizeNarration`
      // to `GenerationFailure("missing_voice_id")` BEFORE any API call —
      // it propagates through the catch below to the outer wrapper
      // unchanged, so Inngest sees the typed failure (not a retriable
      // Error) and the right reason lands on generation_jobs (Req 9.4).
      let narration: { object_key: string; duration_seconds: number };
      try {
        narration = await step.run(
          {
            id: "tts",
            retries: 1,
            timeout: "30s",
            delay: "2s",
          } as unknown as { id: string },
          () => synthesizeNarration(order, lyrics),
        );
      } catch (ttsErr) {
        // Pass typed failures (missing_voice_id) through untouched so the
        // outer catch maps them to the right enum reason. Anything else
        // — API HTTP error, request timeout, upload failure — was already
        // retried once by Inngest, so collapse it to tts_api_error
        // (Req 9.3).
        if (ttsErr instanceof GenerationFailure) {
          throw ttsErr;
        }
        log.error(
          {
            event: "tts_step_failed",
            order_id: order.id,
            // Defense-in-depth — the error tags emitted by
            // `synthesizeNarration` (`tts_http_*`, `tts_request_timeout`,
            // …) are non-PII, but redact anyway so a future free-form
            // message can't leak the child's name (Req 18).
            pii: [order.child_name, ...order.favorites],
          },
          ttsErr instanceof Error ? ttsErr : new Error(String(ttsErr)),
        );
        throw new GenerationFailure("tts_api_error");
      }

      // Persist the narration object key so the row reflects progress
      // even if a downstream step (music / mix / video) later fails.
      // Wrapped in its own `step.run` so an Inngest retry of the function
      // skips this DB write when the tts step's result is replayed from
      // the durable cache (Req 19.3).
      await step.run("update-narration-key", async () => {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("generation_jobs")
          .update({ narration_object_key: narration.object_key })
          .eq("order_id", order.id);
        if (error) {
          throw new Error(`update-narration-key failed: ${error.message}`);
        }
        return { ok: true };
      });

      // Step: music (Req 10). `retries: 0` + 120 s step timeout → a single
      // failure is final. The per-fetch wall-clock guard inside
      // `requestBackgroundMusic` is set under 120 s so the abort surfaces
      // as a regular Error here rather than as an Inngest-level step
      // timeout. `target_seconds` is anchored to the narration duration
      // so the produced track is at least as long as the narration
      // (Req 10.1, 10.3); `max_seconds` is `narration + 30` (Req 10.3
      // upper bound). The `insufficient_music_duration` typed failure is
      // raised inside `requestBackgroundMusic` itself when the produced
      // track comes back shorter than the narration (Req 10.5) — we let
      // it through unchanged so the outer wrapper persists that exact
      // enum reason.
      let music: { object_key: string; duration_seconds: number };
      try {
        music = await step.run(
          {
            id: "music",
            retries: 0,
            timeout: "120s",
          } as unknown as { id: string },
          () =>
            requestBackgroundMusic({
              orderId: order.id,
              mood: order.mood,
              target_seconds: narration.duration_seconds,
              max_seconds: narration.duration_seconds + 30,
            }),
        );
      } catch (musicErr) {
        // Pass typed failures (insufficient_music_duration) through
        // unchanged. Anything else — API HTTP error, request timeout,
        // empty body, upload failure — collapses to the documented
        // `music_generation_failed` enum (Req 10.4).
        if (musicErr instanceof GenerationFailure) {
          throw musicErr;
        }
        log.error(
          {
            event: "music_step_failed",
            order_id: order.id,
            // The error tags emitted by `requestBackgroundMusic`
            // (`music_http_*`, `music_request_timeout`, …) are non-PII;
            // redact `pii` defensively in case a future free-form
            // upstream message slips through (Req 18).
            pii: [order.child_name, ...order.favorites],
          },
          musicErr instanceof Error ? musicErr : new Error(String(musicErr)),
        );
        throw new GenerationFailure("music_generation_failed");
      }

      // Persist the music object key — same progress-recording rationale
      // as `update-narration-key` above.
      await step.run("update-music-key", async () => {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("generation_jobs")
          .update({ music_object_key: music.object_key })
          .eq("order_id", order.id);
        if (error) {
          throw new Error(`update-music-key failed: ${error.message}`);
        }
        return { ok: true };
      });

      // Step: mix (Req 11). `retries: 0` + 60 s step timeout → a single
      // failure is final. The mix combines narration + music with the
      // design §7 ffmpeg graph (`amix=duration=first` + −12 dB music
      // attenuation + `loudnorm`), encodes via libmp3lame at a
      // deterministic bitrate from {128, 160, 192} kbps, and uploads to
      // `lullabies/mp3/{order_id}.mp3`. The function validates final
      // duration ∈ [150, 360] s (Req 11.2) and bitrate ∈ [128, 192] kbps
      // (Req 11.4) before uploading — partial mp3s are NEVER persisted
      // (Req 11.5). On any non-zero ffmpeg exit or validation failure
      // we collapse to `GenerationFailure("mixing_failed")` so the
      // documented enum reason lands on generation_jobs.
      let mp3: {
        object_key: string;
        duration_seconds: number;
        bitrate_kbps: 128 | 160 | 192;
      };
      try {
        mp3 = await step.run(
          {
            id: "mix",
            retries: 0,
            timeout: "60s",
          } as unknown as { id: string },
          () =>
            mixWithFfmpeg({
              orderId: order.id,
              narrationObjectKey: narration.object_key,
              musicObjectKey: music.object_key,
            }),
        );
      } catch (mixErr) {
        if (mixErr instanceof GenerationFailure) {
          throw mixErr;
        }
        log.error(
          {
            event: "mix_step_failed",
            order_id: order.id,
            // Mix-step error tags (`ffmpeg_exit_nonzero`,
            // `mix_validation_failed`, `mix_upload_failed`) are non-PII,
            // but redact `pii` defensively (Req 18) in case a future
            // upstream message slips through.
            pii: [order.child_name, ...order.favorites],
          },
          mixErr instanceof Error ? mixErr : new Error(String(mixErr)),
        );
        throw new GenerationFailure("mixing_failed");
      }

      // Step: persist-asset (Req 11.4, 19.1–19.4). Inserts a
      // `lullaby_assets` row keyed on `order_id` (UNIQUE → idempotent on
      // Inngest retries) and links `orders.lullaby_asset_id`. A DB
      // failure here surfaces as a plain Error and falls through to the
      // outer catch as an unknown error — there's no documented
      // `failure_reason` enum for persist-asset failures (design §6
      // Failure-reason mapping table), which matches the task brief.
      void music;
      void narration;
      const persisted = await step.run("persist-asset", () =>
        persistAsset({
          orderId: order.id,
          mp3,
        }),
      );

      // Step: share-video (Req 12). `retries: 0` + 90 s step timeout →
      // a single failure is final. `renderShareVideo` runs the design §7
      // ffmpeg filter graph: trims the closing 15–30 s of the MP3
      // (t0 = max(0, mp3_duration - 30)), renders a 720x1280 background
      // with a showwaves waveform overlay and a drawtext child-name
      // overlay (truncated to 24 chars with "…"), encodes H.264 + AAC,
      // and uploads to `lullabies/share-videos/{asset_id}.mp4`.
      // On any render or upload failure it throws
      // `GenerationFailure("share_video_upload_failed")` which the outer
      // catch maps to the documented enum reason (Req 12.8).
      let shareVideo: { object_key: string };
      try {
        shareVideo = await step.run(
          {
            id: "share-video",
            retries: 0,
            timeout: "90s",
          } as unknown as { id: string },
          () =>
            renderShareVideo({
              assetId: persisted.asset_id,
              mp3ObjectKey: mp3.object_key,
              mp3DurationSeconds: mp3.duration_seconds,
              childName: order.child_name,
            }),
        );
      } catch (svErr) {
        // Pass typed failures (share_video_upload_failed) through
        // unchanged so the outer catch persists the right enum reason.
        if (svErr instanceof GenerationFailure) {
          throw svErr;
        }
        log.error(
          {
            event: "share_video_step_failed",
            order_id: order.id,
            // Error tags from renderShareVideo are non-PII, but redact
            // defensively in case a future free-form message slips
            // through (Req 18).
            pii: [order.child_name],
          },
          svErr instanceof Error ? svErr : new Error(String(svErr)),
        );
        throw new GenerationFailure("share_video_upload_failed");
      }

      // Step: attach-share-video (Req 12.7). Sets
      // `lullaby_assets.share_video_object_key` after a successful
      // upload. Wrapped in its own `step.run` so an Inngest retry of the
      // function skips this DB write when the share-video step's result
      // is replayed from the durable cache (Req 19.3).
      await step.run("attach-share-video", () =>
        attachShareVideo(persisted.asset_id, shareVideo.object_key),
      );

      // Step: send delivery email (Req 14). `retries: 3` + exponential
      // backoff + 10 m step timeout (design §6 email step, Req 14.3).
      // `sendDeliveryEmail` is idempotent on `orders.delivery_email_sent_at`:
      //   - If already set, it short-circuits and returns `{ outcome: "skipped" }`
      //     without calling Resend (Req 14.5).
      //   - On a successful Resend call it writes `delivery_email_sent_at=now()`
      //     gated on `IS NULL` — a zero-row UPDATE (race) is still treated as
      //     complete and does NOT trigger a resend (Req 14.6).
      //   - One row is appended to `delivery_email_log` per attempt (Req 14.3).
      // Inngest's step-level retry counter is passed as `attempt` so the log
      // row reflects which attempt number this is (1-indexed, clamped to [1,3]).
      // Any throw from `sendDeliveryEmail` (transient Resend error) propagates
      // to Inngest which retries the step with exponential backoff.
      let emailAttempt = 0;
      await step.run(
        {
          id: "email",
          retries: 3,
          backoff: "exponential",
          timeout: "10m",
        } as unknown as { id: string },
        async () => {
          emailAttempt += 1;
          return sendDeliveryEmail({
            orderId: order.id,
            assetId: persisted.asset_id,
            parentEmail: order.parent_email,
            attempt: emailAttempt,
          });
        },
      );

      // Outer 300 s wall-clock guard (Req 7.6). Checked after all
      // generation steps complete so that a slow-but-successful pipeline
      // that finishes just over the limit is still marked failed rather
      // than succeeded. The Inngest-level `timeouts: { finish: "300s" }`
      // is the primary cap; this in-process guard ensures the documented
      // `timeout` failure_reason is persisted on the generation_jobs row
      // even if Inngest's internal timer drifts (design §6 outer guard).
      if (Date.now() - startedAt > 300_000) {
        throw new GenerationFailure("timeout");
      }

      // Final step: mark the job succeeded (Req 7.2). Only reached when
      // all generation steps completed within the 300 s budget. The
      // `finished_at` timestamp is set here so the delivery page can
      // display an accurate completion time.
      await step.run("mark-succeeded", async () => {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("generation_jobs")
          .update({
            status: "succeeded",
            finished_at: new Date().toISOString(),
          })
          .eq("order_id", order.id);
        if (error) {
          throw new Error(`mark-succeeded failed: ${error.message}`);
        }
        return { ok: true };
      });

      return { order_id: order.id, status: "succeeded" };
    } catch (err) {
      if (err instanceof GenerationFailure) {
        const reason = err.reason;
        if (isJobFailureReason(reason)) {
          // DB-enum reason — persist on the existing generation_jobs row.
          await setJobFailed(orderId, reason);
          log.warn({
            event: "generation_failed",
            order_id: orderId,
            reason,
          });
        } else {
          // Internal-only reason (subscription gating, language gate,
          // order_not_found-via-failure). NEVER write to generation_jobs —
          // for subscription regen the row doesn't exist yet (Req 20.4),
          // and the other internal reasons describe requests that should
          // never have reached this function.
          log.warn({
            event: "subscription_gating_failed",
            order_id: orderId,
            reason,
          });
        }
        // Surface to Inngest as non-retriable so the failure is final and
        // the parent can see the reason in logs / job row immediately.
        throw new NonRetriableError(reason);
      }
      // Unknown error — let Inngest record it. With `retries: 0` it surfaces
      // once and the function ends in error state.
      throw err;
    }
  },
);

// Register with the shared list consumed by `app/api/inngest/route.ts`.
inngestFunctions.push(generateLullaby);
