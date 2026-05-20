-- 0001_init.sql
-- Initial schema for the Lullaby personalized app (design §4 Data Models).
-- All tables, CHECK / UNIQUE constraints, FKs and indexes are defined here.

-- citext is required for case-insensitive parent_email columns (orders, subscriptions).
CREATE EXTENSION IF NOT EXISTS citext;
-- pgcrypto provides gen_random_uuid() for uuid PKs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

----------------------------------------------------------------------
-- subscriptions
-- Keyed on stripe_subscription_id so checkout.subscription.* events upsert by id (Req 5.2, 5.3).
----------------------------------------------------------------------
CREATE TABLE subscriptions (
    stripe_subscription_id text PRIMARY KEY,
    stripe_customer_id     text        NOT NULL,
    parent_email           citext      NOT NULL,
    status                 text        NOT NULL
        CHECK (status IN ('incomplete','active','trialing','past_due','canceled','unpaid')),
    current_period_end     timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_stripe_customer_id_idx ON subscriptions (stripe_customer_id);
CREATE INDEX subscriptions_parent_email_idx       ON subscriptions (parent_email);

----------------------------------------------------------------------
-- orders
-- One purchase intent. lullaby_asset_id FK is added after lullaby_assets exists
-- because the two tables form a one-to-one cycle.
----------------------------------------------------------------------
CREATE TABLE orders (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_checkout_session_id  text        UNIQUE,                       -- Req 6.5, 19.1
    stripe_subscription_id      text        REFERENCES subscriptions(stripe_subscription_id),
    parent_email                citext      NOT NULL,                     -- NEVER LOG (Req 18)
    child_name                  text        NOT NULL
        CHECK (char_length(child_name) BETWEEN 1 AND 40),                 -- Req 2.3
    child_age                   int         NOT NULL
        CHECK (child_age BETWEEN 0 AND 5),                                -- Req 2.4
    favorites                   text[]      NOT NULL
        CHECK (
            array_length(favorites, 1) BETWEEN 1 AND 3                    -- Req 2.5
        ),
    mood                        text        NOT NULL
        CHECK (mood IN ('calm','playful','dreamy')),                      -- Req 2.1
    language                    text        NOT NULL
        CHECK (language = 'en'),                                          -- Req 2.7, 21.7
    narrator_voice_id           text        NOT NULL,                     -- Req 2.6, 9.1
    from_name                   text
        CHECK (from_name IS NULL OR char_length(from_name) BETWEEN 1 AND 40),
    sku                         text        NOT NULL
        CHECK (sku IN ('one_off','subscription')),                        -- Req 4, 5
    lullaby_asset_id            uuid        UNIQUE,                       -- FK added below; UNIQUE → Req 19.1
    delivery_email_sent_at      timestamptz,                              -- Req 14.4, 14.5
    created_at                  timestamptz NOT NULL DEFAULT now()
);

-- Index that powers the library page's reverse-chronological pagination (Req 16.1).
CREATE INDEX orders_parent_email_created_at_idx
    ON orders (parent_email, created_at DESC);

----------------------------------------------------------------------
-- lullaby_assets
-- One asset per order (UNIQUE on order_id enforces Req 19.1, 19.2).
----------------------------------------------------------------------
CREATE TABLE lullaby_assets (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                uuid        NOT NULL UNIQUE
        REFERENCES orders(id),                                             -- Req 19.1
    mp3_object_key          text        NOT NULL,                          -- Req 11.4, 17.1
    share_video_object_key  text,                                          -- Req 12.7
    mp3_duration_seconds    int         NOT NULL
        CHECK (mp3_duration_seconds BETWEEN 150 AND 360),                  -- Req 11.2
    mp3_bitrate_kbps        int         NOT NULL
        CHECK (mp3_bitrate_kbps BETWEEN 128 AND 192),                      -- Req 11.4
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- Now wire orders.lullaby_asset_id → lullaby_assets.id (Req 19.1).
ALTER TABLE orders
    ADD CONSTRAINT orders_lullaby_asset_id_fkey
    FOREIGN KEY (lullaby_asset_id) REFERENCES lullaby_assets(id);

----------------------------------------------------------------------
-- generation_jobs
-- One job per order, status lifecycle queued → running → succeeded|failed (Req 7.2).
----------------------------------------------------------------------
CREATE TABLE generation_jobs (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id              uuid        NOT NULL UNIQUE REFERENCES orders(id),
    status                text        NOT NULL
        CHECK (status IN ('queued','running','succeeded','failed')),       -- Req 7.2
    failure_reason        text
        CHECK (
            failure_reason IS NULL
            OR failure_reason IN (
                'lyrics_generation_failed',
                'tts_api_error',
                'missing_voice_id',
                'music_generation_failed',
                'insufficient_music_duration',
                'mixing_failed',
                'share_video_upload_failed',
                'timeout'
            )
        ),                                                                  -- Req 7.7 + §6 mapping
    narration_object_key  text,                                             -- Req 9.2
    music_object_key      text,                                             -- Req 10.2
    started_at            timestamptz,                                      -- Req 7.6
    finished_at           timestamptz,
    inngest_run_id        text
);

CREATE INDEX generation_jobs_inngest_run_id_idx ON generation_jobs (inngest_run_id);

----------------------------------------------------------------------
-- stripe_events
-- Insert-before-side-effects dedupe table (Req 6.3, 6.4).
----------------------------------------------------------------------
CREATE TABLE stripe_events (
    event_id     text        PRIMARY KEY,                                    -- Req 6.3
    type         text        NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now()
);

----------------------------------------------------------------------
-- magic_link_issuance_log
-- Durable audit trail for magic-link issuance rate limiting (Req 15.6).
-- We log SHA-256 of the lowercased email, never the email itself (Req 18).
----------------------------------------------------------------------
CREATE TABLE magic_link_issuance_log (
    id          bigserial   PRIMARY KEY,
    email_hash  bytea       NOT NULL,
    issued_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX magic_link_issuance_log_email_hash_idx
    ON magic_link_issuance_log (email_hash);

----------------------------------------------------------------------
-- delivery_email_log
-- Append-only attempt log; orders.delivery_email_sent_at is the authoritative flag (Req 14.5).
----------------------------------------------------------------------
CREATE TABLE delivery_email_log (
    id            bigserial   PRIMARY KEY,
    order_id      uuid        NOT NULL REFERENCES orders(id),
    attempt       int         NOT NULL,                                      -- 1..3 (Req 14.3)
    status        text        NOT NULL
        CHECK (status IN ('sent','transient_failure','permanent_failure')),
    attempted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX delivery_email_log_order_id_idx ON delivery_email_log (order_id);
