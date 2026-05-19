import { supabase } from "@/integrations/supabase/client";

export type ProductType = "posters" | "canvas" | "aluminum" | "acrylic";
/** DB-värdet för konsoliderade mallar — en rad per mall som hanterar
 *  flera produkttyper i samma Shopify-produkt. Använd `expandConsolidatedConfig()`
 *  innan andra delar av koden använder configs så `product_type` alltid är en
 *  konkret typ. */
export type StoredProductType = ProductType | "multi";
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
  /** False = visa varianten i UI men gråa ut (saknar Gelato-SKU för storleken). */
  available?: boolean;
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
  gelato_sku_map: Record<string, Record<string, string>>;
  // Shopify publishing metadata (Fas 3)
  tags?: string[];
  category_gid?: string | null;
  status?: ProductStatus;
  sales_channels?: string[];
  description_html?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  /** True om denna rad representerar en konsoliderad mall (en Shopify-produkt
   *  med flera produkttyper som varianter). När true används
   *  `enabled_product_types` istället för `product_type`. */
  is_consolidated?: boolean;
  /** Vilka produkttyper mallen säljer. Tomt för icke-konsoliderade mallar. */
  enabled_product_types?: ProductType[];
}

/** Mappar legacy "kind"-strängar (poster/posters/canvas/...) till `ProductType`. */
export function kindToProductType(kind: string): ProductType {
  const k = kind.toLowerCase();
  if (k === "canvas") return "canvas";
  if (k === "aluminum" || k === "metallic") return "aluminum";
  if (k === "acrylic" || k === "akryl") return "acrylic";
  return "posters";
}

/** Expandera en konsoliderad rad till N "virtuella" configs (en per
 *  enabled_product_type) så befintlig kod som filtrerar configs på
 *  template_slug fungerar oförändrat. Icke-konsoliderade rader returneras
 *  oförändrade. Alla virtuella rader delar samma `id` och `shopify_handle`. */
export function expandConsolidatedConfig(row: ProductConfig): ProductConfig[] {
  if (!row.is_consolidated) return [row];
  const types = row.enabled_product_types ?? [];
  if (types.length === 0) return [row];
  return types.map((pt) => ({
    ...row,
    product_type: pt,
    template_slug: row.template_slug ?? row.shopify_handle,
  }));
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
  // Vid konsoliderade mallar finns flera virtuella configs med samma handle —
  // matcha först på handle + preferredType, annars första handle-träffen.
  if (preferredType) {
    const directTyped = configs.find(
      (c) => c.shopify_handle === handleOrSlug && c.product_type === preferredType,
    );
    if (directTyped) return directTyped;
  }
  const direct = configs.find((c) => c.shopify_handle === handleOrSlug);
  if (direct && !preferredType) return direct;
  if (direct && configs.filter((c) => c.shopify_handle === handleOrSlug).length === 1) return direct;
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
  // Expandera konsoliderade rader till virtuella per-produkttyp-configs så att
  // FormatSection / EditorPage kan filtrera per `template_slug` precis som
  // tidigare. Den underliggande raden bevaras med samma id.
  const out: ProductConfig[] = [];
  for (const row of (data ?? []) as unknown as ProductConfig[]) {
    out.push(...expandConsolidatedConfig(row));
  }
  return out;
}

/** Ladda RAW-rader (utan att expandera konsoliderade). Används av admin/
 *  designer-sidor som behöver läsa själva DB-raden inkl. is_consolidated. */
export async function loadAllConfigsRaw(): Promise<ProductConfig[]> {
  const { data, error } = await supabase
    .from("product_configs")
    .select("*")
    .order("created_at");
  if (error) {
    console.error("loadAllConfigsRaw error", error);
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
  const isPoster = config.product_type === "posters";
  const out: SizeDef[] = [];
  for (const size of sizes) {
    const variants: SizeVariant[] = [];
    for (const name of variantNames) {
      const price = priceTable[size]?.[name];
      if (typeof price === "number") {
        variants.push({ name, price, available: true });
      } else if (isPoster && /^Hängare/i.test(name)) {
        // Hängare visas alltid i UI, även för storlekar där Gelato saknar SKU
        // (t.ex. 13×18). Markeras som otillgänglig så UI kan gråa ut.
        variants.push({ name, price: 0, available: false });
      }
    }
    if (variants.length > 0) out.push({ size, variants });
  }
  return out;
}

// Style metadata for UI
export const MAPBOX_STYLE_LABELS: Record<string, string> = {
  "light-v11": "Ljus",
  "dark-v11": "Mörk",
  "outdoors-v12": "Mintgrön/Salvia",
  "satellite-v9": "Marin Blå",
  "streets-v12": "Varm Beige/Cream",
  "navigation-night-v1": "Djup Skogsgrön/Svart",
};
