// Runtime translator from a legacy `ProductConfig` (layouts + sizes + map_styles
// + text_config) into a minimal valid `Template`. The DB migration already
// backfilled existing rows, but this helper is the single source of truth for
// any row that was inserted before migration ran or where `template = '{}'`.
import type { ProductConfig } from "./product-config";
import {
  defaultLocks,
  isEmptyTemplate,
  parseTemplate,
  type OrientationLayout,
  type Template,
} from "./template-schema";

const DEFAULT_BG = "#EFE7D6";

function emptyOrientationLayout(aspect: "3:4" | "4:3" | "1:1"): OrientationLayout {
  return {
    aspect,
    background: { color: DEFAULT_BG },
    layers: [],
  };
}

/**
 * Build a default template that mirrors what the legacy config supports.
 * - `productOptions` enables only the row's own product_type
 * - `allowedSizes` = every size in config.sizes
 * - `allowedFrames` / `allowedDepths` = every variant name across sizes
 * - layouts are empty (admin must add layers in the designer)
 */
export function buildTemplateFromLegacy(config: ProductConfig): Template {
  const allowedSizes = config.sizes.map((s) => s.size);
  const allVariantNames = Array.from(
    new Set(config.sizes.flatMap((s) => s.variants.map((v) => v.name))),
  );

  const productOptions: Template["productOptions"] = {};
  // Legacy `product_type` is "posters" | "canvas"; template uses "poster" | "canvas"
  if ((config.product_type as string) === "posters" || (config.product_type as string) === "poster") {
    productOptions.poster = {
      enabled: true,
      allowedSizes,
      allowedFrames: allVariantNames,
    };
  } else {
    productOptions.canvas = {
      enabled: true,
      allowedSizes,
      allowedDepths: allVariantNames,
    };
  }

  const portraitAspect = (config.layouts?.portrait?.aspect as "3:4" | "4:3" | "1:1") ?? "3:4";
  const landscapeAspect = (config.layouts?.landscape?.aspect as "3:4" | "4:3" | "1:1") ?? "4:3";

  return {
    version: 1,
    publishedAt: null,
    productOptions,
    orientations: ["portrait", "landscape"],
    defaultLayout: {
      portrait: emptyOrientationLayout(portraitAspect),
      landscape: emptyOrientationLayout(landscapeAspect),
    },
    sizeOverrides: {},
  };
}

/**
 * Resolve the active template for a config. If the row's `template` jsonb is
 * empty/invalid, fall back to a freshly built one from the legacy fields so
 * downstream code can always assume a typed template.
 */
export function resolveTemplate(
  config: ProductConfig,
  rawTemplate: unknown,
): { template: Template; fellBack: boolean } {
  if (isEmptyTemplate(rawTemplate)) {
    return { template: buildTemplateFromLegacy(config), fellBack: true };
  }
  const parsed = parseTemplate(rawTemplate);
  if (parsed.ok === true) {
    return { template: parsed.template, fellBack: false };
  }
  console.warn("[template-migrate] invalid template, falling back to legacy", parsed.error);
  return { template: buildTemplateFromLegacy(config), fellBack: true };
}

// Re-export for convenience
export { defaultLocks };
