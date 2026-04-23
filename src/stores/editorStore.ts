import { create } from "zustand";
import type { Orientation, ProductConfig } from "@/lib/product-config";
import type { DesignSource } from "@/lib/print-pipeline";
import type { ProductOptions, Template, TemplateLayer } from "@/lib/template-schema";
import { resolveTemplate } from "@/lib/template-migrate";

interface ApplyPlaceArgs {
  placeName: string;
  center: [number, number];
  city?: string;
  country?: string;
}

export type MapShape = "circle" | "heart" | "star";

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

export type LayerValue = MapLayerValue | TextLayerValue | PhotoLayerValue;

interface EditorState {
  config: ProductConfig | null;
  template: Template | null;
  productOptions: ProductOptions | null;

  // Per-layer values keyed by layer id (covers map + text layers).
  layerValues: Record<string, LayerValue>;

  // Global background (one per layout). Other map/text values now live in
  // `layerValues`; the fields below are derived getters for legacy callers.
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
  aiPrintFileUrl: string | null;
  /** Real Shopify variant GID (e.g. gid://shopify/ProductVariant/123). Resolved
   *  lazily based on (handle, size, variant). Null while resolving / not found. */
  shopifyVariantId: string | null;
  shopifyVariantResolving: boolean;

  // ---------- setters ----------
  setConfig: (c: ProductConfig) => void;
  setPosterBgColor: (c: string) => void;
  setSize: (s: string) => void;
  setVariant: (v: string) => void;
  setOrientation: (o: Orientation) => void;
  setPhotoSource: (file: File | null, previewUrl: string | null) => void;
  setOriginalPhotoUrl: (url: string | null) => void;
  setAiPrintFileUrl: (url: string | null) => void;
  resetDesignSource: () => void;
  setShopifyVariantId: (id: string | null) => void;
  setShopifyVariantResolving: (resolving: boolean) => void;

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

function buildAutoText(args: ApplyPlaceArgs): string {
  const [lng, lat] = args.center;
  const cityLine = (args.city ?? args.placeName.split(",")[0] ?? "").trim().toUpperCase();
  const countryLine = args.country?.trim() ?? "";
  const coordLine = `${lat.toFixed(4)}°N · ${lng.toFixed(4)}°E`;
  return [cityLine, countryLine, coordLine].filter(Boolean).join("\n");
}

function hydrateLayerValues(template: Template, orientation: Orientation): Record<string, LayerValue> {
  const layout = template.defaultLayout[orientation];
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
    }
  }
  return out;
}

/** Recompute legacy "first map / first text" mirrors from layerValues. */
function mirrorLegacy(state: Pick<EditorState, "template" | "orientation" | "layerValues">) {
  const layout = state.template?.defaultLayout[state.orientation];
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
  posterBgColor: "#EFE7D6",

  size: null,
  variant: null,
  orientation: "portrait",

  designSource: "map",
  photoFile: null,
  photoPreviewUrl: null,
  originalPhotoUrl: null,
  aiPrintFileUrl: null,
  shopifyVariantId: null,
  shopifyVariantResolving: false,

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

    const allowedSizesForType =
      config.product_type === "canvas"
        ? productOptions.canvas?.allowedSizes ?? []
        : productOptions.poster?.allowedSizes ?? [];
    const allowedFiltered = config.sizes.filter(
      (s) => allowedSizesForType.length === 0 || allowedSizesForType.includes(s.size),
    );
    const sizeStillValid = prevSize && allowedFiltered.find((s) => s.size === prevSize);
    const nextSize = sizeStillValid ? prevSize : allowedFiltered[0]?.size ?? config.sizes[0]?.size ?? null;
    const nextSizeDef = config.sizes.find((s) => s.size === nextSize);

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
    const layerValues = hydrateLayerValues(template, orientation);
    const layout = template.defaultLayout[orientation];

    const next = {
      config,
      template,
      productOptions,
      size: nextSize,
      variant: nextVariant,
      layerValues,
      ...(isFirstLoad && layout?.background?.color
        ? { posterBgColor: layout.background.color }
        : {}),
    };
    set({ ...next, ...mirrorLegacy({ template, orientation, layerValues }) });
  },

  setPosterBgColor: (posterBgColor) => set({ posterBgColor }),
  setSize: (size) => {
    const config = get().config;
    if (!config) return set({ size });
    const sizeDef = config.sizes.find((s) => s.size === size);
    const currentVariant = get().variant;
    const variantStillValid = sizeDef?.variants.find((v) => v.name === currentVariant);
    set({
      size,
      variant: variantStillValid ? currentVariant : sizeDef?.variants[0]?.name ?? null,
    });
  },
  setVariant: (variant) => set({ variant }),
  setOrientation: (orientation) => {
    const { template } = get();
    if (!template) return set({ orientation });
    const layerValues = hydrateLayerValues(template, orientation);
    set({ orientation, layerValues, ...mirrorLegacy({ template, orientation, layerValues }) });
  },

  setPhotoSource: (file, previewUrl) => {
    set({
      photoFile: file,
      photoPreviewUrl: previewUrl,
      designSource: file ? "photo" : "map",
      // Switching photo invalidates AI result + cached upload URL.
      aiPrintFileUrl: file ? null : get().aiPrintFileUrl,
      originalPhotoUrl: file ? null : get().originalPhotoUrl,
    });
  },
  setOriginalPhotoUrl: (url) => set({ originalPhotoUrl: url }),
  setAiPrintFileUrl: (url) => {
    set({ aiPrintFileUrl: url, designSource: url ? "ai" : "map" });
  },
  resetDesignSource: () =>
    set({
      designSource: "map",
      photoFile: null,
      photoPreviewUrl: null,
      originalPhotoUrl: null,
      aiPrintFileUrl: null,
    }),
  setShopifyVariantId: (shopifyVariantId) => set({ shopifyVariantId }),
  setShopifyVariantResolving: (shopifyVariantResolving) => set({ shopifyVariantResolving }),

  // ---------- per-layer setters ----------
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
    const { config, size, variant } = get();
    if (!config || !size || !variant) return 0;
    const sizeDef = config.sizes.find((s) => s.size === size);
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
  set({ layerValues, ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues }) });
}

function updateText(set: SetFn, get: GetFn, id: string, patch: Partial<TextLayerValue>) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "text") return;
  const next: TextLayerValue = { ...cur, ...patch };
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues, ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues }) });
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
    newLayerValues[l.id] = { ...tv, text: buildAutoText(args) };
  }

  set({
    layerValues: newLayerValues,
    ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues: newLayerValues }),
  });
}
