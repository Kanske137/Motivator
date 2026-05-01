import type { ProductType } from "@/lib/product-config";

import canvasCorner from "@/assets/product-details/canvas-corner.webp";
import canvasBack from "@/assets/product-details/canvas-back.webp";
import posterPaper from "@/assets/product-details/poster-paper.webp";

/**
 * Statiska "produktdetalj"-thumbnails som visas sist i mockup-galleriet.
 * Bilderna är generiska närbilder av produkten (inte motivspecifika) och
 * visas både som thumbnail och i lightboxen utan composit.
 */
export interface ProductDetail {
  id: string;
  label: string;
  src: string;
}

const POSTER_DETAILS: ProductDetail[] = [
  { id: "poster-paper", label: "Pappersdetalj", src: posterPaper },
];

const CANVAS_DETAILS: ProductDetail[] = [
  { id: "canvas-corner", label: "Hörndetalj", src: canvasCorner },
  { id: "canvas-back", label: "Baksida & upphängning", src: canvasBack },
];

export function getProductDetailsFor(productType: ProductType): ProductDetail[] {
  if (productType === "canvas") return CANVAS_DETAILS;
  // Aluminium/akryl saknar egna detaljbilder än — visa poster-pappret som platshållare.
  return POSTER_DETAILS;
}
