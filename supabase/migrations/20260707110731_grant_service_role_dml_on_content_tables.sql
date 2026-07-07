-- Fix: service_role lacked DML grants on content/installation tables because
-- this project has "auto-expose new tables" off. service_role bypasses RLS but
-- still needs table-level privileges. Without this, every edge-function write
-- (oauth-callback install, admin-templates, sync) fails "permission denied".
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_app_installations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_configs           TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_sync_state        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gelato_orders             TO service_role;
