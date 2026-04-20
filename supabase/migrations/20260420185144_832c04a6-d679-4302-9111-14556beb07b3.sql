-- Create product_configs table for dynamic, config-driven editor
CREATE TABLE public.product_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_handle text UNIQUE NOT NULL,
  title text NOT NULL,
  product_type text NOT NULL,
  layouts jsonb NOT NULL DEFAULT '{}'::jsonb,
  map_styles jsonb NOT NULL DEFAULT '[]'::jsonb,
  text_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  gelato_sku_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read product configs"
  ON public.product_configs FOR SELECT
  USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_product_configs_updated_at
  BEFORE UPDATE ON public.product_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed: Poster config
INSERT INTO public.product_configs (shopify_handle, title, product_type, layouts, map_styles, text_config, sizes, gelato_sku_map)
VALUES (
  'personlig-karta-poster',
  'Personlig Karta - Poster',
  'posters',
  '{
    "portrait": {
      "aspect": "3:4",
      "layers": [
        {"type": "map", "x": "5%", "y": "5%", "w": "90%", "h": "75%"},
        {"type": "text", "x": "50%", "y": "87%", "align": "center", "maxChars": 60}
      ]
    },
    "landscape": {
      "aspect": "4:3",
      "layers": [
        {"type": "map", "x": "5%", "y": "5%", "w": "90%", "h": "75%"},
        {"type": "text", "x": "50%", "y": "87%", "align": "center", "maxChars": 60}
      ]
    }
  }'::jsonb,
  '["light-v11", "dark-v11", "outdoors-v12", "satellite-v9", "streets-v12", "navigation-night-v1"]'::jsonb,
  '{"fonts": ["Inter", "Playfair Display", "Montserrat"], "maxChars": 60, "defaultFont": "Inter"}'::jsonb,
  '[
    {"size": "13x18", "variants": [{"name": "Ingen", "price": 199}, {"name": "Vit", "price": 349}, {"name": "Svart", "price": 349}, {"name": "Ek", "price": 369}, {"name": "Valnöt", "price": 369}]},
    {"size": "21x30", "variants": [{"name": "Ingen", "price": 239}, {"name": "Vit", "price": 399}, {"name": "Svart", "price": 399}, {"name": "Ek", "price": 429}, {"name": "Valnöt", "price": 429}]},
    {"size": "30x40", "variants": [{"name": "Ingen", "price": 259}, {"name": "Vit", "price": 559}, {"name": "Svart", "price": 559}, {"name": "Ek", "price": 589}, {"name": "Valnöt", "price": 589}]},
    {"size": "40x50", "variants": [{"name": "Ingen", "price": 289}, {"name": "Vit", "price": 749}, {"name": "Svart", "price": 749}, {"name": "Ek", "price": 789}, {"name": "Valnöt", "price": 789}]},
    {"size": "50x70", "variants": [{"name": "Ingen", "price": 329}, {"name": "Vit", "price": 919}, {"name": "Svart", "price": 919}, {"name": "Ek", "price": 969}, {"name": "Valnöt", "price": 969}]},
    {"size": "70x100", "variants": [{"name": "Ingen", "price": 429}, {"name": "Vit", "price": 1249}, {"name": "Svart", "price": 1249}, {"name": "Ek", "price": 1299}, {"name": "Valnöt", "price": 1299}]}
  ]'::jsonb,
  '{}'::jsonb
);

-- Seed: Canvas config
INSERT INTO public.product_configs (shopify_handle, title, product_type, layouts, map_styles, text_config, sizes, gelato_sku_map)
VALUES (
  'personlig-karta-canvas',
  'Personlig Karta - Canvas',
  'canvas',
  '{
    "portrait": {
      "aspect": "3:4",
      "layers": [
        {"type": "map", "x": "0%", "y": "0%", "w": "100%", "h": "82%"},
        {"type": "text", "x": "50%", "y": "90%", "align": "center", "maxChars": 60}
      ]
    },
    "landscape": {
      "aspect": "4:3",
      "layers": [
        {"type": "map", "x": "0%", "y": "0%", "w": "100%", "h": "82%"},
        {"type": "text", "x": "50%", "y": "90%", "align": "center", "maxChars": 60}
      ]
    }
  }'::jsonb,
  '["light-v11", "dark-v11", "outdoors-v12", "satellite-v9", "streets-v12", "navigation-night-v1"]'::jsonb,
  '{"fonts": ["Inter", "Playfair Display", "Montserrat"], "maxChars": 60, "defaultFont": "Inter"}'::jsonb,
  '[
    {"size": "20x25", "variants": [{"name": "2cm", "price": 299}, {"name": "4cm", "price": 319}]},
    {"size": "20x30", "variants": [{"name": "2cm", "price": 349}, {"name": "4cm", "price": 379}]},
    {"size": "30x40", "variants": [{"name": "2cm", "price": 449}, {"name": "4cm", "price": 489}]},
    {"size": "40x50", "variants": [{"name": "2cm", "price": 599}, {"name": "4cm", "price": 649}]},
    {"size": "40x60", "variants": [{"name": "2cm", "price": 699}, {"name": "4cm", "price": 759}]},
    {"size": "50x70", "variants": [{"name": "2cm", "price": 799}, {"name": "4cm", "price": 869}]},
    {"size": "60x80", "variants": [{"name": "2cm", "price": 999}, {"name": "4cm", "price": 1099}]},
    {"size": "70x100", "variants": [{"name": "2cm", "price": 1299}, {"name": "4cm", "price": 1399}]}
  ]'::jsonb,
  '{}'::jsonb
);