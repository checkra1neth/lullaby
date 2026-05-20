import React from "react";

/**
 * GET /library — Subscriber library page (Req 13, 14).
 *
 * Server component. Lists lullaby_assets for the authenticated parent's
 * email in reverse-chronological order, paginated 20 per page via ?page=N.
 */
import { redirect } from "next/navigation";
import Link from "next/link";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GlassPanel } from "@/app/_components/GlassPanel";
import { CtaButton } from "@/app/_components/CtaButton";
import { Icon } from "@/app/_components/Icon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

interface LullabyAssetRow {
  id: string;
  order_id: string;
  mp3_object_key: string;
  share_video_object_key: string | null;
  mp3_duration_seconds: number;
  mp3_bitrate_kbps: number;
  created_at: string;
  orders: {
    child_name: string;
    mood: string;
  } | null;
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const supabaseClient = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  if (!user?.email) {
    redirect("/auth/sign-in?next=/library");
  }

  const parentEmail = user.email;
  const rawPage = parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = getSupabaseAdmin();
  const { data: assets, error } = await supabase
    .from("lullaby_assets")
    .select(
      `id, order_id, mp3_object_key, share_video_object_key,
       mp3_duration_seconds, mp3_bitrate_kbps, created_at,
       orders!inner(child_name, mood, parent_email)`,
    )
    .eq("orders.parent_email", parentEmail)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12 sm:py-16">
        <h1 className="text-2xl font-semibold text-on-surface">My Lullabies</h1>
        <p className="text-on-surface-v">
          Something went wrong loading your library. Please try again.
        </p>
      </main>
    );
  }

  const rows = (assets ?? []) as unknown as LullabyAssetRow[];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12 sm:py-16">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-on-surface">
          My Lullabies
        </h1>
        <CtaButton href="/create">Make another lullaby</CtaButton>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            aria-label="Your lullabies"
          >
            {rows.map((asset, i) => (
              <LullabyCard key={asset.id} asset={asset} index={i} />
            ))}
          </ul>
          <Pagination page={page} hasMore={rows.length === PAGE_SIZE} />
        </>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <GlassPanel
      as="section"
      className="flex flex-col items-center gap-4 px-8 py-16 text-center"
    >
      <Icon
        name="nights_stay"
        filled
        size={64}
        className="text-accent"
      />
      <h2 className="text-xl font-bold tracking-[-0.02em] text-on-surface">
        No lullabies yet
      </h2>
      <p className="text-on-surface-v">
        Create your first personalized lullaby for your child.
      </p>
      <CtaButton href="/create">Make your child&rsquo;s lullaby</CtaButton>
    </GlassPanel>
  );
}

function LullabyCard({
  asset,
  index,
}: {
  asset: LullabyAssetRow;
  index: number;
}) {
  const childName = asset.orders?.child_name ?? "Unknown";
  const mood = asset.orders?.mood ?? "";
  const createdAt = new Date(asset.created_at);
  const dateLabel = createdAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const durationMin = Math.floor(asset.mp3_duration_seconds / 60);
  const durationSec = asset.mp3_duration_seconds % 60;
  const durationLabel = `${durationMin}:${String(durationSec).padStart(2, "0")}`;

  return (
    <li
      className="glass-panel lib-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ "--index": index } as React.CSSProperties}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-surface-high">
          <Icon name="bedtime" filled size={28} className="text-accent" />
        </div>
        <div className="flex flex-col">
          <p className="font-medium text-on-surface">
            {childName}&rsquo;s Lullaby
          </p>
          <p className="text-xs capitalize text-on-surface-v">
            {mood} · {durationLabel} · {dateLabel}
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        <Link
          href={`/api/assets/${asset.id}/mp3`}
          className="rounded-md border border-glass-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-low"
          aria-label={`Download MP3 for ${childName}'s lullaby`}
        >
          MP3
        </Link>
        {asset.share_video_object_key && (
          <Link
            href={`/api/assets/${asset.id}/share-video`}
            className="rounded-md border border-glass-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-low"
            aria-label={`Download share video for ${childName}'s lullaby`}
          >
            Video
          </Link>
        )}
        <Link
          href={`/orders/${asset.order_id}`}
          className="rounded-md border border-glass-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-low"
          aria-label={`View delivery page for ${childName}'s lullaby`}
        >
          View
        </Link>
      </div>
    </li>
  );
}

function Pagination({ page, hasMore }: { page: number; hasMore: boolean }) {
  if (page === 1 && !hasMore) return null;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-4">
      {page > 1 && (
        <Link
          href={`/library?page=${page - 1}`}
          className="rounded-md border border-glass-border px-4 py-2 text-sm transition-colors hover:bg-surface-low"
        >
          ← Previous
        </Link>
      )}
      <span className="text-sm text-on-surface-v">Page {page}</span>
      {hasMore && (
        <Link
          href={`/library?page=${page + 1}`}
          className="rounded-md border border-glass-border px-4 py-2 text-sm transition-colors hover:bg-surface-low"
        >
          Next →
        </Link>
      )}
    </nav>
  );
}
