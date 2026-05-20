/**
 * sendDeliveryEmail — Resend delivery email for the lullaby pipeline
 * (Task 20, design §6 Generation Pipeline – email step, Req 14).
 *
 * Responsibilities:
 *   1. Idempotency guard: read `orders.delivery_email_sent_at`. If already
 *      set, short-circuit and return without sending (Req 14.5).
 *   2. Build the email body with:
 *        - Delivery page link: `NEXT_PUBLIC_APP_URL/orders/{order_id}`
 *        - Signed download link for the MP3:
 *          `NEXT_PUBLIC_APP_URL/api/assets/{asset_id}/mp3`
 *        - Signed download link for the share video:
 *          `NEXT_PUBLIC_APP_URL/api/assets/{asset_id}/share-video`
 *   3. Send via Resend with subject "Your lullaby is ready" and sender
 *      from `RESEND_FROM` env var (Req 14.1, 14.2).
 *   4. On successful send, `UPDATE orders SET delivery_email_sent_at=now()
 *      WHERE id=$1 AND delivery_email_sent_at IS NULL`. If the UPDATE
 *      affects zero rows (race — another attempt already set the flag),
 *      still treat the delivery as complete and do NOT resend (Req 14.6).
 *   5. Append one row to `delivery_email_log` per attempt, recording
 *      `order_id`, `attempt` (1..3), `status`, and `attempted_at`
 *      (Req 14.3, design §4 delivery_email_log).
 *
 * Wired in `inngest/functions/generateLullaby.ts` as:
 *   `step.run({ id: "email", retries: 3, backoff: "exponential",
 *               timeout: "10m" }, ...)`
 * Inngest's per-step retry counter is the `attempt` value we log.
 *
 * Server-only — uses the Supabase service-role client and the Resend SDK.
 * Never import from a client component.
 */

import { Resend } from "resend";

import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendDeliveryEmailOptions {
  /** The order id — used as the idempotency key and the delivery-page URL. */
  orderId: string;
  /** The lullaby asset id — used to build the signed download links. */
  assetId: string;
  /** The parent email address to send to. NEVER LOG (Req 18.1). */
  parentEmail: string;
  /**
   * Attempt number (1-indexed). Inngest retries the step up to 3 times
   * (retries: 3 → 4 total attempts), so this is in [1, 4]. We clamp to
   * [1, 3] for the `delivery_email_log.attempt` column CHECK (design §4).
   */
  attempt: number;
}

export interface SendDeliveryEmailResult {
  /** `"sent"` on success, `"skipped"` when idempotency guard fired. */
  outcome: "sent" | "skipped";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp attempt to the [1, 3] range the DB CHECK accepts. */
function clampAttempt(n: number): number {
  return Math.max(1, Math.min(3, n));
}

/**
 * Append one row to `delivery_email_log`. Failures here are non-fatal —
 * we log a warning and continue so a logging hiccup never blocks the email
 * send or the idempotency flag write.
 */
async function logAttempt(
  orderId: string,
  attempt: number,
  status: "sent" | "transient_failure" | "permanent_failure",
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("delivery_email_log").insert({
      order_id: orderId,
      attempt: clampAttempt(attempt),
      status,
      attempted_at: new Date().toISOString(),
    });
    if (error) {
      log.warn({
        event: "delivery_email_log_write_failed",
        order_id: orderId,
        attempt: clampAttempt(attempt),
        db_error: error.message,
      });
    }
  } catch (err) {
    log.error(
      {
        event: "delivery_email_log_write_threw",
        order_id: orderId,
        attempt: clampAttempt(attempt),
      },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

/**
 * Build the plain-text email body. The body contains:
 *   - A delivery page link (Req 14.2).
 *   - A direct download link for the MP3 (Req 14.2).
 *   - A direct download link for the share video (Req 14.2).
 *
 * The `/api/assets/…` routes (Task 23) issue signed Supabase Storage URLs
 * on the fly when the parent clicks the link, so the links in the email
 * are stable and never expire (the signed URL is generated at click time,
 * not at email-send time).
 */
function buildEmailBody(
  appUrl: string,
  orderId: string,
  assetId: string,
): { html: string; text: string } {
  const deliveryUrl = `${appUrl}/orders/${orderId}`;
  const mp3Url = `${appUrl}/api/assets/${assetId}/mp3`;
  const shareVideoUrl = `${appUrl}/api/assets/${assetId}/share-video`;

  const text = [
    "Your personalized lullaby is ready!",
    "",
    "Listen and download on your delivery page:",
    deliveryUrl,
    "",
    "Direct download links:",
    `MP3: ${mp3Url}`,
    `Share video: ${shareVideoUrl}`,
    "",
    "These links are tied to your account. Sign in if prompted.",
    "",
    "— The Lullaby team",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your lullaby is ready</title>
</head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <h1 style="font-size:24px;margin-bottom:8px;">🎵 Your lullaby is ready!</h1>
  <p style="margin-bottom:24px;color:#555;">
    Your personalized lullaby has been generated and is waiting for you.
  </p>

  <a href="${deliveryUrl}"
     style="display:inline-block;background:#6c47ff;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600;margin-bottom:24px;">
    Listen on your delivery page
  </a>

  <p style="margin-bottom:8px;font-weight:600;">Direct download links:</p>
  <ul style="padding-left:20px;margin-bottom:24px;">
    <li style="margin-bottom:8px;">
      <a href="${mp3Url}" style="color:#6c47ff;">Download MP3</a>
    </li>
    <li>
      <a href="${shareVideoUrl}" style="color:#6c47ff;">Download share video</a>
    </li>
  </ul>

  <p style="font-size:13px;color:#888;">
    These links are tied to your account. Sign in if prompted.
  </p>
  <p style="font-size:13px;color:#888;">— The Lullaby team</p>
</body>
</html>
`.trim();

  return { html, text };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Send the delivery email for a completed lullaby order, idempotently.
 *
 * Throws on transient Resend errors so Inngest's per-step retry policy
 * (retries: 3, backoff: exponential) can retry the step. Each throw is
 * preceded by a `delivery_email_log` row with `status='transient_failure'`.
 *
 * Does NOT throw when:
 *   - The idempotency guard fires (`delivery_email_sent_at` already set).
 *   - The post-send UPDATE affects zero rows (race — Req 14.6).
 */
export async function sendDeliveryEmail(
  opts: SendDeliveryEmailOptions,
): Promise<SendDeliveryEmailResult> {
  const { orderId, assetId, parentEmail, attempt } = opts;
  const supabase = getSupabaseAdmin();
  const env = getServerEnv();

  // ------------------------------------------------------------------
  // 1. Idempotency guard (Req 14.5): short-circuit if already sent.
  // ------------------------------------------------------------------
  const { data: orderRow, error: fetchError } = await supabase
    .from("orders")
    .select("delivery_email_sent_at")
    .eq("id", orderId)
    .single();

  if (fetchError) {
    // Can't confirm idempotency — treat as transient and let Inngest retry.
    await logAttempt(orderId, attempt, "transient_failure");
    throw new Error(
      `delivery_email_idempotency_check_failed: ${fetchError.message}`,
    );
  }

  if (orderRow?.delivery_email_sent_at != null) {
    // Already sent on a previous attempt. Skip silently (Req 14.5).
    log.info({
      event: "delivery_email_already_sent",
      order_id: orderId,
    });
    return { outcome: "skipped" };
  }

  // If RESEND_API_KEY is not configured (local dev), skip email send and
  // mark delivery as complete. Pipeline must not block on email for demo.
  if (!env.RESEND_API_KEY) {
    log.info({
      event: "delivery_email_skipped_no_key",
      order_id: orderId,
    });
    await supabase
      .from("orders")
      .update({ delivery_email_sent_at: new Date().toISOString() })
      .eq("id", orderId);
    return { outcome: "skipped" };
  }

  // ------------------------------------------------------------------
  // 2. Build and send the email (Req 14.1, 14.2).
  // ------------------------------------------------------------------
  const { html, text } = buildEmailBody(env.NEXT_PUBLIC_APP_URL, orderId, assetId);

  let resendId: string | undefined;
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error: resendError } = await resend.emails.send({
      from: env.RESEND_FROM,
      to: parentEmail,
      subject: "Your lullaby is ready",
      html,
      text,
    });

    if (resendError) {
      // Resend returned an API-level error. Treat as transient so Inngest
      // retries (Req 14.3). Log the attempt before re-throwing.
      await logAttempt(orderId, attempt, "transient_failure");
      log.warn({
        event: "delivery_email_resend_api_error",
        order_id: orderId,
        attempt: clampAttempt(attempt),
        resend_error_name: resendError.name,
        // resendError.message may contain the recipient address — redact
        // defensively. The log.warn redactor will strip any `email` key
        // automatically (Req 18.1), but the message is a free-form string
        // so we don't include it here.
      });
      throw new Error(`resend_api_error: ${resendError.name}`);
    }

    resendId = data?.id;
  } catch (err) {
    // Network-level or SDK throw (not already handled above).
    if (!(err instanceof Error && err.message.startsWith("resend_api_error:"))) {
      await logAttempt(orderId, attempt, "transient_failure");
      log.error(
        {
          event: "delivery_email_send_threw",
          order_id: orderId,
          attempt: clampAttempt(attempt),
        },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    throw err;
  }

  // ------------------------------------------------------------------
  // 3. Mark the order as delivered (Req 14.4).
  //    Gate on `delivery_email_sent_at IS NULL` to handle the race where
  //    two Inngest attempts both reach this point concurrently. If the
  //    UPDATE affects zero rows, the other attempt already set the flag —
  //    treat as complete and do NOT resend (Req 14.6).
  // ------------------------------------------------------------------
  const { error: updateError, data: updatedRows } = await supabase
    .from("orders")
    .update({ delivery_email_sent_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("delivery_email_sent_at", null)
    .select("id");

  const rowsUpdated = updatedRows?.length ?? 0;

  if (updateError) {
    // The email was sent but we couldn't record it. Per Req 14.6, treat
    // the delivery as complete — do NOT resend. Log a warning for ops
    // visibility but return success so Inngest doesn't retry.
    log.warn({
      event: "delivery_email_flag_write_failed",
      order_id: orderId,
      resend_id: resendId,
      db_error: updateError.message,
    });
    // Still log the attempt as sent (the email did go out).
    await logAttempt(orderId, attempt, "sent");
    return { outcome: "sent" };
  }

  if (rowsUpdated === 0) {
    // Zero rows updated → race: another attempt already set the flag.
    // Per Req 14.6, treat as complete. The email was sent once; we just
    // lost the race to record it. Do NOT resend.
    log.info({
      event: "delivery_email_flag_race",
      order_id: orderId,
      resend_id: resendId,
    });
    await logAttempt(orderId, attempt, "sent");
    return { outcome: "sent" };
  }

  // ------------------------------------------------------------------
  // 4. Log the successful attempt (Req 14.3).
  // ------------------------------------------------------------------
  await logAttempt(orderId, attempt, "sent");

  log.info({
    event: "delivery_email_sent",
    order_id: orderId,
    resend_id: resendId,
    attempt: clampAttempt(attempt),
  });

  return { outcome: "sent" };
}
