/**
 * persistAsset — writes a `lullaby_assets` row for the just-mixed mp3 and
 * links it back to its parent order (Task 18, design §6 Idempotency notes,
 * Req 11.4 + 19.1–19.4).
 *
 * Wired into the Inngest function as
 *   `step.run("persist-asset", () => persistAsset(...))`
 * after the `mix` step. With the function-level `retries: 0` setting on
 * `generateLullaby` (design §6, see `inngest/functions/generateLullaby.ts`),
 * a single DB failure here is final and surfaces upstream as a plain
 * Error rather than a documented `generation_jobs.failure_reason` enum
 * value — this matches the task brief: persist-asset failures are rare
 * (DB unavailable) and intentionally not mapped to a public enum.
 *
 * Idempotency (Req 19.1–19.4):
 *   1. `lullaby_assets.order_id` is UNIQUE (see
 *      `supabase/migrations/0001_init.sql`). Inngest replays the
 *      preceding mix step from its durable cache on retry, so the
 *      `mp3_object_key` / duration / bitrate are byte-identical across
 *      attempts (Req 19.3). We use Supabase's upsert with
 *      `onConflict: "order_id"` so the second insert merges into the
 *      existing row instead of throwing — and we always read the same
 *      `asset_id` back via `.select("id").single()` (Req 19.2).
 *   2. `orders.lullaby_asset_id` is also UNIQUE, enforcing one-asset-
 *      per-order at the schema level (Req 19.1). The link UPDATE is
 *      gated on `lullaby_asset_id IS NULL` so a retry that finds the
 *      column already populated (from a previous successful run) is a
 *      no-op rather than a UNIQUE-constraint violation.
 *
 * Why we don't bubble a documented failure reason here:
 *   The mix step persisted the mp3 to Storage successfully — the only
 *   way this step fails is a transient DB error during the row write.
 *   The task brief explicitly notes this surfaces as an unknown error
 *   rather than a `generation_jobs.failure_reason` enum value; the
 *   outer catch in `generateLullaby` will let it propagate.
 *
 * Server-only — uses the Supabase service-role client.
 */
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface PersistAssetOptions {
  /** Parent order id (FK target on `lullaby_assets.order_id`). */
  orderId: string;
  /** The mix step's output, exactly as returned by `mixWithFfmpeg`. */
  mp3: {
    object_key: string;
    duration_seconds: number;
    bitrate_kbps: number;
  };
}

export interface PersistAssetResult {
  /** `lullaby_assets.id` — used by the share-video step (Task 19). */
  asset_id: string;
}

/**
 * Insert a `lullaby_assets` row keyed on `order_id` and link it back to
 * `orders.lullaby_asset_id`. Idempotent on Inngest retries.
 *
 * Throws a plain `Error` on any DB failure. The Inngest outer catch in
 * `generateLullaby` lets it propagate (intentional — see module header).
 */
export async function persistAsset(
  opts: PersistAssetOptions,
): Promise<PersistAssetResult> {
  const supabase = getSupabaseAdmin();

  // 1. INSERT … ON CONFLICT (order_id) DO UPDATE … RETURNING id.
  //    `mp3_duration_seconds` is an `int` column (see migration); the
  //    mix step's validation already clamps this to [150, 360] s, so
  //    Math.round can't push us past the CHECK bounds (Req 11.2).
  //    `mp3_bitrate_kbps` is one of {128, 160, 192} from `mixWithFfmpeg`,
  //    inside the [128, 192] kbps CHECK (Req 11.4).
  const { data: assetRow, error: upsertError } = await supabase
    .from("lullaby_assets")
    .upsert(
      {
        order_id: opts.orderId,
        mp3_object_key: opts.mp3.object_key,
        mp3_duration_seconds: Math.round(opts.mp3.duration_seconds),
        mp3_bitrate_kbps: opts.mp3.bitrate_kbps,
      },
      { onConflict: "order_id" },
    )
    .select("id")
    .single();

  if (upsertError) {
    throw new Error(`persist_asset_upsert_failed: ${upsertError.message}`);
  }
  if (!assetRow || typeof assetRow.id !== "string" || assetRow.id.length === 0) {
    throw new Error("persist_asset_missing_id");
  }

  const assetId = assetRow.id;

  // 2. Link `orders.lullaby_asset_id` ← `asset.id` only when the column
  //    is still NULL. On a retry where the link is already set, the
  //    `.is("lullaby_asset_id", null)` clause filters out the row so
  //    the UPDATE affects zero rows — no UNIQUE-constraint violation,
  //    no overwrite. The UNIQUE on `orders.lullaby_asset_id` enforces
  //    one-asset-per-order in the DB (Req 19.1).
  const { error: linkError } = await supabase
    .from("orders")
    .update({ lullaby_asset_id: assetId })
    .eq("id", opts.orderId)
    .is("lullaby_asset_id", null);

  if (linkError) {
    throw new Error(`persist_asset_link_failed: ${linkError.message}`);
  }

  return { asset_id: assetId };
}
