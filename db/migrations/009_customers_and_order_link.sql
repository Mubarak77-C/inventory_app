BEGIN;

CREATE TABLE IF NOT EXISTS public.customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL CHECK (char_length(trim(name)) > 0),
  email VARCHAR(255),
  phone VARCHAR(30),
  address_line1 TEXT,
  address_line2 TEXT,
  extra_details TEXT,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers (lower(name));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders (customer_id);

COMMIT;