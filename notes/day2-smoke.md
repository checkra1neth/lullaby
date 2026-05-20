# Day 2 — End-to-End Smoke Verification

_Req: 7.5, 11.2, 12.2, 13.3, 13.4, 14.1 | Design: §11 Demo Storyboard, §9 Performance Budget_

---

## Automated pre-flight (completed ✅)

| Check | Result |
|---|---|
| `tsc --noEmit` | **0 errors** — codebase compiles cleanly |
| `vitest run` | **116 / 116 tests pass** across 11 test files |

---

## Manual smoke-test procedure

The full live pipeline requires three processes running simultaneously plus
real API credentials. Follow the steps below in order.

### Prerequisites

All keys must be present in `lullaby/.env.local` before starting:

| Key | Source |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe dashboard → test mode API keys (must start `sk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | Printed by `stripe listen …` at startup (step 3 below) |
| `STRIPE_PRICE_ONE_OFF` | Stripe test product "One-off lullaby" price id |
| `STRIPE_PRICE_SUBSCRIPTION` | Stripe test product "Lullaby subscription" price id |
| `SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API |
| `SUPABASE_BUCKET_LULLABIES` | `lullabies` (private bucket, created in dashboard) |
| `ELEVENLABS_API_KEY` | ElevenLabs dashboard → API keys |
| `ELEVENLABS_VOICE_IDS` | JSON array of preset voice ids, e.g. `["voice_id_1","voice_id_2"]` |
| `OPENAI_API_KEY` | OpenAI platform → API keys |
| `RESEND_API_KEY` | Resend dashboard → API keys |
| `RESEND_FROM` | Verified sender address, e.g. `lullaby@yourdomain.com` |
| `UPSTASH_REDIS_REST_URL` | Upstash console → Redis database |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console → Redis database |
| `INNGEST_EVENT_KEY` | Inngest dashboard (can be blank for local dev) |
| `INNGEST_SIGNING_KEY` | Inngest dashboard (can be blank for local dev) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local testing |

### Step 1 — Start the Next.js dev server

```bash
# Terminal 1
cd lullaby
npm run dev
# → http://localhost:3000
```

### Step 2 — Start the Inngest dev server

```bash
# Terminal 2
cd lullaby
npm run inngest:dev
# → http://localhost:8288
```

Verify: open http://localhost:8288 and confirm the `lullaby` app is listed
under **Apps** with the `generateLullaby` function registered.

### Step 3 — Start Stripe webhook forwarding

```bash
# Terminal 3
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_…` secret printed at startup into `.env.local` as
`STRIPE_WEBHOOK_SECRET`, then restart Terminal 1 if this is the first run.

---

## Smoke-test script (Mira scenario)

### 3.1 Preview clip (Req 3)

1. Open http://localhost:3000/create
2. Fill the form:
   - **Child name**: `Mira`
   - **Age**: `3`
   - **Favorites**: `stars`, `blueberries`, `dinosaur` (add all three)
   - **Mood**: `dreamy`
   - **Language**: `en` (fixed)
   - **Voice**: select any preset voice
   - **Parent email**: your test inbox address
3. Click **Preview**.
4. ✅ Expected: audio plays within 15 s; the voice says "Goodnight, Mira" or
   similar personalized phrase. Duration 5–12 s (Req 3.2, 3.3).

### 3.2 Checkout (Req 4)

5. Click **Buy ($4.99)**.
6. ✅ Expected: browser redirects to Stripe-hosted Checkout within 2 s (Req 4.4).
7. Enter card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
8. Click **Pay**.
9. ✅ Expected: Stripe redirects to `/orders/{order_id}?session_id=…`.

### 3.3 Delivery page polling (Req 7.5, 13.2)

10. ✅ Expected: delivery page shows a progress indicator while status is
    `queued` or `running`. Polling interval ≤ 3 s.
11. ✅ Expected: status flips `running` → `succeeded` within **300 seconds**
    (Req 7.6, §9 Performance Budget).

### 3.4 Audio player (Req 13.3)

12. ✅ Expected: an `<audio>` player renders with play/pause/scrub/mute controls.
13. ✅ Expected: MP3 plays; duration 150–360 s (Req 11.2).

### 3.5 Share video player (Req 12.2, 13.3)

14. ✅ Expected: a `<video>` player renders vertically (9:16, 720×1280).
15. ✅ Expected: video duration 15–30 s; waveform animation visible; "Mira"
    overlay visible for the full duration (Req 12.3, 12.4).

### 3.6 Download links (Req 13.4)

16. Click the MP3 download link.
    ✅ Expected: file downloads as `lullaby-mira-YYYY-MM-DD.mp3`.
17. Click the share video download link.
    ✅ Expected: file downloads as `lullaby-mira-YYYY-MM-DD.mp4`.

### 3.7 Delivery email (Req 14.1)

18. ✅ Expected: within 60 s of `succeeded`, an email arrives at the test inbox
    with subject "Your lullaby is ready", a link to the delivery page, and
    download links for the MP3 and share video.

---

## Known deviations / Day-3 follow-up items

### DEV-1 — Tasks 22 and 23 not yet complete (marked `[-]` in tasks.md)

- **Task 22** (`/api/preview` real ElevenLabs TTS + rate limit): the preview
  endpoint currently returns a hard-coded stub WAV from
  `public/samples/preview-stub.wav`. The real ElevenLabs TTS call and the
  Upstash rate-limit guard are not yet wired. The preview audio will play but
  will not be personalized to the child's name.
  - _Day-3 action_: implement `lib/gen/preview.ts` and swap the stub.

- **Task 23** (`/api/assets/[lullaby_asset_id]/[kind]` signed-URL gate): the
  asset download endpoint is not yet implemented. Download links on the
  delivery page will 404 until this route is added.
  - _Day-3 action_: implement the signed-URL gate with Supabase session auth.

### DEV-2 — Magic-link auth (Task 24) not yet complete

The `/api/auth/magic` and `/auth/callback` routes are not yet implemented.
The delivery page relies on the fresh-checkout cookie (Task 10, ✅ complete)
for the immediate post-payment session, so the demo flow works without
sign-in. The library page (`/library`) will redirect to `/auth/sign-in` which
does not yet exist.
- _Day-3 action_: implement magic-link auth before recording the demo if the
  library page is part of the demo storyboard.

### DEV-3 — Inngest dev server required for local testing

The `generateLullaby` Inngest function only runs when the Inngest dev server
(`npm run inngest:dev`) is active. Without it, the webhook fires the event but
the job stays in `queued` indefinitely.

### DEV-4 — ffmpeg-static binary must be executable

On some macOS setups the `ffmpeg-static` binary may not be executable after
`npm install`. If the mix or share-video step fails with `EACCES`:

```bash
chmod +x lullaby/node_modules/ffmpeg-static/ffmpeg
```

### DEV-5 — Supabase Storage bucket must be private

The `lullabies` bucket must be created as **private** in the Supabase
dashboard. If it was accidentally created as public, signed URLs still work
but unauthenticated direct access would bypass Req 17.

---

## Performance budget reference (Design §9)

| Metric | Budget | Notes |
|---|---|---|
| Preview clip latency | ≤ 15 s | ElevenLabs TTS per-attempt timeout |
| Checkout session creation | ≤ 3 s | Stripe API call |
| Browser redirect to Stripe | ≤ 2 s | Client-side redirect |
| Status endpoint response | ≤ 1 s | Indexed DB read |
| Full pipeline (queued → succeeded) | ≤ 300 s | Inngest function-level timeout |
| Delivery email after succeeded | ≤ 60 s | Resend + Inngest email step |

---

_Last updated: Day 2 smoke run. Automated checks: tsc ✅, vitest 116/116 ✅._
