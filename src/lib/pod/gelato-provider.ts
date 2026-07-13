// Gelato adapter (client). A thin facade that DELEGATES to the existing
// gelato-catalog / gelato helpers — no logic is duplicated, so behavior is
// byte-identical to the pre-refactor code. Later phases move the Gelato specifics
// (SKU-map, UID format) fully inside this module.
import {
  getPosterSizes,
  getPosterFrames,
  getCanvasSizes,
  getCanvasDepths,
  getAluminumSizes,
  getAluminumMaterials,
  getAcrylicSizes,
  getAcrylicFinishes,
  hasGelatoSku,
  getGelatoUid,
  type CatalogKind,
} from "../gelato-catalog";
import { resolveProductUid } from "../gelato";
import type { ProductType } from "../product-config";
import type { PodProductKind, PodProvider } from "./types";

const SIZE_GETTERS: Record<PodProductKind, () => string[]> = {
  poster: getPosterSizes,
  canvas: getCanvasSizes,
  aluminum: getAluminumSizes,
  acrylic: getAcrylicSizes,
};

const VARIANT_GETTERS: Record<PodProductKind, () => string[]> = {
  poster: getPosterFrames,
  canvas: getCanvasDepths,
  aluminum: getAluminumMaterials,
  acrylic: getAcrylicFinishes,
};

export const gelatoProvider: PodProvider = {
  id: "gelato",

  getKindSizes: (kind) => SIZE_GETTERS[kind](),
  getKindVariants: (kind) => VARIANT_GETTERS[kind](),
  hasSku: (kind, size, variant) => hasGelatoSku(kind as CatalogKind, size, variant),
  getSku: (kind, size, variant, orientation = "portrait") =>
    getGelatoUid(kind as CatalogKind, size, variant, orientation),

  resolveSku: ({ productType, size, variant, orientation, dbMap }) => {
    const r = resolveProductUid({
      productType: productType as ProductType,
      size,
      variant,
      orientation,
      dbMap,
    });
    return { sku: r.productUid, source: r.source, key: r.key };
  },
};
