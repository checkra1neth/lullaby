# Vercel Production Deployment Guide

_Task 30 — Req: 4.6, 17.1 | Design: §7 Security & Compliance, §8 Env vars_

---

## Prerequisites

- A [Vercel](https://vercel.com) account (Hobby or Pro)
- The GitHub/GitLab repo containing the `lullaby/` directory pushed to a remote
- All third-party accounts created and configured:
  - Stripe (test mode)
  - Supabase (project with migration applied)
  - ElevenLabs
  - OpenAI
  - Upstash Redis
  - Resend (with verified sender domain)
  - Inngest Cloud

---

## Step 1 — Import the project to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the repository
3. Set the **Root Directory** to `lullaby` (if the repo root is the parent directory)
4. Framework Preset: **Next.js** (auto-detected)
5. Build Command: `npm run build` (auto-detected from `vercel.json`)
6. Click **Deploy** — the first deploy will fail because env vars are not set yet. That's fine.

---

## Step 2 — Configure environment variables

Go to **Project Settings → Environment Variables** and add every key below.
Set them for **Production** (and optionally Preview/Development).

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` | e.g. `https://lullaby-demo.vercel.app` |
| `SUPABASE_URL` | Your Supabase project URL | Settings → API |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key | Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | Settings → API (keep secret!) |
| `SUPABASE_BUCKET_LULLABIES` | `lullabies` | Must match the private bucket name |
| `STRIPE_SECRET_KEY` | `sk_test_...` | **MUST be a test key** (Req 4.6) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Step 3 below |
| `STRIPE_PRICE_ONE_OFF` | `price_...` | One-off $4.99 price ID |
| `STRIPE_PRICE_SUBSCRIPTION` | `price_...` | Monthly $14.99 price ID |
| `OPENAI_API_KEY` | `sk-...` | OpenAI platform key |
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key | Dashboard → API keys |
| `ELEVENLABS_VOICE_IDS` | `["voice_id_1","voice_id_2"]` | JSON array of preset voice IDs |
| `INNGEST_EVENT_KEY` | From Inngest Cloud dashboard | |
| `INNGEST_SIGNING_KEY` | From Inngest Cloud dashboard | |
| `UPSTASH_REDIS_REST_URL` | `https://...upstash.io` | Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | Token from Upstash console | |
| `RESEND_API_KEY` | `re_...` | Resend dashboard |
| `RESEND_FROM` | `Lullaby <hello@yourdomain.com>` | Must be a verified sender |

> **Critical**: `STRIPE_SECRET_KEY` MUST start with `sk_test_`. The app refuses
> to boot with a live key (Req 4.6, enforced in `lib/env.ts`).

---

## Step 3 — Configure Stripe webhook for production

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Click **Add endpoint**
3. Set the endpoint URL to:
   ```
   https://<your-vercel-domain>/api/stripe/webhook
   ```
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**
6. Copy the **Signing secret** (`whsec_...`) shown on the endpoint detail page
7. Go back to Vercel → Project Settings → Environment Variables
8. Set `STRIPE_WEBHOOK_SECRET` to the new `whsec_...` value
9. **Redeploy** the project (Settings → Deployments → Redeploy, or push a commit)

### Verify webhook is working

```bash
# From Stripe CLI (optional, for quick test):
stripe trigger checkout.session.completed \
  --override checkout_session:success_url="https://<your-vercel-domain>/orders/test"
```

Check the Stripe webhook logs in the dashboard — you should see a `200` response.

---

## Step 4 — Connect Inngest Cloud

1. Go to [app.inngest.com](https://app.inngest.com)
2. Create or select your app
3. Go to **Apps → Add App**
4. Set the app URL to:
   ```
   https://<your-vercel-domain>/api/inngest
   ```
5. Click **Connect** / **Sync**
6. Confirm the `generateLullaby` function appears in the **Functions** tab

### Verify Inngest connection

- The Inngest dashboard should show the app as "Connected" with 1 registered function
- The function name should be `generateLullaby` with concurrency: 5

---

## Step 5 — Verify Supabase Storage bucket is private

1. Go to your Supabase project → **Storage**
2. Click on the `lullabies` bucket
3. Go to **Policies** or check the bucket settings
4. Confirm:
   - The bucket is **NOT public** (toggle should be off)
   - Only the service-role key can write (no RLS policies granting public write)
   - Read access is only via signed URLs (no public read policy)

If the bucket was accidentally created as public:
```sql
-- In Supabase SQL Editor:
UPDATE storage.buckets SET public = false WHERE id = 'lullabies';
```

---

## Step 6 — Trigger a redeploy

After setting all env vars and configuring the webhook:

1. Go to Vercel → Project → **Deployments**
2. Click the three dots on the latest deployment → **Redeploy**
3. Wait for the build to succeed (should take ~60s)
4. Visit `https://<your-vercel-domain>` and confirm the landing page loads

---

## Step 7 — Run the production smoke test

Follow the same Mira scenario from `notes/day2-smoke.md`, but against the
Vercel domain instead of localhost:

### 7.1 Preview clip

1. Open `https://<your-vercel-domain>/create`
2. Fill the form: Child name "Mira", Age 3, Favorites: stars/blueberries/dinosaur, Mood: dreamy
3. Click **Preview**
4. ✅ Audio plays within 15s with personalized voice

### 7.2 Checkout

5. Click **Buy ($4.99)**
6. ✅ Redirects to Stripe Checkout
7. Pay with `4242 4242 4242 4242`, any future expiry, any CVC
8. ✅ Redirects back to `/orders/{order_id}`

### 7.3 Generation pipeline

9. ✅ Delivery page shows progress indicator
10. ✅ Status flips to `succeeded` within 300 seconds

### 7.4 Playback & downloads

11. ✅ Audio player renders, MP3 plays (150–360s duration)
12. ✅ Video player renders (720×1280, 15–30s, waveform + "Mira" overlay)
13. ✅ Download links work

### 7.5 Delivery email

14. ✅ Email arrives at the test inbox within 60s of `succeeded`
15. ✅ Subject: "Your lullaby is ready"
16. ✅ Contains delivery page link and download links

---

## Troubleshooting

### Build fails on Vercel

- Check that `STRIPE_SECRET_KEY` starts with `sk_test_` — the app refuses to
  compile with a live key
- Ensure `ELEVENLABS_VOICE_IDS` is valid JSON (array of strings)
- Check Vercel build logs for missing env vars

### Webhook returns 400

- Verify `STRIPE_WEBHOOK_SECRET` matches the signing secret shown on the
  Stripe webhook endpoint detail page
- Ensure you're using the **production** webhook secret, not the CLI `stripe listen` one
- Check that the endpoint URL exactly matches: `https://<domain>/api/stripe/webhook`

### Inngest function doesn't run

- Confirm the app URL in Inngest Cloud points to the correct Vercel domain
- Check that `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are set in Vercel env
- Look at Inngest Cloud → Runs for error details

### ffmpeg errors (mix/share-video step)

- `ffmpeg-static` should work on Vercel's Node.js runtime out of the box
- If you see `EACCES`, the Vercel function may need the Pro plan for longer
  execution times (the `vercel.json` sets `maxDuration: 300` for the Inngest route)
- Check that the Supabase Storage signed URLs are accessible from Vercel's network

### Signed URLs return 403

- Confirm the `lullabies` bucket exists and is private
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is correct (not the anon key)
- Check that the object keys stored in `lullaby_assets` match actual files in storage

---

## Architecture notes for Vercel

- **Serverless functions**: All API routes run as serverless functions
- **Inngest route**: Set to 300s max duration (requires Vercel Pro for >60s)
- **Static pages**: `/auth/invalid`, `/auth/sign-in` are prerendered
- **Dynamic pages**: `/`, `/create`, `/library`, `/orders/[id]` are server-rendered
- **Middleware**: Handles route matching for the out-of-scope rejection surface
- **No edge runtime**: All routes use Node.js runtime (required for `ffmpeg-static`,
  Supabase client, Stripe SDK)

---

## `vercel.json` configuration

The `vercel.json` at the project root configures:
- Framework: Next.js
- Function timeout overrides:
  - `/api/inngest` → 300s (Inngest step callbacks can take up to 60s each)
  - `/api/stripe/webhook` → 30s (webhook must respond quickly)
  - `/api/preview` → 30s (ElevenLabs TTS has a 15s timeout)

---

_Last updated: Task 30 deployment preparation._
