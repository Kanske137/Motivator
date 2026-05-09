ALTER TABLE public.product_configs
  ADD COLUMN IF NOT EXISTS is_consolidated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enabled_product_types text[] NOT NULL DEFAULT '{}'::text[];