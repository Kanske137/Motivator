import type { ProductType } from "./product-config";

import livingroom from "@/assets/mockups/poster-livingroom.jpg";
import bedroom from "@/assets/mockups/poster-bedroom.jpg";
import office from "@/assets/mockups/poster-office.jpg";
import wall from "@/assets/mockups/poster-wall.jpg";
import canvasLivingroom from "@/assets/mockups/canvas-livingroom.jpg";
import canvasSide from "@/assets/mockups/canvas-side.jpg";

/**
 * Mockup-scen för composit på klienten.
 *
 * Bilderna är 1024x1024. `area` definierar väggytan (i scen-pixlar) inom
 * vilken postern centreras. `referenceWidthCm` = hur många cm av en
 * verklig vägg som area.w motsvarar — så postern skalas trovärdigt.
 *
 * För canvas: `canvasWrap.angleDeg` används för perspektivlutning + djup-strip.
 */
export interface MockupScene {
  id: string;
  label: string;
  src: string;
  /** Tom väggyta i scenens pixelkoordinater (1024-bas). */
  area: { x: number; y: number; w: number; h: number };
  /** Hur många cm i verkligheten som area.w motsvarar. */
  referenceWidthCm: number;
  /** Skugga under postern. */
  shadow?: { blur: number; offsetY: number; alpha: number };
  /** Endast canvas: rita 3D-djup på höger sida. */
  canvasWrap?: { angleDeg: number };
}

const POSTER_SCENES: MockupScene[] = [
  {
    id: "livingroom",
    label: "Vardagsrum",
    src: livingroom,
    area: { x: 180, y: 110, w: 680, h: 600 },
    referenceWidthCm: 120,
    shadow: { blur: 22, offsetY: 10, alpha: 0.18 },
  },
  {
    id: "bedroom",
    label: "Sovrum",
    src: bedroom,
    area: { x: 180, y: 80, w: 700, h: 600 },
    referenceWidthCm: 130,
    shadow: { blur: 24, offsetY: 12, alpha: 0.16 },
  },
  {
    id: "office",
    label: "Kontor",
    src: office,
    area: { x: 140, y: 80, w: 760, h: 660 },
    referenceWidthCm: 140,
    shadow: { blur: 18, offsetY: 8, alpha: 0.15 },
  },
  {
    id: "wall",
    label: "På vägg",
    src: wall,
    area: { x: 120, y: 80, w: 800, h: 700 },
    referenceWidthCm: 130,
    shadow: { blur: 26, offsetY: 14, alpha: 0.20 },
  },
];

const CANVAS_SCENES: MockupScene[] = [];

export function getScenesFor(productType: ProductType): MockupScene[] {
  return productType === "canvas" ? CANVAS_SCENES : POSTER_SCENES;
}

/** Parse "21x30" / "50x70" → {wCm, hCm}. */
export function parseSizeCm(size: string): { wCm: number; hCm: number } | null {
  const m = size.match(/(\d+)\s*x\s*(\d+)/i);
  if (!m) return null;
  return { wCm: parseInt(m[1], 10), hCm: parseInt(m[2], 10) };
}

/** Mappa variant-namn → ramfärg (hex) eller null om ingen ram. */
export function frameColorFromVariant(variant: string | null | undefined): string | null {
  if (!variant) return null;
  const v = variant.toLowerCase();
  if (v.includes("ingen") || v.includes("no frame") || v.includes("utan ram")) return null;
  if (v.includes("svart") || v.includes("black")) return "#1a1a1a";
  if (v.includes("vit") || v.includes("white")) return "#f5f5f2";
  if (v.includes("ek") || v.includes("oak")) return "#c8a371";
  if (v.includes("valnöt") || v.includes("walnut")) return "#5a3a26";
  if (v.includes("ram") || v.includes("frame")) return "#1a1a1a";
  return null;
}
