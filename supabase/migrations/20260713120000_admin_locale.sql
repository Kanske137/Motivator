-- Per-installation admin UI language. NULL = the app falls back to its default
-- (English). Written only via the session-token-guarded `admin-settings` edge
-- function (browser never writes the DB directly); read on admin bootstrap.
ALTER TABLE public.shopify_app_installations
  ADD COLUMN IF NOT EXISTS admin_locale text;
