-- Phase 3a — provider-neutral data model (rename the Gelato-specific names)
-- ---------------------------------------------------------------------------
-- Generalizes the POD data layer so adding Printful/Printify becomes "register
-- another adapter" instead of "add more gelato_* columns":
--   * gelato_orders                  -> pod_orders  (+ provider, + provider_order_id)
--   * gelato_orders.gelato_order_id  -> provider_order_id
--   * product_configs.gelato_sku_map -> variant_map
--
-- Existing rows are all Gelato, so `provider` defaults to 'gelato' (later phases
-- set it explicitly per row when a Shopify order spans providers).
--
-- COORDINATED DEPLOY REQUIRED. Renaming a live table/column breaks any edge
-- function still reading the OLD names. Apply this migration and redeploy ALL
-- functions that touch these tables in the SAME window:
--   shopify-order-webhook, gelato-webhook, gelato-backfill, admin-templates.
-- The matching code changes ship in the same commit as this file.
-- ---------------------------------------------------------------------------

-- 1. Table + column renames. Data, PK/FK/unique constraints, RLS state and
--    grants all follow the table automatically; only their internal NAMES keep
--    the old prefix (cosmetic, never referenced by the app).
ALTER TABLE public.gelato_orders RENAME TO pod_orders;

ALTER TABLE public.pod_orders RENAME COLUMN gelato_order_id TO provider_order_id;

ALTER TABLE public.pod_orders
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'gelato';

ALTER TABLE public.product_configs RENAME COLUMN gelato_sku_map TO variant_map;

-- 2. Rename the dependent indexes + trigger so their names match the new table
--    (purely cosmetic — Postgres keeps them working under the old names).
ALTER INDEX IF EXISTS idx_gelato_orders_status           RENAME TO idx_pod_orders_status;
ALTER INDEX IF EXISTS idx_gelato_orders_created_at       RENAME TO idx_pod_orders_created_at;
ALTER INDEX IF EXISTS idx_gelato_orders_installation_id  RENAME TO idx_pod_orders_installation_id;
ALTER INDEX IF EXISTS gelato_orders_gelato_order_id_idx  RENAME TO pod_orders_provider_order_id_idx;
ALTER INDEX IF EXISTS gelato_orders_shopify_order_id_idx RENAME TO pod_orders_shopify_order_id_idx;

ALTER TRIGGER update_gelato_orders_updated_at ON public.pod_orders
  RENAME TO update_pod_orders_updated_at;

-- 3. Index for the multi-provider era (filter/split orders by provider).
CREATE INDEX IF NOT EXISTS idx_pod_orders_provider ON public.pod_orders (provider);

-- 4. Re-assert the service-role-only posture. RLS + grants survive the rename;
--    restated here so the renamed table's security is self-documenting.
ALTER TABLE public.pod_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pod_orders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pod_orders TO service_role;
