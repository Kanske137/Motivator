-- Auto-pricing engine (retail = POD cost × markup).
--
-- Two pieces:
--  1. pod_costs  — a GLOBAL cache of each provider SKU's wholesale cost, so sync
--     never has to hit the provider's price API for every variant on every run.
--     Not tenant-scoped: a productUid's cost is the same catalog fact for everyone.
--  2. pricing_config — per-tenant markup settings: the target margin the merchant
--     wants and how computed prices are rounded. Explicit pricing_rules /
--     per-template overrides still win; this is the fallback that prices the long
--     tail of variants a merchant never hand-enters.

CREATE TABLE public.pod_costs (
  provider    text NOT NULL DEFAULT 'gelato',
  product_uid text NOT NULL,              -- the provider SKU (Gelato productUid)
  cost        numeric(10,2) NOT NULL CHECK (cost >= 0),
  currency    text NOT NULL,              -- the currency `cost` is expressed in
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, product_uid)
);

ALTER TABLE public.pod_costs ENABLE ROW LEVEL SECURITY;
-- Service-role-only. No public policies (edge functions read/write it).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pod_costs TO service_role;

CREATE TABLE public.pricing_config (
  installation_id uuid PRIMARY KEY REFERENCES public.shopify_app_installations(id) ON DELETE CASCADE,
  margin_pct      numeric(5,2) NOT NULL DEFAULT 60 CHECK (margin_pct >= 0 AND margin_pct < 100),
  rounding        text NOT NULL DEFAULT 'up9',   -- 'up9' | 'whole' | 'none'
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_config TO service_role;
