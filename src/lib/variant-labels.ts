// Maps internal Swedish variant names (used as IDs against Shopify, Gelato SKU
// mapping and pricing tables) to i18n keys. NEVER change the source names —
// only how they're displayed.
import type { TFunction } from "i18next";

const FRAME_KEY: Record<string, string> = {
  "ingen": "frame.none",
  "vit": "frame.white",
  "svart": "frame.black",
  "ek": "frame.oak",
  "valnöt": "frame.walnut",
  "valnot": "frame.walnut",
  "hängare ek": "frame.hangerOak",
  "hangare ek": "frame.hangerOak",
  "hängare valnöt": "frame.hangerWalnut",
  "hangare valnot": "frame.hangerWalnut",
  "hängare svart": "frame.hangerBlack",
  "hangare svart": "frame.hangerBlack",
  "hängare vit": "frame.hangerWhite",
  "hangare vit": "frame.hangerWhite",
};

/** Translate a variant name (frame, depth, material, finish) for display. */
export function translateVariantName(name: string | null | undefined, t: TFunction): string {
  if (!name) return "";
  const key = FRAME_KEY[name.toLowerCase().trim()];
  if (key) return t(key);
  // Canvas depth like "2 cm", "4 cm" → translate via "format.depthValue"
  const depth = name.match(/^\s*(\d+)\s*cm\s*$/i);
  if (depth) return t("format.depthValue", { cm: depth[1] });
  return name;
}
