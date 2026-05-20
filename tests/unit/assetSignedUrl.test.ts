/**
 * Tests for `app/api/assets/[lullaby_asset_id]/[kind]/route.ts` (Task 23).
 *
 * Verifies the signed-URL gate authorization logic:
 *   - 404 for invalid UUID / invalid kind / missing asset
 *   - 403 when neither session nor cookie authorizes
 *   - 302 redirect to signed URL on authorized request
 *   - 403 when Supabase Storage fails to issue a signed URL (tampered key)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -------------------------------------------------------------------

// Mock next/headers (cookies)
const mockCookieStore = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => mockCookieStore.get(name),
    getAll: () =>
      Array.from(mockCookieStore.entries()).map(([name, { value }]) => ({
        name,
        value,
      })),
  }),
}));

// Mock next/server NextResponse
vi.mock("next/server", () => {
  class MockNextResponse {
    body: string | null;
    status: number;
    headers: Map<string, string>;

    constructor(body: string | null, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Map(Object.entries(init?.headers ?? {}));
    }

    static json(data: unknown, init?: { status?: number }) {
      const resp = new MockNextResponse(JSON.stringify(data), init);
      return resp;
    }

    static redirect(url: string, status: number) {
      const resp = new MockNextResponse(null, { status, headers: { Location: url } });
      (resp as any)._redirectUrl = url;
      return resp;
    }
  }

  return { NextResponse: MockNextResponse };
});

// Mock Supabase admin client
const mockSupabaseFrom = vi.fn();
const mockStorageFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: mockSupabaseFrom,
    storage: { from: mockStorageFrom },
  }),
}));

// Mock Supabase server client (session)
const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

// Mock freshCheckout
const mockGetFreshCheckoutOrderId = vi.fn();
vi.mock("@/lib/auth/freshCheckout", () => ({
  getFreshCheckoutOrderId: () => mockGetFreshCheckoutOrderId(),
}));

// --- Import the route handler after mocks are set up -------------------------
import { GET } from "@/app/api/assets/[lullaby_asset_id]/[kind]/route";

// --- Test data ---------------------------------------------------------------
const ASSET_ID = "aaaaaaaa-bbbb-1ccc-9ddd-eeeeeeeeeeee";
const ORDER_ID = "11111111-2222-3333-4444-555555555555";
const PARENT_EMAIL = "parent@example.com";
const MP3_KEY = "mp3/test-order.mp3";
const VIDEO_KEY = "share-videos/test-asset.mp4";
const SIGNED_URL = "https://storage.supabase.co/signed/lullabies/mp3/test-order.mp3?token=abc";

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/assets/test/mp3", { method: "GET" });
}

function setupAssetRow(overrides?: { share_video_object_key?: string | null }) {
  const shareVideoKey =
    overrides && "share_video_object_key" in overrides
      ? overrides.share_video_object_key
      : VIDEO_KEY;

  mockSupabaseFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            id: ASSET_ID,
            order_id: ORDER_ID,
            mp3_object_key: MP3_KEY,
            share_video_object_key: shareVideoKey,
            orders: { parent_email: PARENT_EMAIL },
          },
          error: null,
        }),
      }),
    }),
  });
}

function setupNoAsset() {
  mockSupabaseFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  });
}

function setupSignedUrl(success: boolean) {
  if (success) {
    mockStorageFrom.mockReturnValue({
      createSignedUrl: async () => ({
        data: { signedUrl: SIGNED_URL },
        error: null,
      }),
    });
  } else {
    mockStorageFrom.mockReturnValue({
      createSignedUrl: async () => ({
        data: null,
        error: { message: "Object not found" },
      }),
    });
  }
}

// --- Tests -------------------------------------------------------------------

beforeEach(() => {
  mockCookieStore.clear();
  mockGetFreshCheckoutOrderId.mockResolvedValue(null);
  mockGetUser.mockResolvedValue({ data: { user: null } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/assets/[lullaby_asset_id]/[kind]", () => {
  describe("validation", () => {
    it("returns 404 for an invalid UUID asset id", async () => {
      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: "not-a-uuid", kind: "mp3" },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for an invalid kind", async () => {
      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "wav" },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when the asset does not exist", async () => {
      setupNoAsset();
      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when share-video object key is null", async () => {
      setupAssetRow({ share_video_object_key: null });
      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "share-video" },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("authorization", () => {
    it("returns 403 when neither session nor cookie authorizes", async () => {
      setupAssetRow();
      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(403);
    });

    it("authorizes via fresh-checkout cookie matching order id", async () => {
      setupAssetRow();
      setupSignedUrl(true);
      mockGetFreshCheckoutOrderId.mockResolvedValue(ORDER_ID);

      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(302);
    });

    it("authorizes via session email matching parent_email (case-insensitive)", async () => {
      setupAssetRow();
      setupSignedUrl(true);
      mockGetUser.mockResolvedValue({
        data: { user: { email: "PARENT@EXAMPLE.COM" } },
      });

      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(302);
    });

    it("rejects when cookie matches a different order id", async () => {
      setupAssetRow();
      mockGetFreshCheckoutOrderId.mockResolvedValue(
        "99999999-8888-7777-6666-555555555555",
      );

      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(403);
    });

    it("rejects when session email does not match", async () => {
      setupAssetRow();
      mockGetUser.mockResolvedValue({
        data: { user: { email: "stranger@example.com" } },
      });

      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("signed URL issuance", () => {
    it("returns 302 redirect to signed URL on success", async () => {
      setupAssetRow();
      setupSignedUrl(true);
      mockGetFreshCheckoutOrderId.mockResolvedValue(ORDER_ID);

      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(302);
      expect((res as any)._redirectUrl).toBe(SIGNED_URL);
    });

    it("returns 403 when Supabase Storage fails to create signed URL", async () => {
      setupAssetRow();
      setupSignedUrl(false);
      mockGetFreshCheckoutOrderId.mockResolvedValue(ORDER_ID);

      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "mp3" },
      });
      expect(res.status).toBe(403);
    });

    it("works for share-video kind", async () => {
      setupAssetRow();
      setupSignedUrl(true);
      mockGetFreshCheckoutOrderId.mockResolvedValue(ORDER_ID);

      const res = await GET(makeRequest(), {
        params: { lullaby_asset_id: ASSET_ID, kind: "share-video" },
      });
      expect(res.status).toBe(302);
    });
  });
});
