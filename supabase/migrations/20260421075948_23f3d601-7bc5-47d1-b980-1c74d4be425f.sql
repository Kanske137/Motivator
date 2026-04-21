CREATE TABLE public.gelato_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id text NOT NULL UNIQUE,
  shopify_order_name text,
  gelato_order_id text,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gelato_orders ENABLE ROW LEVEL SECURITY;

-- No public policies — only service_role (which bypasses RLS) can access.

CREATE TRIGGER update_gelato_orders_updated_at
BEFORE UPDATE ON public.gelato_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_gelato_orders_status ON public.gelato_orders(status);
CREATE INDEX idx_gelato_orders_created_at ON public.gelato_orders(created_at DESC);