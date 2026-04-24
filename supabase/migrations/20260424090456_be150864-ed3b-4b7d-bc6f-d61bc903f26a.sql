CREATE TABLE public.shopify_app_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain text NOT NULL UNIQUE,
  access_token text NOT NULL,
  scopes text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shopify_app_installations ENABLE ROW LEVEL SECURITY;

-- No public policies — only service_role (used by edge functions) can access.
-- service_role bypasses RLS by design.

CREATE TRIGGER update_shopify_app_installations_updated_at
BEFORE UPDATE ON public.shopify_app_installations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_shopify_app_installations_shop_domain
  ON public.shopify_app_installations(shop_domain);