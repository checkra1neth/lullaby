/**
 * GET /api/orders/[order_id]/status — Order generation status (Req 7.3, 7.4,
 * 13.6 — Task 8, design §3.2 API Surface – Delivery, §7 Security – Signed
 * URL access).
 *
 * Purpose
 * -------
 * The delivery page (Task 9) polls this endpoint every ~3 s while the
 * generation job is in `queued` or `running`. It returns the current
 * `generation_jobs` row's status, plus a non-PII `failure_reason` when the
 * job has failed (per Req 7.7 the reason is one of a documented enum and
 * never contains PII).
 *
 * Authorization (dual-mode)
 * -------------------------
 * The caller is authorized when EITHER:
 *   (a) The Supabase Auth session email matches `orders.parent_email`
 *       (case-insensitive — `parent_email` is a citext column; we lower
 *       both sides defensively), OR
 *   (b) The fresh-checkout cookie `lullaby_order_access` is present AND its
 *       value matches `[order_id]` (Task 10 / OQ-7 — UX guarantee that the
 *       delivery page works the moment Stripe redirects back, before any
 *       magic link).
 *
 * Anything else → 403, no body, no PII leakage.
 *
 * Response shapes
 * ---------------
 *   - 200 `{ status, failure_reason? }` — `failure_reason` is included only
 *     when present (Req 7.7).
 *   - 200 `{ status: "queued" }` — `orders` row exists but no
 *     `generation_jobs` row yet (the webhook hasn't created it yet; the
 *     polling UI will catch up). Treated as queued.
 *   - 403 — caller failed both authorization paths.
 *   - 404 — `order_id` is not a valid UUID, or no `orders` row matches it.
 *
 * Performance
 * -----------
 * One indexed PK SELECT against `orders` joined with `generation_jobs`
 * (UNIQUE on `generation_jobs.order_id`) — sub-millisecond in Postgres,
 * comfortably within the ≤100 ms typical target documented in Task 8 and
 * the ≤1 s nominal load SLO of Req 7.3.
 *
 * Runtime: nodejs (Supabase client + cookies()).
 */
import { NextResponse } from "next/server";

import { getFreshCheckoutOrderId } from "@/lib/auth/freshCheckout";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 4122 UUID v1–v5 / variant 1 — same shape Postgres accepts for
 * `orders.id` (`uuid` column). We validate the shape before hitting the DB
 * so that obviously-bad ids return a fast 404 without an extra round trip
 * and without risking the Postgres driver throwing a confusing error.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed";

interface OrderRow {
  id: string;
  parent_email: string;
  generation_jobs:
    | { status: GenerationJobStatus; failure_reason: string | null }
    | { status: GenerationJobStatus; failure_reason: string | null }[]
    | null;
}

interface StatusResponse {
  status: GenerationJobStatus;
  failure_reason?: string;
}

export async function GET(
  _req: Request,
  { params }: { params: { order_id: string } },
) {
  const orderId = params.order_id;

  // 1. UUID shape check → fast 404 for obviously-bad ids.
  if (!UUID_REGEX.test(orderId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 2. Single indexed PK lookup. The `generation_jobs.order_id` UNIQUE
  // constraint guarantees at most one row per order.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select("id, parent_email, generation_jobs(status, failure_reason)")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (error) {
    // Don't leak DB error text. The polling client treats 5xx as a transient
    // hiccup and keeps polling.
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 3. Authorize: session email match OR fresh-checkout cookie match.
  // The cookie reader is async (Web Crypto signature verification — Task 10).
  const cookieOrderId = await getFreshCheckoutOrderId();
  const cookieAuthorized = cookieOrderId === orderId;

  let sessionAuthorized = false;
  if (!cookieAuthorized) {
    sessionAuthorized = await sessionEmailMatches(data.parent_email);
  }

  if (!cookieAuthorized && !sessionAuthorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 4. Shape the response. Treat a missing `generation_jobs` row as queued
  // (the webhook will populate it on `checkout.session.completed`; the
  // polling UI will catch up on the next tick).
  const job = pickJob(data.generation_jobs);
  if (!job) {
    return NextResponse.json<StatusResponse>(
      { status: "queued" },
      { status: 200 },
    );
  }

  const body: StatusResponse = { status: job.status };
  if (job.failure_reason) {
    body.failure_reason = job.failure_reason;
  }
  return NextResponse.json(body, { status: 200 });
}

/**
 * The Supabase client may shape a 1-to-1 join either as a single object or
 * as a single-element array depending on the table relationship metadata.
 * Normalize both into a single nullable record. Multiple rows is impossible
 * in practice (UNIQUE on `generation_jobs.order_id`); we still pick the
 * first defensively.
 */
function pickJob(
  jobs: OrderRow["generation_jobs"],
): { status: GenerationJobStatus; failure_reason: string | null } | null {
  if (!jobs) return null;
  if (Array.isArray(jobs)) {
    return jobs.length > 0 ? jobs[0] : null;
  }
  return jobs;
}

/**
 * Returns true iff the request carries a Supabase Auth session whose user
 * email matches `parent_email` (case-insensitive — `parent_email` is citext).
 *
 * Any failure to load the user (no session, expired token, network blip)
 * resolves to `false` rather than throwing, so the route can fall back to
 * the cookie path (or 403) cleanly.
 */
async function sessionEmailMatches(parentEmail: string): Promise<boolean> {
  try {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const sessionEmail = user?.email;
    if (!sessionEmail) return false;
    return sessionEmail.toLowerCase() === parentEmail.toLowerCase();
  } catch {
    return false;
  }
}
