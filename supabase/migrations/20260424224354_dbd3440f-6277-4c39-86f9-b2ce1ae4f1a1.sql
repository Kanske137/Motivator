-- 1. Add Shopify metadata columns to product_configs
ALTER TABLE public.product_configs
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS category_gid text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS sales_channels text[] NOT NULL DEFAULT ARRAY['online_store']::text[],
  ADD COLUMN IF NOT EXISTS description_html text,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text;

ALTER TABLE public.product_configs
  ADD CONSTRAINT product_configs_status_check
  CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'));

-- 2. Sync state table
CREATE TABLE IF NOT EXISTS public.shopify_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_config_id uuid NOT NULL REFERENCES public.product_configs(id) ON DELETE CASCADE,
  shopify_product_id text,
  last_synced_at timestamptz,
  last_synced_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_config_id)
);

ALTER TABLE public.shopify_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read sync state"
  ON public.shopify_sync_state FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert sync state (TODO admin auth)"
  ON public.shopify_sync_state FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update sync state (TODO admin auth)"
  ON public.shopify_sync_state FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_shopify_sync_state_updated_at
  BEFORE UPDATE ON public.shopify_sync_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_shopify_sync_state_product_config
  ON public.shopify_sync_state(product_config_id);