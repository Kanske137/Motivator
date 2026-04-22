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

export type MapShape = "rect" | "square" | "circle" | "heart";

interface EditorState {
  config: ProductConfig | null;
  template: Template | null;
  productOptions: ProductOptions | null;

  // map
  mapCenter: [number, number]; // [lng, lat]
  mapZoom: number;
  mapStyleId: string;
  placeName: string;
  city?: string;
  country?: string;
  showLabels: boolean;
  mapShape: MapShape;
  posterBgColor: string;

  // text
  text: string;
  textFont: string;
  textVisible: boolean;
  textIsCustom: boolean;

  // format
  size: string | null;
  variant: string | null;
  orientation: Orientation;

  // print-pipeline source
  designSource: DesignSource;
  photoFile: File | null;
  photoPreviewUrl: string | null;
  aiPrintFileUrl: string | null;

  // setters
  setConfig: (c: ProductConfig) => void;
  setMapCenter: (c: [number, number]) => void;
  setMapZoom: (z: number) => void;
  setMapStyleId: (s: string) => void;
  setPlaceName: (n: string) => void;
  setShowLabels: (v: boolean) => void;
  setMapShape: (s: MapShape) => void;
  setPosterBgColor: (c: string) => void;
  setText: (t: string) => void;
  setTextFont: (f: string) => void;
  setTextVisible: (v: boolean) => void;
  setSize: (s: string) => void;
  setVariant: (v: string) => void;
  setOrientation: (o: Orientation) => void;
  setPhotoSource: (file: File | null, previewUrl: string | null) => void;
  setAiPrintFileUrl: (url: string | null) => void;
  resetDesignSource: () => void;
  applyPlace: (args: ApplyPlaceArgs) => void;
  updateFromMap: (args: ApplyPlaceArgs) => void;

  // computed
  currentPrice: () => number;
  currentLayout: () => ProductConfig["layouts"]["portrait"] | null;
  templateLayers: () => TemplateLayer[];
}

function buildAutoText(args: ApplyPlaceArgs): string {
  const [lng, lat] = args.center;
  const cityLine = (args.city ?? args.placeName.split(",")[0] ?? "").trim().toUpperCase();
  const countryLine = args.country?.trim() ?? "";
  const coordLine = `${lat.toFixed(4)}°N · ${lng.toFixed(4)}°E`;
  return [cityLine, countryLine, coordLine].filter(Boolean).join("\n");
}

export const useEditorStore = create<EditorState>((set, get) => ({
  config: null,
  template: null,
  productOptions: null,
  mapCenter: [18.0686, 59.3293], // Stockholm
  mapZoom: 12,
  mapStyleId: "light-v11",
  placeName: "Stockholm, Sverige",
  city: "Stockholm",
  country: "Sverige",
  showLabels: false,
  mapShape: "rect",
  posterBgColor: "#EFE7D6",

  text: "STOCKHOLM\nSverige\n59.3293°N · 18.0686°E",
  textFont: "Inter",
  textVisible: true,
  textIsCustom: false,

  size: null,
  variant: null,
  orientation: "portrait",

  designSource: "map",
  photoFile: null,
  photoPreviewUrl: null,
  aiPrintFileUrl: null,

  setConfig: (config) => {
    // Preserve all design state across product switches (poster <-> canvas).
    // Only update fields that are no longer valid for the new product.
    const state = get();
    const prevSize = state.size;
    const prevVariant = state.variant;
    const prevStyle = state.mapStyleId;
    const prevFont = state.textFont;

    // Resolve the published template — this is the source of truth for what
    // the customer sees and is allowed to change.
    const rawTemplate = (config as unknown as { template?: unknown }).template;
    const { template } = resolveTemplate(config, rawTemplate);
    const productOptions = template.productOptions;

    // Size: keep if still available + allowed by template, else first allowed
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

    // Variant: keep if still available within the chosen size + allowed by template
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

    // Hydrate map/text state from the FIRST map/text layer in the active
    // orientation IF the customer hasn't already customised these values.
    // This is what makes mall-redigeringen i admin slå igenom i kund-vyn.
    const orientation = state.orientation;
    const layout = template.defaultLayout[orientation];
    const firstMap = layout?.layers.find((l) => l.type === "map");
    const firstText = layout?.layers.find((l) => l.type === "text");

    const isFirstLoad = state.config === null;
    const mapDefaults = firstMap?.type === "map" ? firstMap.defaults : null;
    const textDefaults = firstText?.type === "text" ? firstText.defaults : null;

    // Map style: prefer template default on first load, else keep user's pick if supported
    const styleStillValid = config.map_styles.includes(prevStyle);
    const nextStyle = isFirstLoad && mapDefaults
      ? mapDefaults.styleId
      : styleStillValid
      ? prevStyle
      : mapDefaults?.styleId ?? config.map_styles[0] ?? prevStyle;

    // Font: prefer template default on first load, else keep if supported
    const fontStillValid = config.text_config.fonts?.includes(prevFont);
    const nextFont = isFirstLoad && textDefaults
      ? textDefaults.font
      : fontStillValid
      ? prevFont
      : textDefaults?.font ?? config.text_config.defaultFont ?? prevFont;

    set({
      config,
      template,
      productOptions,
      size: nextSize,
      variant: nextVariant,
      mapStyleId: nextStyle,
      textFont: nextFont,
      // Hydrate location, zoom, shape, labels, bg from template on first load
      ...(isFirstLoad && mapDefaults
        ? {
            mapCenter: mapDefaults.center,
            mapZoom: mapDefaults.zoom,
            mapShape: mapDefaults.shape as MapShape,
            showLabels: mapDefaults.showLabels,
          }
        : {}),
      ...(isFirstLoad && layout?.background?.color
        ? { posterBgColor: layout.background.color }
        : {}),
    });
  },
  setMapCenter: (mapCenter) => set({ mapCenter }),
  setMapZoom: (mapZoom) => set({ mapZoom }),
  setMapStyleId: (mapStyleId) => set({ mapStyleId }),
  setPlaceName: (placeName) => set({ placeName }),
  setShowLabels: (showLabels) => set({ showLabels }),
  setMapShape: (mapShape) => set({ mapShape }),
  setPosterBgColor: (posterBgColor) => set({ posterBgColor }),
  setText: (text) => set({ text, textIsCustom: true }),
  setTextFont: (textFont) => set({ textFont }),
  setTextVisible: (textVisible) => set({ textVisible }),
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
  setOrientation: (orientation) => set({ orientation }),

  setPhotoSource: (file, previewUrl) => {
    set({
      photoFile: file,
      photoPreviewUrl: previewUrl,
      designSource: file ? "photo" : "map",
      aiPrintFileUrl: file ? null : get().aiPrintFileUrl,
    });
  },
  setAiPrintFileUrl: (url) => {
    set({ aiPrintFileUrl: url, designSource: url ? "ai" : "map" });
  },
  resetDesignSource: () =>
    set({ designSource: "map", photoFile: null, photoPreviewUrl: null, aiPrintFileUrl: null }),

  applyPlace: (args) => {
    const isCustom = get().textIsCustom;
    set({
      mapCenter: args.center,
      placeName: args.placeName,
      city: args.city,
      country: args.country,
      ...(isCustom ? {} : { text: buildAutoText(args) }),
    });
  },

  // Used when user pans/zooms map: don't move center (already moved), just refresh metadata
  updateFromMap: (args) => {
    const isCustom = get().textIsCustom;
    set({
      placeName: args.placeName,
      city: args.city,
      country: args.country,
      ...(isCustom ? {} : { text: buildAutoText(args) }),
    });
  },

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
}));
