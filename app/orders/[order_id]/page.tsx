import React from "react";

/**
 * Delivery page at `/orders/[order_id]` (Task 9, Req 13.1, 13.6).
 *
 * Server component. Validates the route parameter is a UUID and looks up
 * the matching `orders` row via the service-role admin client. If the row
 * does not exist (or the param is not a UUID) we call `notFound()` which
 * renders Next.js's 404 surface (custom message in `not-found.tsx`).
 *
 * On success we render the `<DeliveryStatus>` client component, passing in
 * the columns it needs:
 *   - `orderId`           – round-trips into the polling URL.
 *   - `childName`         – used in download filenames (Req 13.4) and
 *                           accessible labels. The page never logs this
 *                           value (Req 18 — the boundary redactor strips
 *                           name-shaped fields if it ever did).
 *   - `assetId`           – set when generation has succeeded; nullable
 *                           because a parent may land on the page before
 *                           the Inngest pipeline finishes (Day 1 stub
 *                           never sets it).
 *
 * Authorization: this page is intentionally NOT gated server-side. The
 * downstream `/api/orders/[order_id]/status` endpoint (Task 8) and the
 * signed-URL gate (Task 23) are the chokepoints. A stranger who guesses an
 * order id sees only that "an order exists with this id"; they cannot
 * read its status, audio, or video without a session or the
 * `lullaby_order_access` cookie set in Task 10.
 */
import { notFound } from "next/navigation";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { DeliveryStatus } from "./DeliveryStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 4122 v1–v5 / variant 1. Same shape Postgres accepts for `orders.id`.
 * Validating in the page avoids a needless DB round-trip on garbage URLs
 * and keeps Postgres from emitting a confusing "invalid uuid" error.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OrderRow {
  id: string;
  child_name: string;
  lullaby_asset_id: string | null;
}

export default async function DeliveryPage({
  params,
}: {
  params: { order_id: string };
}) {
  const orderId = params.order_id;

  if (!UUID_REGEX.test(orderId)) {
    notFound();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select("id, child_name, lullaby_asset_id")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (error || !data) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8 sm:py-10">
      <DeliveryStatus
        orderId={data.id}
        childName={data.child_name}
        assetId={data.lullaby_asset_id}
      />
    </main>
  );
}
