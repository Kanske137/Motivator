import skuMapJson from "./gelato-sku-map.json";
import type { ProductType, Orientation } from "./product-config";

type LocalMap = Record<string, Record<string, { portrait: string; landscape: string }>>;
const LOCAL: LocalMap = skuMapJson as LocalMap;

export type UidSource = "db" | "local-fallback" | "missing";

export interface ResolvedUid {
  productUid: string | null;
  source: UidSource;
  key: string;
}

export function resolveProductUid(args: {
  productType: ProductType;
  size: string;
  variant?: string | null;
  orientation: Orientation;
  dbMap?: Record<string, Record<string, string>> | null;
}): ResolvedUid {
  const { productType, size, variant, orientation, dbMap } = args;
  const key = `${size}|${variant ?? ""}`;

  // 1) DB-mapping
  if (variant && dbMap?.[size]?.[variant]) {
    return { productUid: dbMap[size][variant], source: "db", key };
  }

  // 2) Local fallback (exact size|variant)
  const localForType = LOCAL[productType] ?? {};
  if (variant && localForType[`${size}|${variant}`]?.[orientation]) {
    return {
      productUid: localForType[`${size}|${variant}`][orientation],
      source: "local-fallback",
      key,
    };
  }

  // 3) Any variant for the same size
  const sizeMatch = Object.entries(localForType).find(([k]) => k.startsWith(`${size}|`));
  if (sizeMatch && sizeMatch[1]?.[orientation]) {
    return {
      productUid: sizeMatch[1][orientation],
      source: "local-fallback",
      key: sizeMatch[0],
    };
  }

  return { productUid: null, source: "missing", key };
}
