-- db/migrations/008_payment_attempts_and_webhooks.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  provider VARCHAR(32) NOT NULL DEFAULT 'stripe_test',
  provider_payment_id VARCHAR(128),
  payment_method VARCHAR(16) NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'UPI')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  status VARCHAR(24) NOT NULL DEFAULT 'REQUIRES_ACTION'
    CHECK (status IN ('REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  failure_code VARCHAR(64),
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id
  ON public.payment_attempts(order_id);

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  event_id VARCHAR(128) PRIMARY KEY,
  provider VARCHAR(32) NOT NULL DEFAULT 'stripe_test',
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;