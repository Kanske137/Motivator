import { create } from "zustand";
import type { Orientation, ProductConfig } from "@/lib/product-config";

interface ApplyPlaceArgs {
  placeName: string;
  center: [number, number];
  city?: string;
  country?: string;
}

export type MapShape = "rect" | "square" | "circle";

interface EditorState {
  config: ProductConfig | null;

  // map
  mapCenter: [number, number]; // [lng, lat]
  mapZoom: number;
  mapStyleId: string;
  placeName: string;
  city?: string;
  country?: string;
  showLabels: boolean;
  mapShape: MapShape;

  // text
  text: string;
  textFont: string;
  textVisible: boolean;
  textIsCustom: boolean;

  // format
  size: string | null;
  variant: string | null;
  orientation: Orientation;

  // setters
  setConfig: (c: ProductConfig) => void;
  setMapCenter: (c: [number, number]) => void;
  setMapZoom: (z: number) => void;
  setMapStyleId: (s: string) => void;
  setPlaceName: (n: string) => void;
  setShowLabels: (v: boolean) => void;
  setMapShape: (s: MapShape) => void;
  setText: (t: string) => void;
  setTextFont: (f: string) => void;
  setTextVisible: (v: boolean) => void;
  setSize: (s: string) => void;
  setVariant: (v: string) => void;
  setOrientation: (o: Orientation) => void;
  applyPlace: (args: ApplyPlaceArgs) => void;
  updateFromMap: (args: ApplyPlaceArgs) => void;

  // computed
  currentPrice: () => number;
  currentLayout: () => ProductConfig["layouts"]["portrait"] | null;
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
  mapCenter: [18.0686, 59.3293], // Stockholm
  mapZoom: 12,
  mapStyleId: "light-v11",
  placeName: "Stockholm, Sverige",
  city: "Stockholm",
  country: "Sverige",
  showLabels: false,
  mapShape: "rect",

  text: "STOCKHOLM\nSverige\n59.3293°N · 18.0686°E",
  textFont: "Inter",
  textVisible: true,
  textIsCustom: false,

  size: null,
  variant: null,
  orientation: "portrait",

  setConfig: (config) => {
    const firstSize = config.sizes[0];
    const firstVariant = firstSize?.variants[0];
    set({
      config,
      mapStyleId: config.map_styles[0] ?? "light-v11",
      textFont: config.text_config.defaultFont ?? "Inter",
      size: get().size && config.sizes.find((s) => s.size === get().size) ? get().size : firstSize?.size ?? null,
      variant:
        get().variant && firstSize?.variants.find((v) => v.name === get().variant)
          ? get().variant
          : firstVariant?.name ?? null,
    });
  },
  setMapCenter: (mapCenter) => set({ mapCenter }),
  setMapZoom: (mapZoom) => set({ mapZoom }),
  setMapStyleId: (mapStyleId) => set({ mapStyleId }),
  setPlaceName: (placeName) => set({ placeName }),
  setShowLabels: (showLabels) => set({ showLabels }),
  setMapShape: (mapShape) => set({ mapShape }),
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
}));
