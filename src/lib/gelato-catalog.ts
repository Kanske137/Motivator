// Source-of-truth for available product variants per kind, derived from
// `gelato-sku-map.json`. Replaces the hardcoded DEFAULT_PRODUCT_VARIANTS so
// the admin always sees exactly the variants we have Gelato SKUs for.
import skuMapJson from "./gelato-sku-map.json";

type SkuMap = Record<string, Record<string, { portrait: string; landscape: string }>>;
const MAP = skuMapJson as SkuMap;

export type CatalogKind = "poster" | "canvas" | "aluminum" | "acrylic";

const KIND_TO_KEY: Record<CatalogKind, string> = {
  poster: "posters",
  canvas: "canvas",
  aluminum: "aluminum",
  acrylic: "acrylic",
};

// Preserve a sane sort order: numeric sizes ascending by first dimension.
function sortSizes(a: string, b: string): number {
  const na = parseInt(a.split("x")[0] ?? "0", 10);
  const nb = parseInt(b.split("x")[0] ?? "0", 10);
  return na - nb;
}

// Preferred frame/depth ordering — items not in this list keep insertion order at the end.
const FRAME_ORDER = ["Ingen", "Vit", "Svart", "Ek", "Valnöt"];
const DEPTH_ORDER = ["2cm", "4cm"];
const SINGLE_VARIANT_ORDER = ["Standard"];

function deriveSizesAndVariants(kind: CatalogKind): { sizes: string[]; variants: string[] } {
  const block = MAP[KIND_TO_KEY[kind]] ?? {};
  const sizeSet = new Set<string>();
  const variantSet = new Set<string>();
  for (const key of Object.keys(block)) {
    const [size, variant] = key.split("|");
    if (size) sizeSet.add(size);
    if (variant) variantSet.add(variant);
  }
  const sizes = [...sizeSet].sort(sortSizes);
  const order =
    kind === "poster" ? FRAME_ORDER
    : kind === "canvas" ? DEPTH_ORDER
    : SINGLE_VARIANT_ORDER;
  const variants = [...variantSet].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return { sizes, variants };
}

const POSTER = deriveSizesAndVariants("poster");
const CANVAS = deriveSizesAndVariants("canvas");
const ALUMINUM = deriveSizesAndVariants("aluminum");
const ACRYLIC = deriveSizesAndVariants("acrylic");

export function getPosterSizes(): string[] {
  return [...POSTER.sizes];
}
export function getPosterFrames(): string[] {
  return [...POSTER.variants];
}
export function getCanvasSizes(): string[] {
  return [...CANVAS.sizes];
}
export function getCanvasDepths(): string[] {
  return [...CANVAS.variants];
}
export function getAluminumSizes(): string[] {
  return [...ALUMINUM.sizes];
}
export function getAluminumMaterials(): string[] {
  return [...ALUMINUM.variants];
}
export function getAcrylicSizes(): string[] {
  return [...ACRYLIC.sizes];
}
export function getAcrylicFinishes(): string[] {
  return [...ACRYLIC.variants];
}

export function hasGelatoSku(kind: CatalogKind, size: string, variant: string): boolean {
  const block = MAP[KIND_TO_KEY[kind]] ?? {};
  const entry = block[`${size}|${variant}`];
  return Boolean(entry?.portrait || entry?.landscape);
}

export function getGelatoUid(
  kind: CatalogKind,
  size: string,
  variant: string,
  orientation: "portrait" | "landscape" = "portrait",
): string | null {
  const block = MAP[KIND_TO_KEY[kind]] ?? {};
  return block[`${size}|${variant}`]?.[orientation] ?? null;
}
