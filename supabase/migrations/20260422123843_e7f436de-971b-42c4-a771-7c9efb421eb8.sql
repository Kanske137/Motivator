-- Add template jsonb column for the new modular design system
ALTER TABLE public.product_configs
  ADD COLUMN IF NOT EXISTS template jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill template for existing rows from current layouts/sizes/map_styles/text_config
-- This produces a minimal valid template so the customer editor keeps working
-- while admins migrate to the drag & drop designer.
UPDATE public.product_configs pc
SET template = jsonb_build_object(
  'version', 1,
  'publishedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'productOptions', jsonb_build_object(
    pc.product_type, jsonb_build_object(
      'enabled', true,
      'allowedSizes', COALESCE(
        (SELECT jsonb_agg(s->>'size') FROM jsonb_array_elements(pc.sizes) s),
        '[]'::jsonb
      ),
      CASE WHEN pc.product_type = 'canvas' THEN 'allowedDepths' ELSE 'allowedFrames' END,
      COALESCE(
        (
          SELECT jsonb_agg(DISTINCT v->>'name')
          FROM jsonb_array_elements(pc.sizes) s,
               jsonb_array_elements(s->'variants') v
        ),
        '[]'::jsonb
      )
    )
  ),
  'orientations', jsonb_build_array('portrait', 'landscape'),
  'defaultLayout', jsonb_build_object(
    'portrait', jsonb_build_object(
      'aspect', COALESCE(pc.layouts->'portrait'->>'aspect', '3:4'),
      'background', jsonb_build_object('color', '#EFE7D6'),
      'layers', '[]'::jsonb
    ),
    'landscape', jsonb_build_object(
      'aspect', COALESCE(pc.layouts->'landscape'->>'aspect', '4:3'),
      'background', jsonb_build_object('color', '#EFE7D6'),
      'layers', '[]'::jsonb
    )
  ),
  'sizeOverrides', '{}'::jsonb
)
WHERE pc.template IS NULL OR pc.template = '{}'::jsonb;

-- Index for faster lookups of published templates
CREATE INDEX IF NOT EXISTS idx_product_configs_template_published
  ON public.product_configs ((template->>'publishedAt'));