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

/** Per-photo-layer customer state. Each `photo` layer in the template has
 *  its own uploaded file + AI state, so multi-photo templates show
 *  independent images per behållare. */
export interface PhotoLayerSource {
  file: File;
  previewUrl: string;
  /** SHA-256 of the file bytes; lazy-computed by AiStyleSection. */
  hash: string | null;
  /** Public URL after lazy upload to cart-previews (so Replicate can fetch). */
  originalUrl: string | null;
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

  /** Per-photo-layer uploaded sources, keyed by layer id. */
  photoSources: Record<string, PhotoLayerSource>;
  /** Per-photo-layer AI-styled print-file URL, keyed by layer id. */
  photoAiResults: Record<string, string>;

  // ---- legacy mirrors of the FIRST photo layer (kept for backward compat
  // with cart payload + existing snapshot/mockup callers). Computed via
  // `mirrorPhoto()` on every per-layer change. New code should read the
  // per-layer maps above instead. ----
  designSource: DesignSource;
  photoFile: File | null;
  photoPreviewUrl: string | null;
  originalPhotoUrl: string | null;
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

  // ---------- per-photo-layer setters ----------
  setPhotoSourceFor: (layerId: string, file: File | null, previewUrl: string | null) => void;
  setPhotoHashFor: (layerId: string, hash: string) => void;
  setOriginalPhotoUrlFor: (layerId: string, url: string) => void;
  setAiPrintFileUrlFor: (layerId: string, url: string | null) => void;
  clearAiResultOnlyFor: (layerId: string) => void;
  /** Returns a per-layer overlay map (AI result wins over upload) for use
   *  by the snapshot/print pipeline + mockup gallery. */
  getPhotoOverlays: () => Record<string, string>;
  firstPhotoLayerId: () => string | null;
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

/**
 * Build a mapping from previous layer IDs to next layer IDs by pairing layers
 * of the same `type` index-by-index within each orientation. Used when the
 * active layout block changes (poster ↔ canvas) so per-layer state survives.
 */
function buildLayerIdMap(
  prevTemplate: Template | null,
  prevProductType: string | null | undefined,
  nextTemplate: Template,
  nextProductType: string | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!prevTemplate) return map;
  const prevBlock = getActiveLayoutBlock(prevTemplate, prevProductType);
  const nextBlock = getActiveLayoutBlock(nextTemplate, nextProductType);
  for (const orientation of ["portrait", "landscape"] as const) {
    const prevLayers = prevBlock[orientation]?.layers ?? [];
    const nextLayers = nextBlock[orientation]?.layers ?? [];
    const grouped: Record<string, TemplateLayer[]> = {};
    for (const l of nextLayers) {
      (grouped[l.type] ||= []).push(l);
    }
    const cursors: Record<string, number> = {};
    for (const prev of prevLayers) {
      const idx = cursors[prev.type] ?? 0;
      const next = grouped[prev.type]?.[idx];
      if (next && prev.id !== next.id) {
        map[prev.id] = next.id;
      }
      cursors[prev.type] = idx + 1;
    }
  }
  return map;
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

/** Recompute legacy first-photo-layer mirrors. The mirrors keep the cart
 *  payload + EditorPage's existing reads working unchanged. */
function mirrorPhoto(
  state: Pick<EditorState, "template" | "orientation" | "config" | "photoSources" | "photoAiResults">,
) {
  const layout = state.template
    ? getActiveLayoutBlock(state.template, state.config?.product_type)[state.orientation]
    : undefined;
  const firstPhoto = layout?.layers.find((l) => l.type === "photo");
  const id = firstPhoto?.id ?? null;
  const src = id ? state.photoSources[id] : undefined;
  const ai = id ? state.photoAiResults[id] : undefined;
  // Aggregate `designSource` across ALL photo layers so the cart payload
  // reflects the strongest source in use anywhere on the template.
  const anyAi = Object.keys(state.photoAiResults).length > 0;
  const anyPhoto = Object.keys(state.photoSources).length > 0;
  const designSource: DesignSource = anyAi ? "ai" : anyPhoto ? "photo" : "map";
  return {
    designSource,
    photoFile: src?.file ?? null,
    photoPreviewUrl: src?.previewUrl ?? null,
    photoHash: src?.hash ?? null,
    originalPhotoUrl: src?.originalUrl ?? null,
    aiPrintFileUrl: ai ?? null,
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
  photoSources: {},
  photoAiResults: {},
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
    const prevTemplate = state.template;
    const prevProductType = state.config?.product_type;
    const layoutBlockChanged =
      !!prevTemplate &&
      getActiveLayoutBlock(prevTemplate, prevProductType) !==
        getActiveLayoutBlock(template, config.product_type);

    const freshLayerValues = hydrateLayerValues(template, orientation, config.product_type);
    const layout = getActiveLayoutBlock(template, config.product_type)[orientation];

    let nextLayerValues = freshLayerValues;
    let nextLayerTransforms: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }> = {};
    let nextAiPhotoResults = state.aiPhotoResults;
    let nextAiPhotoSources = state.aiPhotoSources;
    let nextPhotoSources = state.photoSources;
    let nextPhotoAiResults = state.photoAiResults;

    if (!isFirstLoad && layoutBlockChanged) {
      const idMap = buildLayerIdMap(prevTemplate, prevProductType, template, config.product_type);
      // Carry over per-layer values (photo shape/offset, text content, map state, …)
      const merged: Record<string, LayerValue> = { ...freshLayerValues };
      for (const [oldId, oldVal] of Object.entries(state.layerValues)) {
        const newId = idMap[oldId] ?? oldId;
        if (merged[newId] && merged[newId].kind === oldVal.kind) {
          merged[newId] = oldVal;
        }
      }
      nextLayerValues = merged;
      // Carry over layer transforms (custom rect)
      const remappedTransforms: typeof nextLayerTransforms = {};
      for (const [oldId, val] of Object.entries(state.layerTransforms)) {
        const newId = idMap[oldId] ?? oldId;
        remappedTransforms[newId] = val;
      }
      nextLayerTransforms = remappedTransforms;
      // Carry over AI photo results + sources (keyed by aiPhoto layer ID)
      const remappedAiResults: Record<string, string> = {};
      for (const [oldId, val] of Object.entries(state.aiPhotoResults)) {
        const newId = idMap[oldId] ?? oldId;
        remappedAiResults[newId] = val;
      }
      nextAiPhotoResults = remappedAiResults;
      const remappedAiSources: Record<string, AiPhotoSource> = {};
      for (const [oldId, val] of Object.entries(state.aiPhotoSources)) {
        const newId = idMap[oldId] ?? oldId;
        remappedAiSources[newId] = val;
      }
      nextAiPhotoSources = remappedAiSources;
      // Carry over per-photo-layer sources + AI results (keyed by photo layer ID)
      const remappedPhotoSources: Record<string, PhotoLayerSource> = {};
      for (const [oldId, val] of Object.entries(state.photoSources)) {
        const newId = idMap[oldId] ?? oldId;
        remappedPhotoSources[newId] = val;
      }
      nextPhotoSources = remappedPhotoSources;
      const remappedPhotoAi: Record<string, string> = {};
      for (const [oldId, val] of Object.entries(state.photoAiResults)) {
        const newId = idMap[oldId] ?? oldId;
        remappedPhotoAi[newId] = val;
      }
      nextPhotoAiResults = remappedPhotoAi;
    } else if (!isFirstLoad) {
      // Same layout block (e.g. poster ↔ aluminum) → keep existing per-layer state untouched.
      nextLayerValues = { ...freshLayerValues, ...state.layerValues };
      nextLayerTransforms = state.layerTransforms;
    }

    const next = {
      config,
      template,
      productOptions,
      size: nextSize,
      variant: nextVariant,
      layerValues: nextLayerValues,
      layerTransforms: nextLayerTransforms,
      aiPhotoResults: nextAiPhotoResults,
      aiPhotoSources: nextAiPhotoSources,
      photoSources: nextPhotoSources,
      photoAiResults: nextPhotoAiResults,
      whiteMarginEnabled: true,
      ...(isFirstLoad && layout?.background?.color
        ? { posterBgColor: layout.background.color }
        : {}),
    };
    set({
      ...next,
      ...mirrorLegacy({ template, orientation, layerValues: nextLayerValues, config }),
      ...mirrorPhoto({ template, orientation, config, photoSources: nextPhotoSources, photoAiResults: nextPhotoAiResults }),
    });
  },

  setPosterBgColor: (posterBgColor) => set({ posterBgColor }),
  setWhiteMarginEnabled: (whiteMarginEnabled) => set({ whiteMarginEnabled }),
  setLayerTransform: (id, patch) => {
    const state = get();
    const layer = state.template
      ? getActiveLayoutBlock(state.template, state.config?.product_type)[state.orientation].layers.find((l) => l.id === id)
      : undefined;
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
    const state = get();
    const { template, config } = state;
    if (!template) return set({ orientation });
    const prevOrientation = state.orientation;
    const freshLayerValues = hydrateLayerValues(template, orientation, config?.product_type);

    // Build a portrait↔landscape ID map within the active layout block by
    // pairing layers of the same type index-by-index. Lets per-layer state
    // (AI results, photo sources, transforms) follow over to the matching
    // container in the new orientation.
    const block = getActiveLayoutBlock(template, config?.product_type);
    const prevLayers = block[prevOrientation]?.layers ?? [];
    const nextLayers = block[orientation]?.layers ?? [];
    const grouped: Record<string, TemplateLayer[]> = {};
    for (const l of nextLayers) (grouped[l.type] ||= []).push(l);
    const cursors: Record<string, number> = {};
    const idMap: Record<string, string> = {};
    for (const prev of prevLayers) {
      const idx = cursors[prev.type] ?? 0;
      const next = grouped[prev.type]?.[idx];
      if (next) idMap[prev.id] = next.id;
      cursors[prev.type] = idx + 1;
    }
    const remap = <T,>(m: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [oldId, v] of Object.entries(m)) {
        const newId = idMap[oldId] ?? oldId;
        out[newId] = v;
      }
      return out;
    };

    // Carry over layerValues for paired layers (same kind), otherwise fresh.
    const layerValues: Record<string, LayerValue> = { ...freshLayerValues };
    for (const [oldId, oldVal] of Object.entries(state.layerValues)) {
      const newId = idMap[oldId] ?? oldId;
      if (layerValues[newId] && layerValues[newId].kind === oldVal.kind) {
        layerValues[newId] = oldVal;
      }
    }

    const photoSources = remap(state.photoSources);
    const photoAiResults = remap(state.photoAiResults);
    const aiPhotoSources = remap(state.aiPhotoSources);
    const aiPhotoResults = remap(state.aiPhotoResults);
    const layerTransforms = remap(state.layerTransforms);

    set({
      orientation,
      layerValues,
      layerTransforms,
      photoSources,
      photoAiResults,
      aiPhotoSources,
      aiPhotoResults,
      whiteMarginEnabled: true,
      ...mirrorLegacy({ template, orientation, layerValues, config }),
      ...mirrorPhoto({ template, orientation, config, photoSources, photoAiResults }),
    });
  },

  // ---------- per-photo-layer setters ----------
  setPhotoSourceFor: (layerId, file, previewUrl) => {
    const state = get();
    const prevSrc = state.photoSources[layerId];
    if (prevSrc?.previewUrl?.startsWith("blob:") && prevSrc.previewUrl !== previewUrl) {
      try { URL.revokeObjectURL(prevSrc.previewUrl); } catch { /* noop */ }
    }
    const nextSources = { ...state.photoSources };
    const nextResults = { ...state.photoAiResults };
    if (!file || !previewUrl) {
      delete nextSources[layerId];
      delete nextResults[layerId];
    } else {
      nextSources[layerId] = { file, previewUrl, hash: null, originalUrl: null };
      // New photo → drop any AI result for this layer.
      delete nextResults[layerId];
    }
    // Reset offset for this specific photo layer.
    const layerValues = { ...state.layerValues };
    const v = layerValues[layerId];
    if (v && v.kind === "photo") {
      layerValues[layerId] = { ...v, offsetX: 0, offsetY: 0 };
    }
    set({
      photoSources: nextSources,
      photoAiResults: nextResults,
      layerValues,
      ...mirrorPhoto({ ...state, photoSources: nextSources, photoAiResults: nextResults }),
    });
  },
  setPhotoHashFor: (layerId, hash) => {
    const state = get();
    const cur = state.photoSources[layerId];
    if (!cur || cur.hash === hash) return;
    const nextSources = { ...state.photoSources, [layerId]: { ...cur, hash } };
    set({ photoSources: nextSources, ...mirrorPhoto({ ...state, photoSources: nextSources }) });
  },
  setOriginalPhotoUrlFor: (layerId, url) => {
    const state = get();
    const cur = state.photoSources[layerId];
    if (!cur) return;
    const nextSources = { ...state.photoSources, [layerId]: { ...cur, originalUrl: url } };
    set({ photoSources: nextSources, ...mirrorPhoto({ ...state, photoSources: nextSources }) });
  },
  setAiPrintFileUrlFor: (layerId, url) => {
    const state = get();
    const nextResults = { ...state.photoAiResults };
    if (url) nextResults[layerId] = url;
    else delete nextResults[layerId];
    set({ photoAiResults: nextResults, ...mirrorPhoto({ ...state, photoAiResults: nextResults }) });
  },
  clearAiResultOnlyFor: (layerId) => {
    const state = get();
    if (!(layerId in state.photoAiResults)) return;
    const nextResults = { ...state.photoAiResults };
    delete nextResults[layerId];
    set({ photoAiResults: nextResults, ...mirrorPhoto({ ...state, photoAiResults: nextResults }) });
  },
  getPhotoOverlays: () => {
    const { photoSources, photoAiResults } = get();
    const out: Record<string, string> = {};
    for (const [id, src] of Object.entries(photoSources)) {
      if (src.previewUrl) out[id] = src.previewUrl;
    }
    for (const [id, url] of Object.entries(photoAiResults)) {
      if (url) out[id] = url;
    }
    return out;
  },
  firstPhotoLayerId: () => {
    const layers = get().templateLayers();
    return layers.find((l) => l.type === "photo")?.id ?? null;
  },

  // ---------- legacy globals → operate on first photo layer ----------
  setPhotoSource: (file, previewUrl) => {
    const id = get().firstPhotoLayerId();
    if (id) get().setPhotoSourceFor(id, file, previewUrl);
  },
  setOriginalPhotoUrl: (url) => {
    const id = get().firstPhotoLayerId();
    if (id && url) get().setOriginalPhotoUrlFor(id, url);
  },
  setPhotoHash: (hash) => {
    const id = get().firstPhotoLayerId();
    if (id && hash) get().setPhotoHashFor(id, hash);
  },
  setAiPrintFileUrl: (url) => {
    const id = get().firstPhotoLayerId();
    if (id) get().setAiPrintFileUrlFor(id, url);
  },
  clearAiResultOnly: () => {
    const id = get().firstPhotoLayerId();
    if (id) get().clearAiResultOnlyFor(id);
  },
  resetDesignSource: () => {
    const state = get();
    // Revoke all blob URLs.
    for (const src of Object.values(state.photoSources)) {
      if (src.previewUrl?.startsWith("blob:")) {
        try { URL.revokeObjectURL(src.previewUrl); } catch { /* noop */ }
      }
    }
    set({
      photoSources: {},
      photoAiResults: {},
      layerValues: resetPhotoOffsets(state.layerValues),
      ...mirrorPhoto({ ...state, photoSources: {}, photoAiResults: {} }),
    });
  },
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
    const { template, orientation, config } = get();
    if (!template) return [];
    return [...getActiveLayoutBlock(template, config?.product_type)[orientation].layers].sort((a, b) => a.zIndex - b.zIndex);
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
function updatePhoto(set: SetFn, get: GetFn, id: string, patch: Partial<PhotoLayerValue>) {
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
    ? getActiveLayoutBlock(state.template, state.config?.product_type)[state.orientation].layers
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
    ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues: newLayerValues, config: state.config }),
  });
}
