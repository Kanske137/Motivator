import { supabase } from "@/integrations/supabase/client";

export type ProductType = "posters" | "canvas" | "aluminum" | "acrylic";
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

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

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
  /** Manuellt ifyllda Gelato product UIDs per `size` × `variant`.
   *  Värdet är antingen en sträng (samma UID för båda orientations — t.ex.
   *  fyrkantiga storlekar eller produkter som auto-roterar) eller ett objekt
   *  `{ portrait, landscape }` när orienteringen kräver olika SKU:er. */
  gelato_sku_map: Record<string, Record<string, string | { portrait?: string; landscape?: string }>>;
  // Shopify publishing metadata (Fas 3)
  tags?: string[];
  category_gid?: string | null;
  status?: ProductStatus;
  sales_channels?: string[];
  description_html?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
}

/** Strip -poster / -canvas / -aluminum / -acrylic suffix to get the
 *  template-grouping slug. */
export function deriveTemplateSlug(handleOrSlug: string): string {
  return handleOrSlug.replace(/-(poster|posters|canvas|aluminum|acrylic)$/i, "");
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
  // Stable default: posters before canvas so an ambiguous template-slug link
  // always lands on the poster variant.
  const poster = matches.find((c) => c.product_type === "posters");
  return poster ?? matches[0];
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

// ---- Effective sizes/variants helpers --------------------------------------
// When `config.sizes` is empty (new admin-built templates) we derive the size
// list from the template's productOptions × the static pricing tables. This
// gives the customer editor real sizes/prices without requiring the admin to
// duplicate pricing into the legacy `sizes` jsonb.
import {
  POSTER_PRICES,
  CANVAS_PRICES,
  ALUMINUM_PRICES,
  ACRYLIC_PRICES,
} from "@/lib/pricing";

interface ProductOptionsLike {
  poster?: { enabled?: boolean; allowedSizes?: string[]; allowedFrames?: string[] };
  canvas?: { enabled?: boolean; allowedSizes?: string[]; allowedDepths?: string[] };
  aluminum?: { enabled?: boolean; allowedSizes?: string[]; allowedMaterials?: string[] };
  acrylic?: { enabled?: boolean; allowedSizes?: string[]; allowedFinishes?: string[] };
}

/** Build a SizeDef[] for a config from its template's productOptions when
 *  the legacy `sizes` array is empty. Falls through to config.sizes otherwise.
 *  Variants/sizes that lack a price are skipped. */
export function getEffectiveSizes(
  config: Pick<ProductConfig, "product_type" | "sizes">,
  productOptions: ProductOptionsLike | null | undefined,
): SizeDef[] {
  if (config.sizes && config.sizes.length > 0) return config.sizes;
  if (!productOptions) return [];
  let sizes: string[] = [];
  let variantNames: string[] = [];
  let priceTable: Record<string, Record<string, number>> = {};
  if (config.product_type === "canvas") {
    const block = productOptions.canvas;
    if (!block?.enabled) return [];
    sizes = block.allowedSizes ?? [];
    variantNames = block.allowedDepths ?? [];
    priceTable = CANVAS_PRICES;
  } else if (config.product_type === "aluminum") {
    const block = productOptions.aluminum;
    if (!block?.enabled) return [];
    sizes = block.allowedSizes ?? [];
    variantNames = block.allowedMaterials ?? [];
    priceTable = ALUMINUM_PRICES;
  } else if (config.product_type === "acrylic") {
    const block = productOptions.acrylic;
    if (!block?.enabled) return [];
    sizes = block.allowedSizes ?? [];
    variantNames = block.allowedFinishes ?? [];
    priceTable = ACRYLIC_PRICES;
  } else {
    const block = productOptions.poster;
    if (!block?.enabled) return [];
    sizes = block.allowedSizes ?? [];
    variantNames = block.allowedFrames ?? [];
    priceTable = POSTER_PRICES;
  }
  const out: SizeDef[] = [];
  for (const size of sizes) {
    const variants: SizeVariant[] = [];
    for (const name of variantNames) {
      const price = priceTable[size]?.[name];
      if (typeof price === "number") variants.push({ name, price });
    }
    if (variants.length > 0) out.push({ size, variants });
  }
  return out;
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
