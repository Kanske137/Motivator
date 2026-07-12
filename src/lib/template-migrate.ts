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
import { DEFAULT_AI_STYLES } from "./ai-style-defaults";
import { legacyBuiltinRecipeId } from "./legacy-ai-recipe";
import type { MediaLayerAi } from "./ai-recipe";

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
    extraLayouts: [],
  };
}

/** Map a legacy aiPhoto layer's defaults onto a recipe binding. subjectKind (+
 *  simpleStyleMode) picks the built-in via the same routing the runtime resolver
 *  uses; references + motif carry over. removeBackground collapses to ONE recipe
 *  (its legacy per-style watercolor/backdrop auto-switch is replaced by the
 *  merchant choosing the recipe) — with no style selected it maps to the legacy
 *  DEFAULT (watercolor splatter); a merchant can switch to the backdrop recipe
 *  per template afterwards. */
export function legacyAiPhotoBinding(defaults: Record<string, unknown>): MediaLayerAi {
  const skRaw = defaults.subjectKind;
  const subjectKind =
    skRaw === "cat" || skRaw === "dog" || skRaw === "other"
      ? "pet"
      : skRaw === "pet" || skRaw === "removeBackground"
        ? skRaw
        : "human";
  // At migration there is no selected style, so the runtime resolver can't pick
  // the chain — map a simpleStyleMode removeBackground layer straight to the
  // art-style→cutout recipe it was.
  const recipeId =
    subjectKind === "removeBackground" && defaults.simpleStyleMode === true
      ? "builtin-style-cutout"
      : legacyBuiltinRecipeId({ subjectKind, simpleStyleMode: false, style: null });
  const refList = Array.isArray(defaults.referenceImages) ? defaults.referenceImages : [];
  const references = refList.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    url: String(r.url),
    label: typeof r.label === "string" ? r.label : undefined,
    orientation: (r.orientation as "portrait" | "landscape" | "any") ?? "any",
    focalX: typeof r.focalX === "number" ? r.focalX : undefined,
    focalY: typeof r.focalY === "number" ? r.focalY : undefined,
  }));
  if (references.length === 0 && typeof defaults.referenceImageUrl === "string") {
    references.push({ id: "legacy", url: defaults.referenceImageUrl, label: undefined, orientation: "any", focalX: undefined, focalY: undefined });
  }
  const motifRaw = defaults.fluxStylePrompt;
  const motif = typeof motifRaw === "string" && motifRaw.trim() ? motifRaw : undefined;
  return { recipeId, references, ...(motif ? { motif } : {}) };
}

/** Coerce legacy shape values silently to a supported one. aiPhoto→photo+recipe
 *  conversion happens pre-parse in `coerceLegacyRaw`, so nothing aiPhoto reaches
 *  here. */
function migrateLayer(layer: TemplateLayer): TemplateLayer {
  if (layer.type === "map") {
    const s = layer.defaults.shape as string;
    if (s !== "rect" && s !== "circle" && s !== "heart" && s !== "star") {
      return {
        ...layer,
        defaults: { ...layer.defaults, shape: "circle" },
      };
    }
  }
  return layer;
}

/** Pre-parse coercions for legacy fields that the Zod schema would now reject. */
function coerceLegacyRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const orients = ["portrait", "landscape"] as const;
  const root = raw as {
    defaultLayout?: Record<string, { layers?: Array<Record<string, unknown>> }>;
    canvasLayout?: Record<string, { layers?: Array<Record<string, unknown>> }>;
  };
  const blocks = [root?.defaultLayout, root?.canvasLayout].filter(Boolean) as Array<
    Record<string, { layers?: Array<Record<string, unknown>> }>
  >;
  for (const block of blocks) {
    for (const o of orients) {
      const layout = block?.[o];
      if (!layout?.layers) continue;
      for (const l of layout.layers) {
        // Backfill `move` lock on legacy layers (default = locked).
        const locks = (l.locks ?? {}) as Record<string, unknown>;
        if (typeof locks.move !== "boolean") {
          locks.move = true;
          l.locks = locks;
        }
        // Legacy margin: thicknessMm → thicknessPct (~5% of short side).
        if (l?.type === "margin") {
          const d = (l.defaults ?? {}) as Record<string, unknown>;
          if (d.thicknessPct == null) {
            d.thicknessPct = 5;
            delete d.thicknessMm;
            l.defaults = d;
          }
        }
        // Retire the aiPhoto type at read time: convert to a photo layer with an
        // `.ai` recipe binding BEFORE parse, so the schema no longer needs an
        // aiPhoto member. multiFace is gone, so this is unconditional.
        // legacyAiPhotoBinding handles subjectKind (incl. cat/dog/other → pet),
        // references (incl. the legacy referenceImageUrl fallback) and motif.
        if (l?.type === "aiPhoto") {
          const d = (l.defaults ?? {}) as Record<string, unknown>;
          l.type = "photo";
          l.defaults = {
            shape: typeof d.shape === "string" ? d.shape : "rect",
            fit: typeof d.fit === "string" ? d.fit : "cover",
            ...(typeof d.placeholderUrl === "string" ? { placeholderUrl: d.placeholderUrl } : {}),
            ai: legacyAiPhotoBinding(d),
          };
        }
      }
    }
  }
  return raw;
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

/**
 * Legacy canvasLayout used % of the FULL editor surface (front + 2× wrap).
 * The new model uses % of the FRONT zone so layer positions stay visually
 * stable across canvas sizes (wrap shrinks proportionally on larger sizes).
 *
 * For each orientation we figure out the front aspect from the first
 * allowedSize for canvas + designDepth, derive insetX/insetY, then remap
 * every layer rect from full-area to front-relative coords.
 */
function convertCanvasLayoutToFront(template: Template): NonNullable<Template["canvasLayout"]> {
  const cl = template.canvasLayout!;
  const opts = template.productOptions.canvas;
  const depthCm = (() => {
    const explicit = opts?.canvasDesignDepthCm;
    if (typeof explicit === "number" && explicit > 0) return explicit;
    const allowed = opts?.allowedDepths ?? [];
    for (const v of allowed) {
      const m = v.match(/(\d+(?:[.,]\d+)?)/);
      if (m) {
        const n = parseFloat(m[1].replace(",", "."));
        if (n > 0) return n;
      }
    }
    return 2;
  })();
  // Reference front size — first allowedSize, or 30x40 fallback.
  const refSize = (opts?.allowedSizes ?? [])[0] ?? "30x40";
  const m = refSize.match(/(\d+)\s*[xX×]\s*(\d+)/);
  const a = m ? parseInt(m[1], 10) : 30;
  const b = m ? parseInt(m[2], 10) : 40;

  const remap = (
    layout: OrientationLayout,
    orient: "portrait" | "landscape",
  ): OrientationLayout => {
    const frontW = orient === "portrait" ? Math.min(a, b) : Math.max(a, b);
    const frontH = orient === "portrait" ? Math.max(a, b) : Math.min(a, b);
    const fullW = frontW + 2 * depthCm;
    const fullH = frontH + 2 * depthCm;
    const insetX = depthCm / fullW;
    const insetY = depthCm / fullH;
    const sx = 1 - 2 * insetX;
    const sy = 1 - 2 * insetY;
    const layers = layout.layers.map((l) => {
      const newX = (l.xPct - insetX * 100) / sx;
      const newY = (l.yPct - insetY * 100) / sy;
      const newW = l.wPct / sx;
      const newH = l.hPct / sy;
      // Clamp to front zone — admins who deliberately placed decoration in
      // the wrap band will see those layers snapped to the edge; they can
      // adjust manually in the designer.
      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      const xPct = clamp(newX);
      const yPct = clamp(newY);
      const wPct = Math.max(0.5, Math.min(100 - xPct, newW));
      const hPct = Math.max(0.5, Math.min(100 - yPct, newH));
      return { ...l, xPct, yPct, wPct, hPct };
    });
    return { ...layout, layers };
  };

  return {
    portrait: remap(cl.portrait, "portrait"),
    landscape: remap(cl.landscape, "landscape"),
    coordSpace: "front",
  };
}


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
  // Same migration pass for the optional canvasLayout block.
  if (next.canvasLayout) {
    const cl = next.canvasLayout;
    const migrated = {
      portrait: { ...cl.portrait, layers: cl.portrait.layers.map(migrateLayer) },
      landscape: { ...cl.landscape, layers: cl.landscape.layers.map(migrateLayer) },
      coordSpace: cl.coordSpace,
    };
    next = { ...next, canvasLayout: migrated };
  }
  // Seed canvasLayout from defaultLayout when canvas is enabled but no
  // canvas-specific layout exists yet (legacy templates). Admin can then
  // edit it independently of the poster layout.
  if (next.productOptions.canvas?.enabled && !next.canvasLayout) {
    const cloned = JSON.parse(JSON.stringify(next.defaultLayout)) as {
      portrait: OrientationLayout;
      landscape: OrientationLayout;
    };
    next = {
      ...next,
      canvasLayout: { ...cloned, coordSpace: "front" },
    };
  }
  // One-time migration: convert legacy fullArea-relative canvasLayout coords
  // to FRONT-relative coords. After this the renderer always interprets %
  // as front-zone and adds wrap automatically.
  if (next.canvasLayout && next.canvasLayout.coordSpace !== "front") {
    next = { ...next, canvasLayout: convertCanvasLayoutToFront(next) };
  }
  // Seed default AI styles when none are configured (admin can edit/remove later).
  if (!next.productOptions.aiStyles || next.productOptions.aiStyles.length === 0) {
    next = {
      ...next,
      productOptions: { ...next.productOptions, aiStyles: [...DEFAULT_AI_STYLES] },
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
  // Coerce legacy fields (margin, aiPhoto subjectKind) before parsing.
  const preCoerced = coerceLegacyRaw(
    typeof rawTemplate === "object" ? JSON.parse(JSON.stringify(rawTemplate)) : rawTemplate,
  );
  const parsed = parseTemplate(preCoerced);
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
          if (s !== "rect" && s !== "circle" && s !== "heart" && s !== "star") l.defaults.shape = "circle";
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
export function buildPlaceText(
  args: {
    placeName?: string;
    city?: string;
    country?: string;
    center?: [number, number];
  },
  fields?: { city?: boolean; country?: boolean; coordinates?: boolean },
): string {
  const showCity = fields?.city ?? true;
  const showCountry = fields?.country ?? true;
  const showCoords = fields?.coordinates ?? true;
  const cityLine = showCity
    ? (args.city ?? args.placeName?.split(",")[0] ?? "").trim().toUpperCase()
    : "";
  const countryLine = showCountry ? (args.country?.trim() ?? "") : "";
  const coordLine =
    showCoords && args.center
      ? `${args.center[1].toFixed(3)}°N · ${args.center[0].toFixed(3)}°E`
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
  return layers.map((l) => {
    if (l.type !== "text") return l;
    if (l.defaults.linkedMapLayerId !== mapId) return l;
    const tokens =
      l.defaults.linkedTokens && l.defaults.linkedTokens.length > 0
        ? l.defaults.linkedTokens
        : (() => {
            const f = l.defaults.linkedMapFields;
            const out: Array<"city" | "country" | "coordinates"> = [];
            if (f?.city ?? true) out.push("city");
            if (f?.country ?? true) out.push("country");
            if (f?.coordinates ?? true) out.push("coordinates");
            return out;
          })();
    // If the admin authored a template with [[city]]/[[country]]/[[coords]]
    // placeholders, KEEP that template intact — only the runtime substitutes.
    const hasPlaceholder = /\[\[(city|country|coords?)\]\]/.test(l.defaults.text);
    const text = hasPlaceholder
      ? l.defaults.text
      : buildPlaceText(place, l.defaults.linkedMapFields);
    return { ...l, defaults: { ...l.defaults, text, linkedTokens: tokens } };
  });
}

// Re-export for convenience
export { defaultLocks };
