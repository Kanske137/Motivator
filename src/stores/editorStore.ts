import { create } from "zustand";
import type { Orientation, ProductConfig } from "@/lib/product-config";
import { getEffectiveSizes } from "@/lib/product-config";
import type { DesignSource } from "@/lib/print-pipeline";
import type { ProductOptions, Template, TemplateLayer } from "@/lib/template-schema";
import { getActiveLayoutBlock } from "@/lib/template-schema";
import { resolveTemplate } from "@/lib/template-migrate";
import { clampLayerRect } from "@/lib/layer-utils";
import {
  type AiCacheEntry,
  loadAiCache,
  makeCacheKey,
  saveAiCache,
} from "@/lib/ai-cache-storage";
import {
  type FaceSwapCacheEntry,
  loadFaceSwapCache,
  makeFaceSwapKey,
  saveFaceSwapCache,
} from "@/lib/face-swap-cache";

interface ApplyPlaceArgs {
  placeName: string;
  center: [number, number];
  city?: string;
  country?: string;
}

export type MapShape = "rect" | "circle" | "heart" | "star";

export interface MapLayerValue {
  kind: "map";
  center: [number, number];
  zoom: number;
  styleId: string;
  shape: MapShape;
  showLabels: boolean;
  placeName: string;
  city?: string;
  country?: string;
}

export interface TextLayerValue {
  kind: "text";
  text: string;
  font: string;
  visible: boolean;
  isCustom: boolean;
}

export type PhotoShape = "rect" | "circle" | "heart" | "star";

export interface PhotoLayerValue {
  kind: "photo";
  shape: PhotoShape;
  /** Pan offset within the layer's frame, in percent of layer width/height.
   *  Range clamped to [-50, 50]. 0,0 = centered cover crop. */
  offsetX: number;
  offsetY: number;
}

export interface AiPhotoLayerValue {
  kind: "aiPhoto";
  shape: PhotoShape;
  offsetX: number;
  offsetY: number;
}

export type LayerValue = MapLayerValue | TextLayerValue | PhotoLayerValue | AiPhotoLayerValue;

/** Per-aiPhoto-layer customer state. The customer's selfie/pet photo lives
 *  here keyed by layer id, so multiple aiPhoto layers in one template are
 *  independent. */
export interface AiPhotoSource {
  file: File;
  previewUrl: string;
  /** SHA-256 of the file bytes; lazy-computed by AiPhotoSection. */
  hash: string | null;
  /** Public URL after lazy upload to cart-previews (so Replicate can fetch). */
  uploadedUrl: string | null;
}

interface EditorState {
  config: ProductConfig | null;
  template: Template | null;
  productOptions: ProductOptions | null;

  // Per-layer values keyed by layer id (covers map + text layers).
  layerValues: Record<string, LayerValue>;

  // Customer-driven rect overrides for layers (when locks.size or locks.move
  // are unlocked). All values in % of editor canvas. Missing fields fall
  // back to the template layer's xPct/yPct/wPct/hPct.
  layerTransforms: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }>;

  // Global background (one per layout). Other map/text values now live in
  // `layerValues`; the fields below are derived getters for legacy callers.
  /** Customer toggle: when false, the white margin layer is hidden and all
   *  other layers expand to fill the freed-up area. Default true. */
  whiteMarginEnabled: boolean;
  posterBgColor: string;

  // format
  size: string | null;
  variant: string | null;
  orientation: Orientation;

  // print-pipeline source
  designSource: DesignSource;
  photoFile: File | null;
  photoPreviewUrl: string | null;
  /** Public URL of the original photo (uploaded to cart-previews lazily) so
   *  Replicate can fetch it for AI styles. Cached so we don't re-upload. */
  originalPhotoUrl: string | null;
  /** SHA-256 of the uploaded photo's bytes. Stable across re-uploads and
   *  page reloads → used as the cache key for AI results. */
  photoHash: string | null;
  aiPrintFileUrl: string | null;
  /** Real Shopify variant GID (e.g. gid://shopify/ProductVariant/123). Resolved
   *  lazily based on (handle, size, variant). Null while resolving / not found. */
  shopifyVariantId: string | null;
  shopifyVariantResolving: boolean;

  /** AI-styled image cache keyed by `${photoHash}|${presetId}`. Avoids repeat
   *  Replicate calls when the customer revisits a style they already tried.
   *  Persisted to localStorage with LRU eviction. */
  aiResultCache: Record<string, AiCacheEntry>;

  /** Customer-uploaded face photos per aiPhoto layer. */
  aiPhotoSources: Record<string, AiPhotoSource>;
  /** Face-swap result URLs per aiPhoto layer (current selection only). */
  aiPhotoResults: Record<string, string>;
  /** Persistent face-swap cache keyed by `${faceHash}|${refUrl}|${layerId}`. */
  faceSwapCache: Record<string, FaceSwapCacheEntry>;

  // ---------- setters ----------
  setConfig: (c: ProductConfig) => void;
  setPosterBgColor: (c: string) => void;
  setSize: (s: string) => void;
  setVariant: (v: string) => void;
  setOrientation: (o: Orientation) => void;
  setWhiteMarginEnabled: (v: boolean) => void;
  setLayerTransform: (id: string, patch: { xPct?: number; yPct?: number; wPct?: number; hPct?: number }) => void;
  resetLayerTransform: (id: string) => void;
  setPhotoSource: (file: File | null, previewUrl: string | null) => void;
  setOriginalPhotoUrl: (url: string | null) => void;
  setPhotoHash: (hash: string | null) => void;
  setAiPrintFileUrl: (url: string | null) => void;
  /** Drops only the AI-styled result, keeps the original photo + hash + URL
   *  intact so the history list stays visible and re-applying a style is
   *  a cache hit. */
  clearAiResultOnly: () => void;
  resetDesignSource: () => void;
  setShopifyVariantId: (id: string | null) => void;
  setShopifyVariantResolving: (resolving: boolean) => void;

  // ---------- AI cache ----------
  addAiResultToCache: (photoHash: string, presetId: string, presetLabel: string, url: string) => void;
  getCachedAiResult: (photoHash: string, presetId: string) => string | null;
  listAiResultsForPhoto: (photoHash: string) => AiCacheEntry[];
  clearAiResult: (photoHash: string, presetId: string) => void;

  // ---------- aiPhoto (face-swap) ----------
  setAiPhotoSource: (layerId: string, file: File | null, previewUrl: string | null) => void;
  setAiPhotoHash: (layerId: string, hash: string) => void;
  setAiPhotoUploadedUrl: (layerId: string, url: string) => void;
  setAiPhotoResult: (layerId: string, url: string | null) => void;
  clearAiPhoto: (layerId: string) => void;
  addFaceSwapToCache: (
    layerId: string,
    faceHash: string,
    referenceImageUrl: string,
    url: string,
  ) => void;
  getCachedFaceSwap: (
    layerId: string,
    faceHash: string,
    referenceImageUrl: string,
  ) => string | null;

  // Per-layer setters
  setLayerMapCenter: (id: string, c: [number, number]) => void;
  setLayerMapZoom: (id: string, z: number) => void;
  setLayerMapStyle: (id: string, s: string) => void;
  setLayerMapShape: (id: string, s: MapShape) => void;
  setLayerShowLabels: (id: string, v: boolean) => void;
  applyPlaceToLayer: (id: string, args: ApplyPlaceArgs) => void;
  updateMapLayerFromPan: (id: string, args: ApplyPlaceArgs) => void;
  setLayerText: (id: string, t: string) => void;
  setLayerTextFont: (id: string, f: string) => void;
  setLayerTextVisible: (id: string, v: boolean) => void;
  setLayerPhotoShape: (id: string, s: PhotoShape) => void;
  setLayerPhotoOffset: (id: string, x: number, y: number) => void;

  // ---------- legacy globals (derived getters; mutators apply to first layer) ----------
  // These setters/getters keep older code (EditorPage cart payload, snapshot
  // pipeline, etc.) working unchanged while we migrate to per-layer everywhere.
  setMapCenter: (c: [number, number]) => void;
  setMapZoom: (z: number) => void;
  setMapStyleId: (s: string) => void;
  setShowLabels: (v: boolean) => void;
  setMapShape: (s: MapShape) => void;
  setText: (t: string) => void;
  setTextFont: (f: string) => void;
  setTextVisible: (v: boolean) => void;
  applyPlace: (args: ApplyPlaceArgs) => void;
  updateFromMap: (args: ApplyPlaceArgs) => void;

  // computed
  currentPrice: () => number;
  currentLayout: () => ProductConfig["layouts"]["portrait"] | null;
  templateLayers: () => TemplateLayer[];
  firstMapLayerId: () => string | null;
  firstTextLayerId: () => string | null;
  getMapValue: (id: string) => MapLayerValue | null;
  getTextValue: (id: string) => TextLayerValue | null;
  // Legacy mirrors of "first map / first text" for backward compat reads.
  mapCenter: [number, number];
  mapZoom: number;
  mapStyleId: string;
  mapShape: MapShape;
  showLabels: boolean;
  placeName: string;
  city?: string;
  country?: string;
  text: string;
  textFont: string;
  textVisible: boolean;
}

interface AutoTextFields {
  city?: boolean;
  country?: boolean;
  coordinates?: boolean;
}

function buildAutoText(args: ApplyPlaceArgs, fields?: AutoTextFields): string {
  const showCity = fields?.city ?? true;
  const showCountry = fields?.country ?? true;
  const showCoords = fields?.coordinates ?? true;
  const [lng, lat] = args.center;
  const cityLine = showCity
    ? (args.city ?? args.placeName.split(",")[0] ?? "").trim().toUpperCase()
    : "";
  const countryLine = showCountry ? (args.country?.trim() ?? "") : "";
  const coordLine = showCoords ? `${lat.toFixed(4)}°N · ${lng.toFixed(4)}°E` : "";
  return [cityLine, countryLine, coordLine].filter(Boolean).join("\n");
}


function hydrateLayerValues(
  template: Template,
  orientation: Orientation,
  productType: string | null | undefined,
): Record<string, LayerValue> {
  const layout = getActiveLayoutBlock(template, productType)[orientation];
  const out: Record<string, LayerValue> = {};
  if (!layout) return out;
  for (const l of layout.layers) {
    if (l.type === "map") {
      out[l.id] = {
        kind: "map",
        center: [l.defaults.center[0], l.defaults.center[1]],
        zoom: l.defaults.zoom,
        styleId: l.defaults.styleId,
        shape: l.defaults.shape as MapShape,
        showLabels: l.defaults.showLabels,
        placeName: l.defaults.placeName ?? "",
        city: l.defaults.city,
        country: l.defaults.country,
      };
    } else if (l.type === "text") {
      out[l.id] = {
        kind: "text",
        text: l.defaults.text,
        font: l.defaults.font,
        visible: true,
        isCustom: false,
      };
    } else if (l.type === "photo") {
      out[l.id] = {
        kind: "photo",
        shape: l.defaults.shape as PhotoShape,
        offsetX: 0,
        offsetY: 0,
      };
    } else if (l.type === "aiPhoto") {
      out[l.id] = {
        kind: "aiPhoto",
        shape: l.defaults.shape as PhotoShape,
        offsetX: 0,
        offsetY: 0,
      };
    }
  }
  return out;
}

/** Recompute legacy "first map / first text" mirrors from layerValues. */
function mirrorLegacy(
  state: Pick<EditorState, "template" | "orientation" | "layerValues" | "config">,
) {
  const layout = state.template
    ? getActiveLayoutBlock(state.template, state.config?.product_type)[state.orientation]
    : undefined;
  const firstMap = layout?.layers.find((l) => l.type === "map");
  const firstText = layout?.layers.find((l) => l.type === "text");
  const m = firstMap ? (state.layerValues[firstMap.id] as MapLayerValue | undefined) : undefined;
  const t = firstText ? (state.layerValues[firstText.id] as TextLayerValue | undefined) : undefined;
  return {
    mapCenter: m?.center ?? ([18.0686, 59.3293] as [number, number]),
    mapZoom: m?.zoom ?? 12,
    mapStyleId: m?.styleId ?? "light-v11",
    mapShape: m?.shape ?? ("circle" as MapShape),
    showLabels: m?.showLabels ?? false,
    placeName: m?.placeName ?? "",
    city: m?.city,
    country: m?.country,
    text: t?.text ?? "",
    textFont: t?.font ?? "Inter",
    textVisible: t?.visible ?? true,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  config: null,
  template: null,
  productOptions: null,
  layerValues: {},
  layerTransforms: {},
  posterBgColor: "#EFE7D6",
  whiteMarginEnabled: true,

  size: null,
  variant: null,
  orientation: "portrait",

  designSource: "map",
  photoFile: null,
  photoPreviewUrl: null,
  originalPhotoUrl: null,
  photoHash: null,
  aiPrintFileUrl: null,
  shopifyVariantId: null,
  shopifyVariantResolving: false,
  aiResultCache: loadAiCache(),
  aiPhotoSources: {},
  aiPhotoResults: {},
  faceSwapCache: loadFaceSwapCache(),

  // legacy mirrors (initial values, replaced once a config is loaded)
  mapCenter: [18.0686, 59.3293],
  mapZoom: 12,
  mapStyleId: "light-v11",
  mapShape: "circle",
  showLabels: false,
  placeName: "",
  city: undefined,
  country: undefined,
  text: "",
  textFont: "Inter",
  textVisible: true,

  setConfig: (config) => {
    const state = get();
    const prevSize = state.size;
    const prevVariant = state.variant;

    const rawTemplate = (config as unknown as { template?: unknown }).template;
    const { template } = resolveTemplate(config, rawTemplate);
    const productOptions = template.productOptions;

    // Effective sizes (legacy `config.sizes` if present, otherwise derived
    // from productOptions × pricing tables) — keeps newly-built admin
    // templates working even when their legacy `sizes` jsonb is empty.
    const effectiveSizes = getEffectiveSizes(config, productOptions);

    const allowedSizesForType =
      config.product_type === "canvas"
        ? productOptions.canvas?.allowedSizes ?? []
        : productOptions.poster?.allowedSizes ?? [];
    const allowedFiltered = effectiveSizes.filter(
      (s) => allowedSizesForType.length === 0 || allowedSizesForType.includes(s.size),
    );
    const sizeStillValid = prevSize && allowedFiltered.find((s) => s.size === prevSize);
    const nextSize = sizeStillValid ? prevSize : allowedFiltered[0]?.size ?? effectiveSizes[0]?.size ?? null;
    const nextSizeDef = effectiveSizes.find((s) => s.size === nextSize);

    const allowedVariantsForType =
      config.product_type === "canvas"
        ? productOptions.canvas?.allowedDepths ?? []
        : productOptions.poster?.allowedFrames ?? [];
    const variantsForSize = (nextSizeDef?.variants ?? []).filter(
      (v) => allowedVariantsForType.length === 0 || allowedVariantsForType.includes(v.name),
    );
    const variantStillValid = prevVariant && variantsForSize.find((v) => v.name === prevVariant);
    const nextVariant = variantStillValid
      ? prevVariant
      : variantsForSize[0]?.name ?? nextSizeDef?.variants[0]?.name ?? null;

    const orientation = state.orientation;
    const isFirstLoad = state.config === null;
    const layerValues = hydrateLayerValues(template, orientation, config.product_type);
    const layout = getActiveLayoutBlock(template, config.product_type)[orientation];

    const next = {
      config,
      template,
      productOptions,
      size: nextSize,
      variant: nextVariant,
      layerValues,
      layerTransforms: {} as Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }>,
      whiteMarginEnabled: true,
      ...(isFirstLoad && layout?.background?.color
        ? { posterBgColor: layout.background.color }
        : {}),
    };
    set({ ...next, ...mirrorLegacy({ template, orientation, layerValues, config }) });
  },

  setPosterBgColor: (posterBgColor) => set({ posterBgColor }),
  setWhiteMarginEnabled: (whiteMarginEnabled) => set({ whiteMarginEnabled }),
  setLayerTransform: (id, patch) => {
    const state = get();
    const layer = state.template?.defaultLayout[state.orientation].layers.find((l) => l.id === id);
    if (!layer) return;
    const cur = state.layerTransforms[id] ?? {};
    const merged = {
      xPct: patch.xPct ?? cur.xPct ?? layer.xPct,
      yPct: patch.yPct ?? cur.yPct ?? layer.yPct,
      wPct: patch.wPct ?? cur.wPct ?? layer.wPct,
      hPct: patch.hPct ?? cur.hPct ?? layer.hPct,
    };
    const clamped = clampLayerRect(merged);
    set({
      layerTransforms: {
        ...state.layerTransforms,
        [id]: clamped,
      },
    });
  },
  resetLayerTransform: (id) => {
    const state = get();
    if (!(id in state.layerTransforms)) return;
    const next = { ...state.layerTransforms };
    delete next[id];
    set({ layerTransforms: next });
  },
  setSize: (size) => {
    const { config, productOptions } = get();
    if (!config) return set({ size });
    const effective = getEffectiveSizes(config, productOptions);
    const sizeDef = effective.find((s) => s.size === size);
    const currentVariant = get().variant;
    const variantStillValid = sizeDef?.variants.find((v) => v.name === currentVariant);
    set({
      size,
      variant: variantStillValid ? currentVariant : sizeDef?.variants[0]?.name ?? null,
    });
  },
  setVariant: (variant) => set({ variant }),
  setOrientation: (orientation) => {
    const { template, config } = get();
    if (!template) return set({ orientation });
    const layerValues = hydrateLayerValues(template, orientation, config?.product_type);
    set({ orientation, layerValues, layerTransforms: {}, whiteMarginEnabled: true, ...mirrorLegacy({ template, orientation, layerValues, config }) });
  },

  setPhotoSource: (file, previewUrl) => {
    const prev = get();
    // If a file is being cleared, also clear hash + originalPhotoUrl.
    // If a new file is set, callers should follow up with `setPhotoHash` once
    // the SHA-256 has been computed. We optimistically null the AI result and
    // upload URL since they belong to the previous photo.
    set({
      photoFile: file,
      photoPreviewUrl: previewUrl,
      designSource: file ? "photo" : "map",
      aiPrintFileUrl: file ? null : prev.aiPrintFileUrl,
      originalPhotoUrl: file ? null : prev.originalPhotoUrl,
      photoHash: file ? null : prev.photoHash,
      layerValues: resetPhotoOffsets(prev.layerValues),
    });
  },
  setOriginalPhotoUrl: (url) => set({ originalPhotoUrl: url }),
  setPhotoHash: (hash) => {
    // If the new hash matches what we already had, this is the same photo
    // being re-set (e.g. via undo) — nothing to invalidate.
    const prev = get();
    if (prev.photoHash === hash) return;
    set({ photoHash: hash });
  },
  setAiPrintFileUrl: (url) => {
    set({ aiPrintFileUrl: url, designSource: url ? "ai" : "map" });
  },
  clearAiResultOnly: () => {
    // Drop only the AI-styled result, preserve photo identity so the history
    // list keeps showing and re-applying a cached style is instant.
    const { photoFile } = get();
    set({
      aiPrintFileUrl: null,
      designSource: photoFile ? "photo" : "map",
    });
  },
  resetDesignSource: () =>
    set({
      designSource: "map",
      photoFile: null,
      photoPreviewUrl: null,
      originalPhotoUrl: null,
      photoHash: null,
      aiPrintFileUrl: null,
      layerValues: resetPhotoOffsets(get().layerValues),
    }),
  setShopifyVariantId: (shopifyVariantId) => set({ shopifyVariantId }),
  setShopifyVariantResolving: (shopifyVariantResolving) => set({ shopifyVariantResolving }),

  // ---------- AI cache ----------
  addAiResultToCache: (photoHash, presetId, presetLabel, url) => {
    if (!photoHash) return;
    const key = makeCacheKey(photoHash, presetId);
    const next: Record<string, AiCacheEntry> = {
      ...get().aiResultCache,
      [key]: { url, presetId, presetLabel, photoHash, timestamp: Date.now() },
    };
    set({ aiResultCache: next });
    saveAiCache(next);
  },
  getCachedAiResult: (photoHash, presetId) => {
    if (!photoHash) return null;
    const entry = get().aiResultCache[makeCacheKey(photoHash, presetId)];
    return entry?.url ?? null;
  },
  listAiResultsForPhoto: (photoHash) => {
    if (!photoHash) return [];
    return Object.values(get().aiResultCache)
      .filter((e) => e.photoHash === photoHash)
      .sort((a, b) => b.timestamp - a.timestamp);
  },
  clearAiResult: (photoHash, presetId) => {
    if (!photoHash) return;
    const key = makeCacheKey(photoHash, presetId);
    const cur = get().aiResultCache;
    if (!cur[key]) return;
    const next = { ...cur };
    delete next[key];
    set({ aiResultCache: next });
    saveAiCache(next);
  },

  // ---------- aiPhoto (face-swap) ----------
  setAiPhotoSource: (layerId, file, previewUrl) => {
    const cur = get().aiPhotoSources;
    const prev = cur[layerId];
    if (!file || !previewUrl) {
      // Clear
      if (prev?.previewUrl?.startsWith("blob:")) {
        try { URL.revokeObjectURL(prev.previewUrl); } catch { /* noop */ }
      }
      const next = { ...cur };
      delete next[layerId];
      const results = { ...get().aiPhotoResults };
      delete results[layerId];
      set({ aiPhotoSources: next, aiPhotoResults: results });
      return;
    }
    if (prev?.previewUrl?.startsWith("blob:") && prev.previewUrl !== previewUrl) {
      try { URL.revokeObjectURL(prev.previewUrl); } catch { /* noop */ }
    }
    set({
      aiPhotoSources: {
        ...cur,
        [layerId]: { file, previewUrl, hash: null, uploadedUrl: null },
      },
      // New face → drop the old swap result for this layer.
      aiPhotoResults: (() => {
        const r = { ...get().aiPhotoResults };
        delete r[layerId];
        return r;
      })(),
    });
  },
  setAiPhotoHash: (layerId, hash) => {
    const cur = get().aiPhotoSources[layerId];
    if (!cur || cur.hash === hash) return;
    set({
      aiPhotoSources: {
        ...get().aiPhotoSources,
        [layerId]: { ...cur, hash },
      },
    });
  },
  setAiPhotoUploadedUrl: (layerId, url) => {
    const cur = get().aiPhotoSources[layerId];
    if (!cur) return;
    set({
      aiPhotoSources: {
        ...get().aiPhotoSources,
        [layerId]: { ...cur, uploadedUrl: url },
      },
    });
  },
  setAiPhotoResult: (layerId, url) => {
    const cur = { ...get().aiPhotoResults };
    if (url) cur[layerId] = url;
    else delete cur[layerId];
    set({ aiPhotoResults: cur });
  },
  clearAiPhoto: (layerId) => {
    const sources = { ...get().aiPhotoSources };
    const prev = sources[layerId];
    if (prev?.previewUrl?.startsWith("blob:")) {
      try { URL.revokeObjectURL(prev.previewUrl); } catch { /* noop */ }
    }
    delete sources[layerId];
    const results = { ...get().aiPhotoResults };
    delete results[layerId];
    set({ aiPhotoSources: sources, aiPhotoResults: results });
  },
  addFaceSwapToCache: (layerId, faceHash, referenceImageUrl, url) => {
    if (!faceHash || !referenceImageUrl) return;
    const key = makeFaceSwapKey(faceHash, referenceImageUrl, layerId);
    const next: Record<string, FaceSwapCacheEntry> = {
      ...get().faceSwapCache,
      [key]: { url, layerId, faceHash, referenceImageUrl, timestamp: Date.now() },
    };
    set({ faceSwapCache: next });
    saveFaceSwapCache(next);
  },
  getCachedFaceSwap: (layerId, faceHash, referenceImageUrl) => {
    if (!faceHash || !referenceImageUrl) return null;
    const entry = get().faceSwapCache[makeFaceSwapKey(faceHash, referenceImageUrl, layerId)];
    return entry?.url ?? null;
  },

  setLayerMapCenter: (id, c) => updateMap(set, get, id, { center: c }),
  setLayerMapZoom: (id, z) => updateMap(set, get, id, { zoom: z }),
  setLayerMapStyle: (id, s) => updateMap(set, get, id, { styleId: s }),
  setLayerMapShape: (id, s) => updateMap(set, get, id, { shape: s }),
  setLayerShowLabels: (id, v) => updateMap(set, get, id, { showLabels: v }),

  applyPlaceToLayer: (id, args) => {
    applyPlaceInternal(set, get, id, args, /* moveCenter */ true);
  },
  updateMapLayerFromPan: (id, args) => {
    applyPlaceInternal(set, get, id, args, /* moveCenter */ false);
  },

  setLayerText: (id, t) => updateText(set, get, id, { text: t, isCustom: true }),
  setLayerTextFont: (id, f) => updateText(set, get, id, { font: f }),
  setLayerTextVisible: (id, v) => updateText(set, get, id, { visible: v }),
  setLayerPhotoShape: (id, s) => updatePhoto(set, get, id, { shape: s }),
  setLayerPhotoOffset: (id, x, y) =>
    // Clamp is performed at the call site (PhotoLayerView) where natural
    // image dimensions and container size are known. Store the raw value.
    updatePhoto(set, get, id, { offsetX: x, offsetY: y }),

  // ---------- legacy globals → operate on first layer ----------
  setMapCenter: (c) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { center: c });
  },
  setMapZoom: (z) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { zoom: z });
  },
  setMapStyleId: (s) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { styleId: s });
  },
  setShowLabels: (v) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { showLabels: v });
  },
  setMapShape: (s) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { shape: s });
  },
  setText: (t) => {
    const id = get().firstTextLayerId();
    if (id) updateText(set, get, id, { text: t, isCustom: true });
  },
  setTextFont: (f) => {
    const id = get().firstTextLayerId();
    if (id) updateText(set, get, id, { font: f });
  },
  setTextVisible: (v) => {
    const id = get().firstTextLayerId();
    if (id) updateText(set, get, id, { visible: v });
  },
  applyPlace: (args) => {
    const id = get().firstMapLayerId();
    if (id) applyPlaceInternal(set, get, id, args, true);
  },
  updateFromMap: (args) => {
    const id = get().firstMapLayerId();
    if (id) applyPlaceInternal(set, get, id, args, false);
  },

  // ---------- computed ----------
  currentPrice: () => {
    const { config, productOptions, size, variant } = get();
    if (!config || !size || !variant) return 0;
    const effective = getEffectiveSizes(config, productOptions);
    const sizeDef = effective.find((s) => s.size === size);
    return sizeDef?.variants.find((v) => v.name === variant)?.price ?? 0;
  },
  currentLayout: () => {
    const { config, orientation } = get();
    return config?.layouts[orientation] ?? null;
  },
  templateLayers: () => {
    const { template, orientation } = get();
    if (!template) return [];
    return [...template.defaultLayout[orientation].layers].sort((a, b) => a.zIndex - b.zIndex);
  },
  firstMapLayerId: () => {
    const layers = get().templateLayers();
    return layers.find((l) => l.type === "map")?.id ?? null;
  },
  firstTextLayerId: () => {
    const layers = get().templateLayers();
    return layers.find((l) => l.type === "text")?.id ?? null;
  },
  getMapValue: (id) => {
    const v = get().layerValues[id];
    return v && v.kind === "map" ? v : null;
  },
  getTextValue: (id) => {
    const v = get().layerValues[id];
    return v && v.kind === "text" ? v : null;
  },
}));

// ---------- internal helpers ----------
type SetFn = (partial: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => void;
type GetFn = () => EditorState;

function updateMap(set: SetFn, get: GetFn, id: string, patch: Partial<MapLayerValue>) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "map") return;
  const next: MapLayerValue = { ...cur, ...patch };
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues, ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues, config: state.config }) });
}

function updateText(set: SetFn, get: GetFn, id: string, patch: Partial<TextLayerValue>) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "text") return;
  const next: TextLayerValue = { ...cur, ...patch };
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues, ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues, config: state.config }) });
}

  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "photo") return;
  const next: PhotoLayerValue = { ...cur, ...patch };
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues });
}

function resetPhotoOffsets(values: Record<string, LayerValue>): Record<string, LayerValue> {
  const out: Record<string, LayerValue> = { ...values };
  for (const [id, v] of Object.entries(values)) {
    if (v.kind === "photo") {
      out[id] = { ...v, offsetX: 0, offsetY: 0 };
    }
  }
  return out;
}

function applyPlaceInternal(
  set: SetFn,
  get: GetFn,
  mapId: string,
  args: ApplyPlaceArgs,
  moveCenter: boolean,
) {
  const state = get();
  const cur = state.layerValues[mapId];
  if (!cur || cur.kind !== "map") return;
  const nextMap: MapLayerValue = {
    ...cur,
    ...(moveCenter ? { center: args.center } : {}),
    placeName: args.placeName,
    city: args.city,
    country: args.country,
  };

  // Update any text layers explicitly linked to this map (only when not
  // user-customised). No implicit "first map → first text" fallback — that
  // promise is upheld by the migration step in template-migrate.ts which
  // back-fills `linkedMapLayerId` for single-map+single-text templates.
  const layers = state.template
    ? state.template.defaultLayout[state.orientation].layers
    : [];
  const newLayerValues: Record<string, LayerValue> = {
    ...state.layerValues,
    [mapId]: nextMap,
  };
  for (const l of layers) {
    if (l.type !== "text") continue;
    if (l.defaults.linkedMapLayerId !== mapId) continue;
    const tv = state.layerValues[l.id];
    if (!tv || tv.kind !== "text" || tv.isCustom) continue;
    newLayerValues[l.id] = { ...tv, text: buildAutoText(args, l.defaults.linkedMapFields) };
  }

  set({
    layerValues: newLayerValues,
    ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues: newLayerValues }),
  });
}
