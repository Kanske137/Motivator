import type { ProductType } from "@/lib/product-config";

import canvasCorner from "@/assets/product-details/canvas-corner.webp";
import canvasBack from "@/assets/product-details/canvas-back.webp";
import posterPaper from "@/assets/product-details/poster-paper.webp";
import posterFrames from "@/assets/product-details/poster-frames.webp";
import aluminumEdge from "@/assets/product-details/aluminum-edge.webp";
import aluminumMount from "@/assets/product-details/aluminum-mount.webp";
import acrylicStud from "@/assets/product-details/acrylic-stud.webp";
import acrylicMount from "@/assets/product-details/acrylic-mount.webp";

export interface ProductDetail {
  id: string;
  /** i18n key — translate at render time. */
  labelKey: string;
  src: string;
}

const POSTER_DETAILS: ProductDetail[] = [
  { id: "poster-paper", labelKey: "detail.posterPaper", src: posterPaper },
  { id: "poster-frames", labelKey: "detail.posterFrames", src: posterFrames },
];

const CANVAS_DETAILS: ProductDetail[] = [
  { id: "canvas-corner", labelKey: "detail.canvasCorner", src: canvasCorner },
  { id: "canvas-back", labelKey: "detail.canvasBack", src: canvasBack },
];

const ALUMINUM_DETAILS: ProductDetail[] = [
  { id: "aluminum-edge", labelKey: "detail.aluminumEdge", src: aluminumEdge },
  { id: "aluminum-mount", labelKey: "detail.aluminumMount", src: aluminumMount },
];

const ACRYLIC_DETAILS: ProductDetail[] = [
  { id: "acrylic-stud", labelKey: "detail.acrylicStud", src: acrylicStud },
  { id: "acrylic-mount", labelKey: "detail.acrylicMount", src: acrylicMount },
];

export function getProductDetailsFor(productType: ProductType): ProductDetail[] {
  if (productType === "canvas") return CANVAS_DETAILS;
  if (productType === "aluminum") return ALUMINUM_DETAILS;
  if (productType === "acrylic") return ACRYLIC_DETAILS;
  return POSTER_DETAILS;
}
