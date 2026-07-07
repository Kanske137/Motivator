-- Phase 2 — Tenant scoping + RLS lockdown
-- ---------------------------------------------------------------------------
-- 1. Add installation_id (FK -> shopify_app_installations) to the three content
--    tables so every content row is owned by exactly one Shopify install.
-- 2. Replace the global UNIQUE(shopify_handle) with UNIQUE(installation_id,
--    shopify_handle) so two merchants may reuse the same handle.
-- 3. Create a demo installation and attach the two seed product_configs to it.
-- 4. Drop the wide-open "TODO admin auth" write policies; deny all direct client
--    writes (edge functions use service_role, which bypasses RLS).
-- 5. Fix the storefront 401: this project has "auto-expose new tables" OFF, so
--    anon/authenticated hold no SELECT grant. Grant SELECT on product_configs and
--    tighten the read policy so the public only sees published (ACTIVE) templates.
--    shopify_sync_state and gelato_orders stay service-role-only.
-- ---------------------------------------------------------------------------

-- 1. installation_id columns + supporting indexes ---------------------------
ALTER TABLE public.product_configs
  ADD COLUMN IF NOT EXISTS installation_id uuid REFERENCES public.shopify_app_installations(id);
ALTER TABLE public.shopify_sync_state
  ADD COLUMN IF NOT EXISTS installation_id uuid REFERENCES public.shopify_app_installations(id);
ALTER TABLE public.gelato_orders
  ADD COLUMN IF NOT EXISTS installation_id uuid REFERENCES public.shopify_app_installations(id);

CREATE INDEX IF NOT EXISTS idx_product_configs_installation_id  ON public.product_configs (installation_id);
CREATE INDEX IF NOT EXISTS idx_shopify_sync_state_installation_id ON public.shopify_sync_state (installation_id);
CREATE INDEX IF NOT EXISTS idx_gelato_orders_installation_id     ON public.gelato_orders (installation_id);

-- 2. Demo installation + backfill seed rows ---------------------------------
--    Fixed UUID keeps this migration idempotent/re-runnable.
INSERT INTO public.shopify_app_installations (id, shop_domain, access_token, scopes, installed_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'motiv-demo.myshopify.com', 'DEMO-PLACEHOLDER-NO-TOKEN', '', now(), now())
ON CONFLICT (id) DO NOTHING;

UPDATE public.product_configs
   SET installation_id = '00000000-0000-0000-0000-000000000001'
 WHERE installation_id IS NULL;

-- 3. Swap global unique handle -> per-tenant unique handle -------------------
ALTER TABLE public.product_configs DROP CONSTRAINT IF EXISTS product_configs_shopify_handle_key;
ALTER TABLE public.product_configs
  ADD CONSTRAINT product_configs_installation_handle_key UNIQUE (installation_id, shopify_handle);

-- 4. Drop wide-open write/read policies -------------------------------------
DROP POLICY IF EXISTS "Anyone can insert product configs (TODO admin auth)" ON public.product_configs;
DROP POLICY IF EXISTS "Anyone can update product configs (TODO admin auth)" ON public.product_configs;
DROP POLICY IF EXISTS "Public can read product configs"                     ON public.product_configs;

DROP POLICY IF EXISTS "Anyone can insert sync state (TODO admin auth)" ON public.shopify_sync_state;
DROP POLICY IF EXISTS "Anyone can update sync state (TODO admin auth)" ON public.shopify_sync_state;
DROP POLICY IF EXISTS "Public can read sync state"                     ON public.shopify_sync_state;

-- 5. Locked-down policies + grants ------------------------------------------
-- product_configs: public may read ONLY published templates. No client writes
-- (no INSERT/UPDATE/DELETE policy => denied). Edge functions use service_role
-- (bypasses RLS) for all writes, scoped to their installation_id.
DROP POLICY IF EXISTS "Public can read active templates" ON public.product_configs;
CREATE POLICY "Public can read active templates"
  ON public.product_configs
  FOR SELECT
  TO anon, authenticated
  USING (status = 'ACTIVE');

-- Auto-expose is off: hand out the read grant the storefront needs.
GRANT SELECT ON public.product_configs TO anon, authenticated;

-- shopify_sync_state and gelato_orders remain fully service-role-only:
-- RLS on, no policies, no anon/authenticated grants. Belt-and-braces revoke in
-- case any grant lingers from an earlier state.
REVOKE ALL ON public.shopify_sync_state FROM anon, authenticated;
REVOKE ALL ON public.gelato_orders      FROM anon, authenticated;
