-- Phase 3b (slice 1) — generic product bases
-- ---------------------------------------------------------------------------
-- `product_bases` is the imported provider-catalog cache (plan §2.2): one row
-- per provider catalog/product family, with GENERIC `variant_axes` instead of
-- the hardcoded size/frame/depth vocabulary. Populated by the
-- `pod-catalog-import` edge function (provider.getProductCatalog()); refreshed
-- periodically to handle catalog drift (plan §4).
--
-- `print_areas` stays empty in this slice — dimensions/safe-area/bleed join in
-- the editor print-area slice (3b) and print specs (3c).
--
-- Catalog data is PUBLIC (it is the provider's public catalog, nothing
-- tenant-specific), so reads are open; writes are service-role only.
-- ---------------------------------------------------------------------------

CREATE TABLE public.product_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'gelato',
  provider_product_id text NOT NULL,           -- Gelato: catalogUid ("posters", "apparel", ...)
  title text NOT NULL DEFAULT '',
  category text,                               -- normalized category; curated in a later slice
  variant_axes jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ key, label, values: [{ key, label }] }]
  print_areas jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, label, widthMm, heightMm, ... }] (3c)
  mockup text NOT NULL DEFAULT 'api',          -- "api" | "overlay" | "procedural"
  raw jsonb,                                   -- provider payload as imported (debug/re-derive)
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_product_id)
);

CREATE INDEX idx_product_bases_provider ON public.product_bases (provider);

CREATE TRIGGER update_product_bases_updated_at
  BEFORE UPDATE ON public.product_bases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_bases ENABLE ROW LEVEL SECURITY;

-- Public read (provider catalogs are public data); no client writes.
CREATE POLICY "product_bases_public_read"
  ON public.product_bases FOR SELECT
  USING (true);

REVOKE ALL ON public.product_bases FROM anon, authenticated;
GRANT SELECT ON public.product_bases TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bases TO service_role;
