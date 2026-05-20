/**
 * POST /api/preview — personalized preview clip via ElevenLabs TTS.
 *
 * Replaces the Day-1 stub (Task 11) with a real implementation that:
 *   1. Validates `{ child_name, voice_id }` (Req 3.1)
 *   2. Enforces per-IP rate limit of 5 requests/hour via Upstash (Req 3.7)
 *   3. Calls ElevenLabs TTS with a 15-second timeout (Req 3.5)
 *   4. Returns `{ audio_base64, duration_s }` with duration ∈ [5, 12] (Req 3.2)
 *
 * Error responses:
 *   - 400: validation failure
 *   - 429: rate limit exceeded (>5/IP/hour)
 *   - 502: upstream ElevenLabs error
 *   - 504: request timed out (>15 s)
 *
 * The client may retry up to 3 times per session on 502/504 (Req 3.6).
 *
 * Design ref: §3.2 API Surface – Preview, §7 Security
 * Req: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { generatePreview } from "@/lib/gen/preview";
import { checkRateLimit } from "@/lib/rateLimit";

// Req 3.1: child_name 1–50 chars (after trim), voice_id non-empty.
const PreviewRequestSchema = z.object({
  child_name: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(50)),
  voice_id: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1)),
});

/**
 * Extract the client IP from the request headers.
 * Vercel sets x-forwarded-for; fallback to x-real-ip or a default.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; take the first (client).
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request) {
  // --- Parse body ---
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PreviewRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_failed",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { child_name, voice_id } = parsed.data;

  // --- Rate limit (Req 3.7): 5 requests per IP per hour ---
  const ip = getClientIp(req);
  try {
    const rl = await checkRateLimit("preview", ip, 5, 3600);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "limit_reached", message: "Preview limit reached. Try again later." },
        { status: 429 },
      );
    }
  } catch {
    // If Redis is unreachable, fail open — don't block the demo.
    // In production you'd want to fail closed or alert.
  }

  // --- Generate preview via ElevenLabs TTS (Req 3.1, 3.3, 3.5) ---
  try {
    const result = await generatePreview(child_name, voice_id);
    return NextResponse.json(
      {
        audio_base64: result.audio_base64,
        duration_s: result.duration_s,
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "preview_generation_failed";

    // Log the actual error for debugging
    console.error("[preview] ElevenLabs TTS error:", message, err);

    // Req 3.5, 3.6: timeout → 504, upstream error → 502
    if (message.includes("timeout")) {
      return NextResponse.json(
        { error: "gateway_timeout", message: "Preview generation timed out." },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: "upstream_error", message: `Preview generation failed: ${message}` },
      { status: 502 },
    );
  }
}
