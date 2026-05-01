import type { ProductType } from "./product-config";

import livingroom from "@/assets/mockups/poster-livingroom.jpg";
import bedroom from "@/assets/mockups/poster-bedroom.jpg";
import office from "@/assets/mockups/poster-office.jpg";
import wall from "@/assets/mockups/poster-wall.jpg";
import canvasFront from "@/assets/mockups/canvas-front.jpg";
import canvasRight from "@/assets/mockups/canvas-right.jpg";
import canvasLeft from "@/assets/mockups/canvas-left.jpg";
import canvasBottom from "@/assets/mockups/canvas-bottom.jpg";

/**
 * Mockup-scen för composit på klienten.
 *
 * Bilderna är 1024x1024. `area` definierar väggytan (i scen-pixlar) inom
 * vilken postern centreras. `referenceWidthCm` = hur många cm av en
 * verklig vägg som area.w motsvarar — så postern skalas trovärdigt.
 *
 * För canvas: `viewKey` pekar på vilken pre-renderad Three.js-vy som ska
 * användas (front/right/left/bottom). Varje canvas-scen är fotograferad
 * från SAMMA vinkel som motsvarande Three.js-kamera, så perspektiven
 * matchar — canvasen ser ut att hänga på den fotograferade väggen.
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
  /** Endast canvas: vilken pre-renderad 3D-vy som ska komponeras in. */
  viewKey?: "front" | "right" | "left" | "bottom";
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

/**
 * Canvas-scener: fyra fotograferade tomma rum från olika vinklar. Den
 * pre-renderade Three.js-canvasen (med transparent bakgrund) komponeras
 * in i `area`. Eftersom rummet är fotograferat från samma vinkel som
 * Three.js-kameran, ser canvasen ut att hänga naturligt på väggen.
 *
 * `area`-rektanglar är finjusterade per bild så de hamnar mitt på den
 * tomma väggytan (där en riktig tavla skulle hänga, ögonhöjd).
 */
const CANVAS_SCENES: MockupScene[] = [
  {
    id: "canvas-front",
    label: "Framifrån",
    src: canvasFront,
    area: { x: 360, y: 230, w: 420, h: 480 },
    referenceWidthCm: 130,
    shadow: { blur: 30, offsetY: 14, alpha: 0.22 },
    viewKey: "front",
  },
  {
    id: "canvas-right",
    label: "Från höger",
    src: canvasRight,
    area: { x: 280, y: 240, w: 380, h: 440 },
    referenceWidthCm: 130,
    shadow: { blur: 28, offsetY: 14, alpha: 0.22 },
    viewKey: "right",
  },
  {
    id: "canvas-left",
    label: "Från vänster",
    src: canvasLeft,
    area: { x: 380, y: 240, w: 380, h: 440 },
    referenceWidthCm: 130,
    shadow: { blur: 28, offsetY: 14, alpha: 0.22 },
    viewKey: "left",
  },
  {
    id: "canvas-bottom",
    label: "Underifrån",
    src: canvasBottom,
    area: { x: 320, y: 220, w: 420, h: 380 },
    referenceWidthCm: 140,
    shadow: { blur: 32, offsetY: 16, alpha: 0.24 },
    viewKey: "bottom",
  },
];

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
