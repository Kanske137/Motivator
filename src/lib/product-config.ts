import { supabase } from "@/integrations/supabase/client";

export type ProductType = "posters" | "canvas";
export type Orientation = "portrait" | "landscape";

export interface LayerDef {
  type: "map" | "text" | "image";
  x: string;
  y: string;
  w?: string;
  h?: string;
  align?: "left" | "center" | "right";
  maxChars?: number;
}

export interface LayoutDef {
  aspect: string; // e.g. "3:4"
  layers: LayerDef[];
}

export interface SizeVariant {
  name: string; // ram-namn (Ingen/Vit/Svart/Ek/Valnöt) eller djup (2cm/4cm)
  price: number;
}

export interface SizeDef {
  size: string; // "30x40"
  variants: SizeVariant[];
}

export interface TextConfig {
  fonts: string[];
  maxChars: number;
  defaultFont: string;
}

export interface ProductConfig {
  id: string;
  shopify_handle: string;
  /** Groups poster + canvas variants of the same template. Falls back to
   *  shopify_handle stripped of -poster/-canvas suffix. */
  template_slug?: string;
  title: string;
  product_type: ProductType;
  layouts: { portrait: LayoutDef; landscape: LayoutDef };
  map_styles: string[];
  text_config: TextConfig;
  sizes: SizeDef[];
  gelato_sku_map: Record<string, Record<string, string>>;
}

/** Strip -poster / -canvas suffix to get the template-grouping slug. */
export function deriveTemplateSlug(handleOrSlug: string): string {
  return handleOrSlug.replace(/-(poster|posters|canvas)$/i, "");
}

/** Resolve a config by either its real handle OR its template_slug. When
 *  given a slug, prefers the requested product type, falling back to the
 *  first match. */
export function resolveConfigForHandle(
  configs: ProductConfig[],
  handleOrSlug: string,
  preferredType?: ProductType,
): ProductConfig | null {
  const direct = configs.find((c) => c.shopify_handle === handleOrSlug);
  if (direct) return direct;
  const slug = deriveTemplateSlug(handleOrSlug);
  const matches = configs.filter(
    (c) => (c.template_slug ?? deriveTemplateSlug(c.shopify_handle)) === slug,
  );
  if (matches.length === 0) return null;
  if (preferredType) {
    const preferred = matches.find((c) => c.product_type === preferredType);
    if (preferred) return preferred;
  }
  return matches[0];
}

export async function loadConfig(handle: string): Promise<ProductConfig | null> {
  const { data, error } = await supabase
    .from("product_configs")
    .select("*")
    .eq("shopify_handle", handle)
    .maybeSingle();
  if (error) {
    console.error("loadConfig error", error);
    return null;
  }
  return data as unknown as ProductConfig | null;
}

export async function loadAllConfigs(): Promise<ProductConfig[]> {
  const { data, error } = await supabase
    .from("product_configs")
    .select("*")
    .order("created_at");
  if (error) {
    console.error("loadAllConfigs error", error);
    return [];
  }
  return (data ?? []) as unknown as ProductConfig[];
}

// Style metadata for UI
export const MAPBOX_STYLE_LABELS: Record<string, string> = {
  "light-v11": "Ljus",
  "dark-v11": "Mörk",
  "outdoors-v12": "Terräng",
  "satellite-v9": "Satellit",
  "streets-v12": "Gatukarta",
  "navigation-night-v1": "Natt",
};
