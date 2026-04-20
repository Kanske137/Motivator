// Pricing-tabeller (SEK) speglar Shopify-produkterna
export const POSTER_SIZES = ["13x18", "21x30", "30x40", "40x50", "50x70", "70x100"] as const;
export const POSTER_FRAMES = ["Ingen", "Vit", "Svart", "Ek", "Valnöt"] as const;

export const POSTER_PRICES: Record<string, Record<string, number>> = {
  "13x18": { Ingen: 199, Vit: 349, Svart: 349, Ek: 369, Valnöt: 369 },
  "21x30": { Ingen: 239, Vit: 399, Svart: 399, Ek: 429, Valnöt: 429 },
  "30x40": { Ingen: 259, Vit: 559, Svart: 559, Ek: 589, Valnöt: 589 },
  "40x50": { Ingen: 289, Vit: 749, Svart: 749, Ek: 789, Valnöt: 789 },
  "50x70": { Ingen: 329, Vit: 919, Svart: 919, Ek: 969, Valnöt: 969 },
  "70x100": { Ingen: 429, Vit: 1249, Svart: 1249, Ek: 1299, Valnöt: 1299 },
};

export const CANVAS_SIZES = ["20x25", "20x30", "30x40", "40x50", "40x60", "50x70", "60x80", "70x100"] as const;
export const CANVAS_DEPTHS = ["2cm", "4cm"] as const;

export const CANVAS_PRICES: Record<string, Record<string, number>> = {
  "20x25": { "2cm": 299, "4cm": 319 },
  "20x30": { "2cm": 349, "4cm": 379 },
  "30x40": { "2cm": 449, "4cm": 489 },
  "40x50": { "2cm": 599, "4cm": 649 },
  "40x60": { "2cm": 699, "4cm": 759 },
  "50x70": { "2cm": 799, "4cm": 869 },
  "60x80": { "2cm": 999, "4cm": 1099 },
  "70x100": { "2cm": 1299, "4cm": 1399 },
};

export const STYLE_PRESETS = [
  { id: "none", label: "Original", prompt: "" },
  { id: "watercolor", label: "Akvarell", prompt: "Transform this image into a soft watercolor painting with delicate brush strokes and pastel colors, preserving the composition." },
  { id: "minimal-line", label: "Minimal linje", prompt: "Convert this image into a minimal single-line drawing with clean black lines on white background." },
  { id: "vintage-poster", label: "Vintage poster", prompt: "Transform this image into a vintage travel poster style with bold flat colors, art deco influences." },
  { id: "oil-painting", label: "Oljemålning", prompt: "Transform this image into a classical oil painting with rich textures and dramatic lighting." },
  { id: "sketch", label: "Skiss", prompt: "Convert this image into a detailed pencil sketch with cross-hatching and shading." },
  { id: "anime", label: "Anime", prompt: "Transform this image into anime / manga illustration style with cel shading." },
];
