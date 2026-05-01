import type { ProductType } from "@/lib/product-config";

import canvasCorner from "@/assets/product-details/canvas-corner.webp";
import canvasBack from "@/assets/product-details/canvas-back.webp";
import posterPaper from "@/assets/product-details/poster-paper.webp";
import posterFrames from "@/assets/product-details/poster-frames.webp";
import aluminumEdge from "@/assets/product-details/aluminum-edge.webp";
import aluminumMount from "@/assets/product-details/aluminum-mount.webp";
import acrylicStud from "@/assets/product-details/acrylic-stud.webp";
import acrylicMount from "@/assets/product-details/acrylic-mount.webp";

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
  { id: "poster-frames", label: "Ramval", src: posterFrames },
];

const CANVAS_DETAILS: ProductDetail[] = [
  { id: "canvas-corner", label: "Hörndetalj", src: canvasCorner },
  { id: "canvas-back", label: "Baksida & upphängning", src: canvasBack },
];

const ALUMINUM_DETAILS: ProductDetail[] = [
  { id: "aluminum-edge", label: "Kantdetalj", src: aluminumEdge },
  { id: "aluminum-mount", label: "Montering", src: aluminumMount },
];

const ACRYLIC_DETAILS: ProductDetail[] = [
  { id: "acrylic-stud", label: "Skruvhörn", src: acrylicStud },
  { id: "acrylic-mount", label: "Montering", src: acrylicMount },
];

export function getProductDetailsFor(productType: ProductType): ProductDetail[] {
  if (productType === "canvas") return CANVAS_DETAILS;
  if (productType === "aluminum") return ALUMINUM_DETAILS;
  if (productType === "acrylic") return ACRYLIC_DETAILS;
  return POSTER_DETAILS;
}
