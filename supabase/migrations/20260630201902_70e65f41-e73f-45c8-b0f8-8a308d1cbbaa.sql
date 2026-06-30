ALTER TABLE public.gelato_orders
  ADD COLUMN IF NOT EXISTS shopify_order_gid       text,
  ADD COLUMN IF NOT EXISTS shopify_fulfillment_gid text,
  ADD COLUMN IF NOT EXISTS last_status             text,
  ADD COLUMN IF NOT EXISTS tracking_code           text,
  ADD COLUMN IF NOT EXISTS tracking_url            text,
  ADD COLUMN IF NOT EXISTS carrier                 text,
  ADD COLUMN IF NOT EXISTS fulfilled_at            timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at            timestamptz,
  ADD COLUMN IF NOT EXISTS raw                     jsonb;

CREATE INDEX IF NOT EXISTS gelato_orders_gelato_order_id_idx
  ON public.gelato_orders (gelato_order_id);
CREATE INDEX IF NOT EXISTS gelato_orders_shopify_order_id_idx
  ON public.gelato_orders (shopify_order_id);