-- Add template_slug column to group poster + canvas variants of the same template
ALTER TABLE public.product_configs
ADD COLUMN IF NOT EXISTS template_slug TEXT;

-- Backfill from existing shopify_handle by stripping product-type suffix
UPDATE public.product_configs
SET template_slug = regexp_replace(shopify_handle, '-(poster|posters|canvas)$', '')
WHERE template_slug IS NULL;

-- Index for fast lookup when grouping templates
CREATE INDEX IF NOT EXISTS idx_product_configs_template_slug
  ON public.product_configs(template_slug);