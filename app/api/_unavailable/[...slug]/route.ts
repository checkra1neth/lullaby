/**
 * Out-of-scope rejection surface (Req 21.1, 21.3, 21.4, 21.5, 21.6).
 *
 * This single catch-all route handler returns 501 for every HTTP method.
 * It is never called directly by clients — Next.js `rewrites()` in
 * `next.config.mjs` forward the following prefixes here:
 *
 *   /api/mobile/*      → Req 21.1 (native mobile API surface)
 *   /api/admin/*       → Req 21.6 (admin dashboard)
 *   /api/affiliate/*   → Req 21.4 (affiliate / referral)
 *   /api/refunds/*     → Req 21.5 (custom refund flows)
 *   /api/tenants/*     → Req 21.3 (multi-tenant white-label)
 *
 * Design §3.2 "Out-of-scope rejection routes".
 */

import { NextResponse } from "next/server";

const BODY = JSON.stringify({ error: "Feature unavailable in v1" });
const HEADERS = { "Content-Type": "application/json" };

function unavailable(): NextResponse {
  return new NextResponse(BODY, { status: 501, headers: HEADERS });
}

export const GET = unavailable;
export const POST = unavailable;
export const PUT = unavailable;
export const PATCH = unavailable;
export const DELETE = unavailable;
export const HEAD = unavailable;
export const OPTIONS = unavailable;
