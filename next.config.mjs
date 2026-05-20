/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't bundle these packages — let Node's module resolution handle them at runtime.
  // - `ws` has native helpers (bufferUtil, utf8Validator) that webpack can't bundle.
  // - `ffmpeg-static` ships a binary that webpack copies to the wrong location.
  // - `fluent-ffmpeg` resolves the binary path via `ffmpeg-static` so it must be external too.
  experimental: {
    serverComponentsExternalPackages: ["ws", "ffmpeg-static", "ffprobe-static", "fluent-ffmpeg"],
  },

  /**
   * Rewrites for out-of-scope rejection surface (Req 21.1, 21.3, 21.4, 21.5, 21.6).
   *
   * Any request to the five out-of-scope API prefixes is internally forwarded
   * to `app/api/_unavailable/[...slug]/route.ts`, which returns 501 for every
   * HTTP method. The rewrite is transparent to the caller — the URL in the
   * browser / curl stays as-is; only the handler changes.
   *
   * Design §3.2 "Out-of-scope rejection routes".
   */
  async rewrites() {
    return [
      // Req 21.1 — native mobile API surface
      {
        source: "/api/mobile/:path*",
        destination: "/api/_unavailable/mobile/:path*",
      },
      // Req 21.6 — admin dashboard
      {
        source: "/api/admin/:path*",
        destination: "/api/_unavailable/admin/:path*",
      },
      // Req 21.4 — affiliate / referral
      {
        source: "/api/affiliate/:path*",
        destination: "/api/_unavailable/affiliate/:path*",
      },
      // Req 21.5 — custom refund flows
      {
        source: "/api/refunds/:path*",
        destination: "/api/_unavailable/refunds/:path*",
      },
      // Req 21.3 — multi-tenant white-label
      {
        source: "/api/tenants/:path*",
        destination: "/api/_unavailable/tenants/:path*",
      },
    ];
  },
};

export default nextConfig;
