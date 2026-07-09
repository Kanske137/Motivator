-- Shop-level AI recipe library. A recipe is the reusable HOW (model + prompt +
-- params); the reference images that fill its slots stay per-template (the WHAT).
-- Built-in starter recipes live in code (src/lib/ai-recipe.ts) and are cloned
-- into this table when a merchant saves one.
CREATE TABLE public.ai_recipes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id  uuid NOT NULL REFERENCES public.shopify_app_installations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  model            text NOT NULL,            -- ModelId: face-swap / ai-edit / art-style / cutout
  prompt           text,                     -- merchant-authored; ignored by prompt-less models
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_options jsonb,                    -- CustomerOption[]
  steps            jsonb,                    -- RecipeStep[] (chained post-processing)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_recipes ENABLE ROW LEVEL SECURITY;
-- Service-role-only, reached through the session-token guard (admin-ai-recipes).
-- No public policies: the browser never touches this table directly.
-- Explicit grant needed because "auto-expose new tables" is off on this project.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_recipes TO service_role;

CREATE INDEX idx_ai_recipes_installation ON public.ai_recipes (installation_id);
