import { create } from "zustand";
import skuMap from "@/lib/gelato-sku-map.json";

export type ProductType = "posters" | "canvas";
export type Orientation = "portrait" | "landscape";
export type Step = "product" | "image" | "map" | "text" | "style" | "size" | "mockup";

export interface SizeOption {
  size: string;
  variant: string; // ram-namn för posters, djup för canvas
  price: number;
  variantId?: string; // Shopify variant id (gid://...)
}

interface EditorState {
  step: Step;
  productType: ProductType | null;
  imageUrl: string | null; // original-uppladdad
  styledImageUrl: string | null; // efter AI-stil
  finalImageUrl: () => string | null;
  mapAddress: string | null;
  mapCoords: { lat: number; lng: number } | null;
  text: string;
  stylePreset: string | null;
  size: string | null; // ex "30x40"
  variant: string | null; // ex "Svart" eller "2cm"
  orientation: Orientation;
  mockupUrl: string | null;

  setStep: (s: Step) => void;
  next: () => void;
  back: () => void;
  setProductType: (t: ProductType) => void;
  setImageUrl: (u: string | null) => void;
  setStyledImageUrl: (u: string | null) => void;
  setMap: (address: string, coords: { lat: number; lng: number }) => void;
  clearMap: () => void;
  setText: (t: string) => void;
  setStylePreset: (s: string | null) => void;
  setSize: (size: string, variant: string) => void;
  setOrientation: (o: Orientation) => void;
  setMockupUrl: (u: string | null) => void;
  reset: () => void;
  getGelatoUid: () => string | null;
}

const ORDER: Step[] = ["product", "image", "map", "text", "style", "size", "mockup"];

const initial = {
  step: "product" as Step,
  productType: null,
  imageUrl: null,
  styledImageUrl: null,
  mapAddress: null,
  mapCoords: null,
  text: "",
  stylePreset: null,
  size: null,
  variant: null,
  orientation: "portrait" as Orientation,
  mockupUrl: null,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initial,

  finalImageUrl: () => get().styledImageUrl || get().imageUrl,
  setStep: (step) => set({ step }),
  next: () => {
    const idx = ORDER.indexOf(get().step);
    if (idx < ORDER.length - 1) set({ step: ORDER[idx + 1] });
  },
  back: () => {
    const idx = ORDER.indexOf(get().step);
    if (idx > 0) set({ step: ORDER[idx - 1] });
  },
  setProductType: (productType) => set({ productType, size: null, variant: null }),
  setImageUrl: (imageUrl) => set({ imageUrl, styledImageUrl: null, mockupUrl: null }),
  setStyledImageUrl: (styledImageUrl) => set({ styledImageUrl, mockupUrl: null }),
  setMap: (mapAddress, mapCoords) => set({ mapAddress, mapCoords }),
  clearMap: () => set({ mapAddress: null, mapCoords: null }),
  setText: (text) => set({ text }),
  setStylePreset: (stylePreset) => set({ stylePreset }),
  setSize: (size, variant) => set({ size, variant, mockupUrl: null }),
  setOrientation: (orientation) => set({ orientation, mockupUrl: null }),
  setMockupUrl: (mockupUrl) => set({ mockupUrl }),
  reset: () => set(initial),

  getGelatoUid: () => {
    const { productType, size, variant, orientation } = get();
    if (!productType || !size || !variant) return null;
    const map = (skuMap as Record<string, Record<string, Record<string, string>>>)[productType];
    return map?.[`${size}|${variant}`]?.[orientation] || null;
  },
}));
