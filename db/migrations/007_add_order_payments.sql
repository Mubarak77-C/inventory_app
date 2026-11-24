ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(16),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_payment_method,
  ADD CONSTRAINT chk_orders_payment_method
    CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'CARD', 'UPI'));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_payment_status,
  ADD CONSTRAINT chk_orders_payment_status
    CHECK (payment_status IN ('UNPAID', 'PAID'));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_paid_consistency,
  ADD CONSTRAINT chk_orders_paid_consistency
    CHECK (
      (payment_status = 'UNPAID' AND paid_at IS NULL) OR
      (payment_status = 'PAID' AND payment_method IS NOT NULL AND paid_at IS NOT NULL)
    );