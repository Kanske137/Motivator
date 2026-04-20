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
 * Varje scen är en bild på 1280x1280 px. `area` definierar var vi placerar
 * postern (centrerad inom denna ruta, behåller poster-aspect).
 *
 * `referenceWidthCm` = hur många cm på en riktig vägg som `area.w` motsvarar.
 * Det låter oss skala postern proportionellt mot vald storlek.
 *
 * För canvas: `wrapAngleDeg` ger en perspektivlutning + `wrapDepthCm` ritar
 * en sidoremsa som simulerar djupet (2 cm eller 4 cm).
 */
export interface MockupScene {
  id: string;
  label: string;
  src: string;
  /** Poster-areas i scenens pixelkoordinater (1280x1280-bas). */
  area: { x: number; y: number; w: number; h: number };
  /** Hur många cm i verkligheten som area.w motsvarar (för storleksjämförelse). */
  referenceWidthCm: number;
  /** Skugga under postern (px). */
  shadow?: { blur: number; offsetY: number; alpha: number };
  /** Endast canvas: rita 3D-djup på höger sida. */
  canvasWrap?: {
    /** Lutning i grader (positiv = höger sida vinklad bort från betraktaren). */
    angleDeg: number;
  };
}

const POSTER_SCENES: MockupScene[] = [
  {
    id: "livingroom",
    label: "Vardagsrum",
    src: livingroom,
    area: { x: 320, y: 240, w: 640, h: 700 },
    referenceWidthCm: 70,
    shadow: { blur: 18, offsetY: 8, alpha: 0.18 },
  },
  {
    id: "bedroom",
    label: "Sovrum",
    src: bedroom,
    area: { x: 300, y: 180, w: 680, h: 620,  },
    referenceWidthCm: 75,
    shadow: { blur: 22, offsetY: 10, alpha: 0.16 },
  },
  {
    id: "office",
    label: "Kontor",
    src: office,
    area: { x: 380, y: 250, w: 520, h: 600 },
    referenceWidthCm: 55,
    shadow: { blur: 14, offsetY: 6, alpha: 0.14 },
  },
  {
    id: "wall",
    label: "På vägg",
    src: wall,
    area: { x: 280, y: 200, w: 720, h: 880 },
    referenceWidthCm: 80,
    shadow: { blur: 20, offsetY: 10, alpha: 0.20 },
  },
];

const CANVAS_SCENES: MockupScene[] = [
  {
    id: "canvas-livingroom",
    label: "Vardagsrum",
    src: canvasLivingroom,
    area: { x: 350, y: 260, w: 600, h: 580 },
    referenceWidthCm: 70,
    shadow: { blur: 24, offsetY: 14, alpha: 0.22 },
    canvasWrap: { angleDeg: 6 },
  },
  {
    id: "canvas-side",
    label: "Sidovy",
    src: canvasSide,
    area: { x: 320, y: 240, w: 580, h: 700 },
    referenceWidthCm: 60,
    shadow: { blur: 28, offsetY: 16, alpha: 0.25 },
    canvasWrap: { angleDeg: 18 },
  },
  {
    id: "canvas-bedroom",
    label: "Sovrum",
    src: bedroom,
    area: { x: 300, y: 180, w: 680, h: 620 },
    referenceWidthCm: 75,
    shadow: { blur: 24, offsetY: 14, alpha: 0.20 },
    canvasWrap: { angleDeg: 4 },
  },
  {
    id: "canvas-wall",
    label: "Närbild",
    src: wall,
    area: { x: 280, y: 200, w: 720, h: 880 },
    referenceWidthCm: 70,
    shadow: { blur: 26, offsetY: 14, alpha: 0.22 },
    canvasWrap: { angleDeg: 10 },
  },
];

export function getScenesFor(productType: ProductType): MockupScene[] {
  return productType === "canvas" ? CANVAS_SCENES : POSTER_SCENES;
}

/**
 * Parse "21x30" eller "50x70" till {wCm, hCm}.
 */
export function parseSizeCm(size: string): { wCm: number; hCm: number } | null {
  const m = size.match(/(\d+)\s*x\s*(\d+)/i);
  if (!m) return null;
  return { wCm: parseInt(m[1], 10), hCm: parseInt(m[2], 10) };
}
