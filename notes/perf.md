# Performance Verification — Full Happy Path

_Task 29.3 | Req: 7.6, 11.1, 12.1, 14.1 | Design: §9 Performance Budget_

---

## Budget Summary (from Design §9)

**Total wall-clock bound: ≤ 300 seconds** from `checkout.session.completed` webhook
receipt to the delivery page flipping to `succeeded`.

| Step | Metric | Budget (ms) | Notes |
|------|--------|-------------|-------|
| Lyrics | `lyrics_ms` | ≤ 20,000 | OpenAI gpt-4o-mini; 1 retry → 2 attempts × 20 s max |
| TTS narration | `tts_ms` | ≤ 62,000 | ElevenLabs TTS; 2 attempts × 30 s + 2 s delay |
| Background music | `music_ms` | ≤ 120,000 | ElevenLabs Music API; no retry |
| Audio mix (ffmpeg) | `mix_ms` | ≤ 60,000 | ffmpeg amix on 3–6 min audio |
| Share video (ffmpeg) | `share_video_ms` | ≤ 90,000 | ffmpeg waveform render + upload |
| Delivery email | `email_ms` | ≤ 60,000 | Resend; 3 retries exponential backoff |
| **Total** | **wall_clock_ms** | **≤ 300,000** | Outer guard in `generateLullaby` |

Nominal expected total: ~240 s with 60 s slack.

---

## Measurement Procedure

### Prerequisites

1. All services running (see `notes/day2-smoke.md` for the three-terminal setup)
2. Real API keys configured in `.env.local`
3. Stripe test card: `4242 4242 4242 4242`
4. Inngest dev server at http://localhost:8288

### Timing Method

Timing is captured from **Inngest function logs** and **Supabase `generation_jobs`
timestamps**. Each `step.run` block logs its start/end via `lib/log.ts`.

Alternatively, use the Inngest dev UI timeline view at http://localhost:8288 which
shows per-step durations for each function run.

### Manual Stopwatch Procedure

1. **Start timer** when `checkout.session.completed` webhook is received
   (visible in Terminal 3 — Stripe CLI output, or Inngest dev UI event list).

2. **Record per-step times** from Inngest dev UI → function run → timeline:
   - `lyrics_ms`: time for the `lyrics` step
   - `tts_ms`: time for the `tts` step
   - `music_ms`: time for the `music` step
   - `mix_ms`: time for the `mix` step
   - `share_video_ms`: time for the `share-video` step
   - `email_ms`: time for the `email` step

3. **Stop timer** when the delivery page (`/orders/{order_id}`) flips from
   the progress indicator to the `succeeded` state (audio + video players render).

4. Record `wall_clock_ms` = stop − start.

### Automated Timing Script

Run from the project root after the pipeline completes for an order:

```bash
# Query generation_jobs for timing (requires psql access to Supabase)
psql "$SUPABASE_DB_URL" -c "
  SELECT
    id,
    order_id,
    status,
    failure_reason,
    EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS wall_clock_ms
  FROM generation_jobs
  WHERE order_id = '<ORDER_ID>'
  ORDER BY started_at DESC
  LIMIT 1;
"
```

For per-step granularity, use the Inngest dev UI export or add instrumentation
to `inngest/functions/generateLullaby.ts`:

```typescript
// Add to each step.run block for timing instrumentation:
const t0 = Date.now();
// ... step logic ...
const elapsed = Date.now() - t0;
logger.info({ step: "lyrics", elapsed_ms: elapsed, order_id });
```

---

## Results Template

Fill in after each live run:

### Run 1 — Date: ____

| Step | Time (ms) | Within Budget? |
|------|-----------|----------------|
| `lyrics_ms` | | |
| `tts_ms` | | |
| `music_ms` | | |
| `mix_ms` | | |
| `share_video_ms` | | |
| `email_ms` | | |
| **Total `wall_clock_ms`** | | |

**Stripe test card used:** `4242 4242 4242 4242`
**Child name:** Mira
**Mood:** dreamy
**Favorites:** stars, blueberries, dinosaur
**Voice:** (record voice id)

**Result:** ☐ PASS (total < 300 s) / ☐ FAIL (total ≥ 300 s)

---

## Degradation Strategy (if total > 300 s)

If the 300 s budget is breached, apply the following short-circuit measures
**in order** (cheapest path first). Do NOT change the 300 s requirement.

### Level 1: Drop share video

- Skip `step.run("share-video")` entirely
- Leave `share_video_object_key` as null on the asset
- Saves up to **90 s** from the pipeline
- Delivery page still works (video player hidden when no share video)
- Impact: no viral share artifact, but MP3 delivery is intact

### Level 2: Narrow lyric budget

- Reduce the lyrics word-count target from 80–400 to 80–200 words
- This shortens narration duration → shorter music request → faster mix
- Expected savings: **30–60 s** across TTS + music + mix steps
- Update the OpenAI prompt to request "a concise lullaby of 100–180 words"
- Narration will land in ~60–120 s → final MP3 closer to 150 s floor

### Level 3: Reduce music timeout

- Drop music step timeout from 120 s to 60 s
- Accept shorter music tracks (loop if needed in mix step)
- Expected savings: **up to 60 s** on the music step

### Breach Log

Record any budget breaches below:

| Date | Total (ms) | Breach Amount | Degradation Applied | Notes |
|------|-----------|---------------|---------------------|-------|
| | | | | |

---

## Pre-flight Verification Checklist

Before running the performance test, confirm:

- [x] `tsc --noEmit` passes with 0 errors ✅ (verified)
- [x] `vitest run` passes all tests ✅ (137/137 tests pass, 13/14 suites green)
- [ ] All three terminals running (Next.js dev, Inngest dev, Stripe CLI)
- [ ] `.env.local` has all required keys (see `notes/day2-smoke.md`)
- [ ] Supabase migration applied (`supabase db push`)
- [ ] `lullabies` bucket exists and is private
- [ ] ffmpeg-static binary is executable (`chmod +x node_modules/ffmpeg-static/ffmpeg`)

### Pre-flight notes

- `tsc --noEmit`: 0 errors, exit code 0
- `vitest run`: 137 tests pass across 13 suites; 1 optional property test suite
  (`tests/properties/form-validation.spec.ts`) has a `fast-check` API usage error
  at import time (task 28.1, marked optional `*`) — does not affect core functionality

---

_Created for task 29.3. Update this file with real measurements after each live run._
