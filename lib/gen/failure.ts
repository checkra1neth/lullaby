/**
 * GenerationFailure — typed failure class for the lullaby pipeline.
 *
 * The Inngest function (`generateLullaby`) throws `GenerationFailure(reason)`
 * from any step that hits a documented failure mode (design §6 Failure-reason
 * mapping). The outer wrapper differentiates two classes of reasons:
 *
 *   1. DB-enum reasons (`JobFailureReason`) — listed in the
 *      `generation_jobs.failure_reason` CHECK constraint
 *      (`supabase/migrations/0001_init.sql`). These map to
 *      `setJobFailed(order_id, reason)` which writes
 *      `status='failed', failure_reason=$1` on the existing row.
 *
 *   2. Internal-only reasons (`InternalFailureReason`) — gating-stage failures
 *      that occur BEFORE a `generation_jobs` row exists (subscription gating
 *      for library-funded regenerations, Req 20.1–20.5) plus the
 *      defense-in-depth `language_not_supported` (Req 21.7) and the
 *      shouldn't-happen `order_not_found`. These NEVER touch the DB; the
 *      outer wrapper just emits a redacted log entry anchored on `order_id`.
 *
 * Keeping the two sets typed lets the wrapper assert at compile time that we
 * only ever persist a string the DB CHECK accepts (Req 7.7).
 */

/**
 * Failure reasons accepted by the `generation_jobs.failure_reason` CHECK.
 * Source of truth: `supabase/migrations/0001_init.sql`.
 */
export const JOB_FAILURE_REASONS = [
  "lyrics_generation_failed",
  "tts_api_error",
  "missing_voice_id",
  "music_generation_failed",
  "insufficient_music_duration",
  "mixing_failed",
  "share_video_upload_failed",
  "timeout",
] as const;

export type JobFailureReason = (typeof JOB_FAILURE_REASONS)[number];

/**
 * Failure reasons that are NOT persisted to `generation_jobs.failure_reason`
 * (they occur before any row exists, or describe a request that never should
 * have reached the pipeline). The outer wrapper logs these and exits.
 */
export const INTERNAL_FAILURE_REASONS = [
  // Subscription-gating reasons (Req 20). The job row hasn't been created yet
  // for subscription-funded regenerations — `/api/library/regenerate`
  // (Task 25) creates the row only after gating passes.
  "no_eligible_subscription",
  "subscription_not_eligible",
  "subscription_verification_failed",
  // Defense-in-depth: the form already rejects non-`en` (Req 2.7), and the
  // DB CHECK enforces `language='en'`. If something slips through, fail
  // closed without trying to persist a non-enum reason. (Req 21.7)
  "language_not_supported",
  // Shouldn't happen — the webhook just inserted the row before sending the
  // event. Treat as non-retriable so Inngest doesn't loop.
  "order_not_found",
] as const;

export type InternalFailureReason = (typeof INTERNAL_FAILURE_REASONS)[number];

export type GenerationFailureReason = JobFailureReason | InternalFailureReason;

const JOB_FAILURE_REASON_SET: ReadonlySet<string> = new Set(JOB_FAILURE_REASONS);

/** Type-guard: is `reason` one of the DB CHECK-accepted enum values? */
export function isJobFailureReason(reason: string): reason is JobFailureReason {
  return JOB_FAILURE_REASON_SET.has(reason);
}

/**
 * Typed failure class for the generation pipeline. The Inngest function
 * outer catch routes `GenerationFailure` instances to either
 * `setJobFailed(order_id, reason)` (DB-enum reasons) or a redacted log entry
 * (internal reasons).
 *
 * The constructor message defaults to `reason` so stack traces stay
 * non-PII (Req 7.7, 18.1).
 */
export class GenerationFailure extends Error {
  /** Discriminant: which failure mode hit. */
  readonly reason: GenerationFailureReason;

  constructor(reason: GenerationFailureReason, message?: string) {
    super(message ?? reason);
    this.name = "GenerationFailure";
    this.reason = reason;
    // Restore the prototype chain across older TS targets so
    // `err instanceof GenerationFailure` works after re-throw.
    Object.setPrototypeOf(this, GenerationFailure.prototype);
  }
}
