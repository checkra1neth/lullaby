# Lullaby — local setup notes

Workspace-level setup steps that aren't captured in code. Update this file as
new steps are introduced by later tasks.

## 1. Environment

1. Copy `.env.local.example` to `.env.local`.
2. Fill in every key. `STRIPE_SECRET_KEY` MUST start with `sk_test_` — the app
   refuses to boot on a live key (design §8, Req 4.6, enforced by `lib/env.ts`).

## 2. Supabase project

The project is not provisioned yet. Once you have a Supabase project:

1. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in
   `.env.local` from the project's API settings.
2. Set `SUPABASE_BUCKET_LULLABIES=lullabies`.

### 2a. Apply the database migration

The migration is committed at `supabase/migrations/0001_init.sql` and creates
all 7 tables from design §4 plus the `citext` extension.

```bash
# Link the local repo to the Supabase project (one-time).
supabase link --project-ref <your-ref>

# Push the migration.
supabase db push
```

Verification (run from psql against the project's database):

```sql
-- Confirm citext is installed.
SELECT extname FROM pg_extension WHERE extname = 'citext';

-- Confirm all 7 tables exist.
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'orders',
    'lullaby_assets',
    'subscriptions',
    'generation_jobs',
    'stripe_events',
    'magic_link_issuance_log',
    'delivery_email_log'
  )
ORDER BY tablename;
-- Expect 7 rows.
```

### 2b. Create the private Storage bucket `lullabies`

Performed in the Supabase dashboard (no SQL equivalent for bucket privacy
toggle on first creation):

1. Open the Supabase project → **Storage** in the left sidebar.
2. Click **New bucket**.
3. **Name**: `lullabies` (must match `SUPABASE_BUCKET_LULLABIES`).
4. **Public bucket**: leave the toggle OFF — the bucket must be private. All
   reads happen via signed URLs (Req 17).
5. Click **Create bucket**.
6. (Optional) Inside the new bucket, pre-create the folders we will use later
   so paths are obvious in the dashboard:
   - `narration/`
   - `music/`
   - `mp3/`
   - `share-videos/`

The bucket name and privacy setting must remain unchanged across environments.

## 3. Stripe (test mode)

`lib/env.ts` rejects any `STRIPE_SECRET_KEY` that does not start with
`sk_test_` (Req 4.6). All Stripe work for v1 is in test mode.

### 3a. Test-mode API keys

1. Open the Stripe dashboard at <https://dashboard.stripe.com/test/apikeys>.
   Confirm the **Viewing test data** toggle is ON.
2. Copy the **Secret key** (starts with `sk_test_`) into `.env.local` as
   `STRIPE_SECRET_KEY`.
3. The webhook secret is set in step 3c below.

### 3b. Create the two products + prices

Either of these flows works. The dashboard flow is faster for a one-time setup.

**Dashboard:** <https://dashboard.stripe.com/test/products>

1. **One-off lullaby**
   - **Name**: `One-off lullaby`
   - **Pricing model**: `One-time`
   - **Price**: `4.99 USD`
   - Click **Save product**, then copy the price id (starts with `price_…`)
     into `.env.local` as `STRIPE_PRICE_ONE_OFF`.

2. **Lullaby subscription**
   - **Name**: `Lullaby subscription`
   - **Pricing model**: `Recurring`
   - **Price**: `14.99 USD` / `Monthly`
   - Click **Save product**, then copy the price id into `.env.local` as
     `STRIPE_PRICE_SUBSCRIPTION`.

**Stripe CLI alternative** (run these from any shell, replace nothing):

```bash
stripe products create --name "One-off lullaby"
# → note the returned product id, e.g. prod_ABC
stripe prices create \
  --product prod_ABC \
  --currency usd \
  --unit-amount 499
# → note the returned price id (price_…) and put it in STRIPE_PRICE_ONE_OFF.

stripe products create --name "Lullaby subscription"
# → note the returned product id, e.g. prod_DEF
stripe prices create \
  --product prod_DEF \
  --currency usd \
  --unit-amount 1499 \
  --recurring "interval=month"
# → note the returned price id (price_…) and put it in STRIPE_PRICE_SUBSCRIPTION.
```

### 3c. Local webhook forwarding

Once task 7 lands the webhook route, run:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_…` secret printed at startup into `.env.local` as
`STRIPE_WEBHOOK_SECRET`. The Stripe client itself is constructed lazily by
`lib/stripe.ts` with a 10-second per-request timeout (Req 4.1).

## 4. Inngest dev environment

Inngest is the async job runtime (design §3.1 Generator_Service, §6 Trigger
choice). The shared client lives in `lib/inngest.ts` (id: `"lullaby"`) and is
served by `app/api/inngest/route.ts`, which the Inngest dev CLI discovers.

### 4a. Run the dev server alongside Next.js

In **two terminals**:

```bash
# Terminal 1 — Next.js app
npm run dev          # http://localhost:3000

# Terminal 2 — Inngest dev server (keep this running)
npm run inngest:dev  # binds http://localhost:8288 and polls /api/inngest
```

`npm run inngest:dev` is shorthand for
`npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` and is
defined in `package.json`. The first run will download the CLI, which can
take 20–30 seconds.

### 4b. Verify the wiring

1. Visit <http://localhost:8288>. The Inngest UI should list the `lullaby`
   app under **Apps**, sourced from `http://localhost:3000/api/inngest`.
2. `curl http://localhost:3000/api/inngest` returns a small JSON body
   describing the app — that's how the CLI introspects it.
3. The list of registered functions stays empty until task 7 wires the
   stub `generateLullaby`.

### 4c. Production keys

For deployed environments, set `INNGEST_EVENT_KEY` (used by `inngest.send`)
and `INNGEST_SIGNING_KEY` (used by the `serve` handler) from the Inngest
dashboard. Locally, both can be left blank — the dev server signs requests
itself.


## 5. Verifying Stripe Checkout end-to-end (Task 6)

The checkout endpoints are live at `/api/checkout/one-off` and
`/api/checkout/subscription`. Both re-validate the form payload server-side
with the same zod schema the client uses, then hand off to Stripe-hosted
Checkout in test mode.

Manual verification:

1. Make sure `.env.local` has `STRIPE_SECRET_KEY` (sk_test_…),
   `STRIPE_PRICE_ONE_OFF`, `STRIPE_PRICE_SUBSCRIPTION`, `NEXT_PUBLIC_APP_URL`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ELEVENLABS_VOICE_IDS` set.
2. `npm run dev` and open <http://localhost:3000/create>.
3. Fill the form with a valid payload (e.g. child_name `Mira`, age `3`,
   favorites `stars`, mood `dreamy`, language `English`, any voice id, your
   email).
4. Click **Buy ($4.99)** — the browser redirects to a Stripe-hosted Checkout
   URL within ~2 s. Pay with `4242 4242 4242 4242`, any future expiry, any
   3-digit CVC, any ZIP. Stripe accepts the card and redirects to
   `/orders/{order_id}?session_id=…` (the delivery page is a Task-9 stub).
5. In Supabase, confirm a new row in `orders` with `sku='one_off'`,
   `stripe_checkout_session_id` set, and the form fields persisted.
6. Click **Subscribe monthly instead ($14.99/mo)** to exercise the
   subscription endpoint. Stripe creates a subscription session; the
   subscription `orders` row is NOT created here (the webhook in Task 7 +
   library regen in Task 25 own that).

Failure modes you can sanity-check:

- Remove `STRIPE_PRICE_ONE_OFF` from `.env.local` → click Buy → the route
  returns 503 and the form surfaces "One-time checkout is temporarily
  unavailable".
- Submit the form with a tampered `language` field via `curl` →
  `400 validation_failed` with field-scoped issues, no PII in the body.


## 6. Verifying the Stripe webhook + stub Inngest pipeline (Task 7)

The webhook lives at `/api/stripe/webhook`. It reads the raw body via
`req.text()`, verifies the signature with `STRIPE_WEBHOOK_SECRET`, inserts an
idempotency row into `stripe_events`, and on a unique
`checkout.session.completed` event for `mode=payment`, upserts the `orders`
row, ensures a `generation_jobs` row exists, and dispatches the Inngest event
`lullaby/generate.requested`. The stub `generateLullaby` function flips the
job through `running` → `succeeded` after a 5-second sleep so the polling UI
exercises end-to-end without the real pipeline.

End-to-end verification (three terminals):

```bash
# Terminal 1 — Next.js
npm run dev

# Terminal 2 — Inngest dev server (registers generateLullaby)
npm run inngest:dev

# Terminal 3 — Stripe webhook forwarding (copy the printed whsec_… into .env.local
# as STRIPE_WEBHOOK_SECRET, then restart Terminal 1 if needed).
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Drive a real checkout:

1. Open <http://localhost:3000/create>, fill a valid form, click **Buy ($4.99)**.
2. On the Stripe-hosted page, pay with `4242 4242 4242 4242`, any future
   expiry, any 3-digit CVC, any ZIP.
3. Confirm in Terminal 3 that the webhook delivery for
   `checkout.session.completed` returns `200`.
4. In Supabase, confirm:
   - `stripe_events` has a fresh row keyed on the event id.
   - `orders` has the row created by the checkout endpoint, now matched on
     `stripe_checkout_session_id`.
   - `generation_jobs` has a row for that `order_id` that flips
     `queued` → `running` → `succeeded` within ~5 seconds.
5. The Inngest dev UI (<http://localhost:8288>) shows the
   `lullaby/generate.requested` event and the corresponding
   `generateLullaby` run with two completed `step.run` blocks plus a
   `step.sleep`.

Idempotency check:

```bash
# Replay the most recent webhook event manually:
stripe events resend <evt_id>
```

The handler returns `200` with no additional `generation_jobs` mutation —
the duplicate `stripe_events` insert short-circuits before any side effects.

Subscription events (`customer.subscription.created|updated|deleted`) only
upsert / update the `subscriptions` row keyed on `stripe_subscription_id`.
A `deleted` event for an unknown subscription id is ignored (Req 5.5).
