-- Per-installation Storefront API access token, so the shopify-storefront proxy
-- can fetch live (market-contextual) variant prices for EACH shop instead of a
-- single hardcoded token. Created lazily (via the Admin API) on first use and
-- cached here. Service-role only (this table is already locked down).
ALTER TABLE public.shopify_app_installations
  ADD COLUMN IF NOT EXISTS storefront_access_token text;
