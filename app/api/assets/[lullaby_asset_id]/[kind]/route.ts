/**
 * GET /api/assets/[lullaby_asset_id]/[kind] — Signed-URL gate for paid assets
 * (Task 23, Req 13.4, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6).
 *
 * Purpose
 * -------
 * Serves as the access-control chokepoint for MP3 and share-video downloads.
 * The delivery page (Task 9) renders `<audio src="/api/assets/{id}/mp3">` and
 * `<video src="/api/assets/{id}/share-video">` — those requests land here.
 *
 * `kind` must be one of `"mp3"` or `"share-video"`. Anything else → 404.
 *
 * Authorization (dual-mode, same pattern as the status endpoint in Task 8)
 * -------------------------------------------------------------------------
 * The caller is authorized when EITHER:
 *   (a) The Supabase Auth session email matches `orders.parent_email`
 *       (case-insensitive — `parent_email` is citext), OR
 *   (b) The fresh-checkout cookie `lullaby_order_access` is present AND its
 *       value matches the asset's parent order id (Task 10 / OQ-7).
 *
 * Otherwise → 403 with empty body.
 *
 * Flow
 * ----
 * 1. Validate `lullaby_asset_id` is a UUID and `kind` is valid.
 * 2. Load `lullaby_assets` joined with `orders` to get `parent_email` and
 *    the relevant `object_key`.
 * 3. If no row → 404.
 * 4. Authorize via session or cookie.
 * 5. Call `supabase.storage.from('lullabies').createSignedUrl(object_key, 300)`.
 * 6. If signed URL creation fails (tampered key, expired object, etc.) → 403
 *    with zero bytes (Req 17.6).
 * 7. Return 302 redirect to the signed URL (Req 17.1).
 *
 * Runtime: nodejs (Supabase client + cookies()).
 */
import { NextResponse } from "next/server";

import { getFreshCheckoutOrderId } from "@/lib/auth/freshCheckout";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Valid `kind` path segment values. */
const VALID_KINDS = new Set(["mp3", "share-video"]);

/**
 * RFC 4122 UUID v1–v5 / variant 1. Validates the shape before hitting the DB
 * so garbage ids return a fast 404.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Signed URL TTL in seconds (design §3.2: 300 s). */
const SIGNED_URL_TTL = 300;

/** Map `kind` to the column on `lullaby_assets` that holds the object key. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const KIND_TO_COLUMN: Record<string, string> = {
  mp3: "mp3_object_key",
  "share-video": "share_video_object_key",
};

interface AssetRow {
  id: string;
  order_id: string;
  mp3_object_key: string;
  share_video_object_key: string | null;
  orders: {
    parent_email: string;
  };
}

export async function GET(
  _req: Request,
  { params }: { params: { lullaby_asset_id: string; kind: string } },
) {
  const { lullaby_asset_id: assetId, kind } = params;

  // 1. Validate path segments.
  if (!UUID_REGEX.test(assetId) || !VALID_KINDS.has(kind)) {
    return new NextResponse(null, { status: 404 });
  }

  // 2. Load asset + parent order in one query.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lullaby_assets")
    .select("id, order_id, mp3_object_key, share_video_object_key, orders(parent_email)")
    .eq("id", assetId)
    .maybeSingle<AssetRow>();

  if (error || !data) {
    return new NextResponse(null, { status: 404 });
  }

  // 3. Resolve the object key for the requested kind.
  const objectKey =
    kind === "mp3" ? data.mp3_object_key : data.share_video_object_key;

  if (!objectKey) {
    // The share video may not have been uploaded yet (Req 12.8 — column is
    // nullable). Treat as 404 rather than 403 since the asset simply doesn't
    // exist yet.
    return new NextResponse(null, { status: 404 });
  }

  // 4. Authorize: fresh-checkout cookie OR session email match.
  const cookieOrderId = await getFreshCheckoutOrderId();
  const cookieAuthorized = cookieOrderId === data.order_id;

  let sessionAuthorized = false;
  if (!cookieAuthorized) {
    sessionAuthorized = await sessionEmailMatches(data.orders.parent_email);
  }

  if (!cookieAuthorized && !sessionAuthorized) {
    // Req 17.3, 17.5: deny with 403 and empty body.
    return new NextResponse(null, { status: 403 });
  }

  // 5. Issue a signed URL from Supabase Storage (Req 17.1, 17.4: TTL 300 s).
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("lullabies")
    .createSignedUrl(objectKey, SIGNED_URL_TTL);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    // Req 17.6: tampered/expired downstream → propagate as 403 with zero bytes.
    return new NextResponse(null, { status: 403 });
  }

  // 6. 302 redirect to the signed URL (Req 17.1).
  return NextResponse.redirect(signedUrlData.signedUrl, 302);
}

/**
 * Returns true iff the request carries a Supabase Auth session whose user
 * email matches `parentEmail` (case-insensitive — `parent_email` is citext).
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
