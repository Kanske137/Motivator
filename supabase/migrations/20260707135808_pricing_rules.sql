-- Per-tenant global default prices, keyed generically so new POD providers /
-- materials / sizes / variants just become new rows (no schema change needed).
CREATE TABLE public.pricing_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES public.shopify_app_installations(id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'gelato',
  material        text NOT NULL,           -- poster / canvas / aluminum / acrylic / (future)
  size            text NOT NULL,           -- e.g. "30x40"
  variant         text NOT NULL,           -- frame / depth / finish label, e.g. "Vit","2cm","Standard"
  price           numeric(10,2) NOT NULL CHECK (price >= 0),  -- in the shop's currency
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, provider, material, size, variant)
);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
-- Service-role-only (managed via the session-token guard). No public policies.
-- Explicit grant needed because "auto-expose new tables" is off on this project.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_rules TO service_role;

CREATE INDEX idx_pricing_rules_installation ON public.pricing_rules (installation_id);
