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
  type TemplateLayer,
} from "./template-schema";

const DEFAULT_BG = "#EFE7D6";

function emptyOrientationLayout(aspect: "3:4" | "4:3" | "1:1"): OrientationLayout {
  return {
    aspect,
    background: { color: DEFAULT_BG },
    layers: [],
  };
}

export function buildTemplateFromLegacy(config: ProductConfig): Template {
  const allowedSizes = config.sizes.map((s) => s.size);
  const allVariantNames = Array.from(
    new Set(config.sizes.flatMap((s) => s.variants.map((v) => v.name))),
  );

  const productOptions: Template["productOptions"] = {};
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

/** Coerce legacy shape values silently to a supported one. */
function migrateLayer(layer: TemplateLayer): TemplateLayer {
  if (layer.type === "map") {
    const s = layer.defaults.shape as string;
    if (s !== "circle" && s !== "heart" && s !== "star") {
      return {
        ...layer,
        defaults: { ...layer.defaults, shape: "circle" },
      };
    }
  }
  return layer;
}

/** If exactly 1 map + 1 text and the text has no link → auto-link. */
function autoLinkSingleLayerTemplate(template: Template): Template {
  const orientations: Array<keyof Template["defaultLayout"]> = ["portrait", "landscape"];
  let next = template;
  for (const o of orientations) {
    const layout = next.defaultLayout[o];
    if (!layout) continue;
    const maps = layout.layers.filter((l) => l.type === "map");
    const texts = layout.layers.filter((l) => l.type === "text");
    if (maps.length !== 1 || texts.length !== 1) continue;
    const text = texts[0];
    if (text.type !== "text") continue;
    if (text.defaults.linkedMapLayerId) continue;
    const mapId = maps[0].id;
    const newLayers = layout.layers.map((l) =>
      l.id === text.id && l.type === "text"
        ? { ...l, defaults: { ...l.defaults, linkedMapLayerId: mapId } }
        : l,
    );
    next = {
      ...next,
      defaultLayout: {
        ...next.defaultLayout,
        [o]: { ...layout, layers: newLayers },
      },
    };
  }
  return next;
}

/** Walk every orientation and migrate each layer. */
function migrateTemplate(template: Template): Template {
  const orientations: Array<keyof Template["defaultLayout"]> = ["portrait", "landscape"];
  let next = template;
  for (const o of orientations) {
    const layout = next.defaultLayout[o];
    if (!layout) continue;
    const newLayers = layout.layers.map(migrateLayer);
    next = {
      ...next,
      defaultLayout: {
        ...next.defaultLayout,
        [o]: { ...layout, layers: newLayers },
      },
    };
  }
  return autoLinkSingleLayerTemplate(next);
}

export function resolveTemplate(
  config: ProductConfig,
  rawTemplate: unknown,
): { template: Template; fellBack: boolean } {
  if (isEmptyTemplate(rawTemplate)) {
    return { template: migrateTemplate(buildTemplateFromLegacy(config)), fellBack: true };
  }
  const parsed = parseTemplate(rawTemplate);
  if (parsed.ok === true) {
    return { template: migrateTemplate(parsed.template), fellBack: false };
  }
  // Try to coerce legacy shapes pre-parse so an old template with shape:"rect"
  // doesn't get rejected outright. Walk the raw structure manually.
  try {
    const coerced = JSON.parse(JSON.stringify(rawTemplate));
    const orients = ["portrait", "landscape"] as const;
    for (const o of orients) {
      const layout = coerced?.defaultLayout?.[o];
      if (!layout?.layers) continue;
      for (const l of layout.layers) {
        if (l?.type === "map" && l?.defaults?.shape) {
          const s = l.defaults.shape;
          if (s !== "circle" && s !== "heart" && s !== "star") l.defaults.shape = "circle";
        }
      }
    }
    const reparsed = parseTemplate(coerced);
    if (reparsed.ok === true) {
      return { template: migrateTemplate(reparsed.template), fellBack: false };
    }
  } catch {
    /* noop */
  }
  console.warn("[template-migrate] invalid template, falling back to legacy", parsed.error);
  return { template: migrateTemplate(buildTemplateFromLegacy(config)), fellBack: true };
}

// ---------- helpers exported for admin Designer ----------

/** Build the auto-text customer runtime uses for a place. */
export function buildPlaceText(args: {
  placeName?: string;
  city?: string;
  country?: string;
  center?: [number, number];
}): string {
  const cityLine = (args.city ?? args.placeName?.split(",")[0] ?? "").trim().toUpperCase();
  const countryLine = args.country?.trim() ?? "";
  const coordLine = args.center
    ? `${args.center[1].toFixed(4)}°N · ${args.center[0].toFixed(4)}°E`
    : "";
  return [cityLine, countryLine, coordLine].filter(Boolean).join("\n");
}

/**
 * In the admin Designer: when an admin picks a default place for a map layer,
 * propagate the auto-text format to every text layer linked to it.
 */
export function applyAdminPlaceToLinkedTexts(
  layers: TemplateLayer[],
  mapId: string,
  place: { placeName?: string; city?: string; country?: string; center: [number, number] },
): TemplateLayer[] {
  const text = buildPlaceText(place);
  return layers.map((l) => {
    if (l.type !== "text") return l;
    if (l.defaults.linkedMapLayerId !== mapId) return l;
    return { ...l, defaults: { ...l.defaults, text } };
  });
}

// Re-export for convenience
export { defaultLocks };
