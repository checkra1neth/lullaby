/**
 * Unit tests for `lib/gen/persistAsset.ts` (Task 18).
 *
 * The Supabase admin client is fully stubbed via `vi.mock` so no network /
 * DB calls happen. The stub records every call (`from(table)`, `.upsert`,
 * `.update`, `.eq`, `.is`, `.select`, `.single`) so we can assert:
 *   - the upsert targets `lullaby_assets` with the right `onConflict`,
 *   - the orders UPDATE is gated on `lullaby_asset_id IS NULL`,
 *   - retries replay deterministically (same upsert payload, same id
 *     returned, link UPDATE filters to zero rows on the second attempt),
 *   - DB errors surface as plain Errors so the Inngest wrapper reports
 *     them as unknown / generic failures (per the task brief — there is
 *     no documented `failure_reason` enum for this step).
 *
 * Cases covered:
 *   1. Happy path — first attempt: upserts the row, gets back an id,
 *      runs the link UPDATE on `orders` filtered by `lullaby_asset_id IS NULL`.
 *   2. Idempotent retry — second attempt with the same upsert payload
 *      returns the existing row's id; the link UPDATE matches zero rows
 *      (because `lullaby_asset_id` is already set) and the function
 *      still resolves with the same `asset_id`.
 *   3. Upsert error → throws plain Error.
 *   4. Link UPDATE error → throws plain Error.
 *   5. Upsert returns no row id → throws plain Error (defensive).
 *   6. `mp3_duration_seconds` is rounded to int before insert (CHECK
 *      bound is integer in the migration).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- vi.mock for the supabase admin client ---------------------------------

interface UpsertCall {
  table: string;
  values: Record<string, unknown>;
  options: { onConflict?: string } | undefined;
  selected: string | undefined;
  consumedSingle: boolean;
}

interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
  filters: Array<
    | { kind: "eq"; column: string; value: unknown }
    | { kind: "is"; column: string; value: unknown }
  >;
}

interface MockState {
  /** Queue of upsert results; first call consumes index 0, etc. */
  upsertResults: Array<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>;
  upsertCalls: UpsertCall[];
  /** Queue of update results; first call consumes index 0, etc. */
  updateResults: Array<{ error: { message: string } | null }>;
  updateCalls: UpdateCall[];
}

const state: MockState = {
  upsertResults: [],
  upsertCalls: [],
  updateResults: [],
  updateCalls: [],
};

function makeUpsertBuilder(table: string) {
  const call: UpsertCall = {
    table,
    values: {},
    options: undefined,
    selected: undefined,
    consumedSingle: false,
  };
  state.upsertCalls.push(call);

  const builder = {
    select(cols: string) {
      call.selected = cols;
      return builder;
    },
    single() {
      call.consumedSingle = true;
      const next = state.upsertResults.shift();
      if (!next) {
        return Promise.resolve({
          data: { id: `auto-${state.upsertCalls.length}` },
          error: null,
        });
      }
      return Promise.resolve(next);
    },
  };
  return {
    setValues(values: Record<string, unknown>, options: { onConflict?: string } | undefined) {
      call.values = values;
      call.options = options;
    },
    builder,
  };
}

function makeUpdateBuilder(table: string) {
  const call: UpdateCall = {
    table,
    values: {},
    filters: [],
  };
  state.updateCalls.push(call);

  const builder = {
    eq(column: string, value: unknown) {
      call.filters.push({ kind: "eq", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      call.filters.push({ kind: "is", column, value });
      // The chain end is `.is(...)` — return a thenable so `await` works.
      const result = state.updateResults.shift() ?? { error: null };
      return Promise.resolve(result);
    },
  };
  return {
    setValues(values: Record<string, unknown>) {
      call.values = values;
    },
    builder,
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      return {
        upsert(values: Record<string, unknown>, options?: { onConflict?: string }) {
          const u = makeUpsertBuilder(table);
          u.setValues(values, options);
          return u.builder;
        },
        update(values: Record<string, unknown>) {
          const u = makeUpdateBuilder(table);
          u.setValues(values);
          return u.builder;
        },
      };
    },
  }),
}));

// ---- helpers ---------------------------------------------------------------

const ORDER_ID = "11111111-2222-3333-4444-555555555555";
const ASSET_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const MP3 = {
  object_key: `mp3/${ORDER_ID}.mp3`,
  duration_seconds: 200.4,
  bitrate_kbps: 160,
};

beforeEach(() => {
  state.upsertResults = [];
  state.upsertCalls = [];
  state.updateResults = [];
  state.updateCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- tests -----------------------------------------------------------------

describe("persistAsset", () => {
  it("happy path: upserts lullaby_assets and links orders.lullaby_asset_id", async () => {
    state.upsertResults = [{ data: { id: ASSET_ID }, error: null }];
    state.updateResults = [{ error: null }];

    const { persistAsset } = await import("@/lib/gen/persistAsset");
    const result = await persistAsset({ orderId: ORDER_ID, mp3: MP3 });

    expect(result.asset_id).toBe(ASSET_ID);

    // 1. upsert into lullaby_assets, with onConflict on order_id, selecting id.
    expect(state.upsertCalls).toHaveLength(1);
    const upsert = state.upsertCalls[0];
    expect(upsert.table).toBe("lullaby_assets");
    expect(upsert.options?.onConflict).toBe("order_id");
    expect(upsert.selected).toBe("id");
    expect(upsert.consumedSingle).toBe(true);
    expect(upsert.values).toEqual({
      order_id: ORDER_ID,
      mp3_object_key: MP3.object_key,
      // 200.4 → 200 (int column with CHECK [150, 360]).
      mp3_duration_seconds: 200,
      mp3_bitrate_kbps: 160,
    });

    // 2. UPDATE orders … WHERE id=$1 AND lullaby_asset_id IS NULL.
    expect(state.updateCalls).toHaveLength(1);
    const upd = state.updateCalls[0];
    expect(upd.table).toBe("orders");
    expect(upd.values).toEqual({ lullaby_asset_id: ASSET_ID });
    expect(upd.filters).toEqual([
      { kind: "eq", column: "id", value: ORDER_ID },
      { kind: "is", column: "lullaby_asset_id", value: null },
    ]);
  });

  it("idempotent retry: returns the same asset_id and the link UPDATE matches zero rows", async () => {
    // First "attempt": upsert returns the asset id, link UPDATE succeeds.
    state.upsertResults = [
      { data: { id: ASSET_ID }, error: null },
      // Second "attempt" simulates the conflict-merge path — Supabase
      // upsert with onConflict still returns the existing row's id.
      { data: { id: ASSET_ID }, error: null },
    ];
    state.updateResults = [
      { error: null }, // first link sets lullaby_asset_id
      { error: null }, // second link UPDATE matches zero rows (already set)
    ];

    const { persistAsset } = await import("@/lib/gen/persistAsset");

    const first = await persistAsset({ orderId: ORDER_ID, mp3: MP3 });
    const second = await persistAsset({ orderId: ORDER_ID, mp3: MP3 });

    expect(first.asset_id).toBe(ASSET_ID);
    expect(second.asset_id).toBe(ASSET_ID);

    // Both attempts wrote identical upsert payloads (Req 19.3 — Inngest
    // replays the mix step from cache so inputs are byte-identical).
    expect(state.upsertCalls).toHaveLength(2);
    expect(state.upsertCalls[0].values).toEqual(state.upsertCalls[1].values);
    expect(state.upsertCalls[0].options).toEqual(state.upsertCalls[1].options);

    // Both attempts ran the link UPDATE — but the second attempt's
    // `.is("lullaby_asset_id", null)` filter would match zero rows in
    // real Postgres (UNIQUE constraint already enforced on attempt 1).
    expect(state.updateCalls).toHaveLength(2);
    for (const upd of state.updateCalls) {
      expect(upd.filters).toContainEqual({
        kind: "is",
        column: "lullaby_asset_id",
        value: null,
      });
    }
  });

  it("throws a plain Error when the upsert fails", async () => {
    state.upsertResults = [
      { data: null, error: { message: "connection refused" } },
    ];

    const { persistAsset } = await import("@/lib/gen/persistAsset");
    const err = await persistAsset({ orderId: ORDER_ID, mp3: MP3 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/persist_asset_upsert_failed/);
    // Bailed before issuing the link UPDATE.
    expect(state.updateCalls).toHaveLength(0);
  });

  it("throws a plain Error when the link UPDATE fails", async () => {
    state.upsertResults = [{ data: { id: ASSET_ID }, error: null }];
    state.updateResults = [{ error: { message: "deadlock detected" } }];

    const { persistAsset } = await import("@/lib/gen/persistAsset");
    const err = await persistAsset({ orderId: ORDER_ID, mp3: MP3 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/persist_asset_link_failed/);
  });

  it("throws when the upsert returns success without an id (defensive)", async () => {
    state.upsertResults = [{ data: null, error: null }];

    const { persistAsset } = await import("@/lib/gen/persistAsset");
    const err = await persistAsset({ orderId: ORDER_ID, mp3: MP3 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/persist_asset_missing_id/);
  });

  it("rounds mp3_duration_seconds to an integer before insert", async () => {
    state.upsertResults = [{ data: { id: ASSET_ID }, error: null }];
    state.updateResults = [{ error: null }];

    const { persistAsset } = await import("@/lib/gen/persistAsset");
    await persistAsset({
      orderId: ORDER_ID,
      mp3: { ...MP3, duration_seconds: 199.6 },
    });

    expect(state.upsertCalls[0].values.mp3_duration_seconds).toBe(200);
  });
});
