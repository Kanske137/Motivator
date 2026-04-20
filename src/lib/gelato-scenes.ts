import type { ProductType } from "./product-config";

export interface GelatoScene {
  label: string;
  mockupSceneId: string;
}

// NOTE: Gelato kräver giltiga mockupSceneId-värden per produkt.
// Dessa är platshållare baserade på Gelatos vanliga scen-namn för flat posters/canvas.
// Om en scen inte finns för en specifik productUid faller funktionen tillbaka i UI.
export const GELATO_SCENES: Record<ProductType, GelatoScene[]> = {
  posters: [
    { label: "Vardagsrum", mockupSceneId: "living-room" },
    { label: "Sovrum", mockupSceneId: "bedroom" },
    { label: "Kontor", mockupSceneId: "office" },
    { label: "På vägg", mockupSceneId: "wall" },
  ],
  canvas: [
    { label: "Vardagsrum", mockupSceneId: "living-room" },
    { label: "Sovrum", mockupSceneId: "bedroom" },
    { label: "Sidovy", mockupSceneId: "side-view" },
    { label: "Närbild", mockupSceneId: "close-up" },
  ],
};

export function getScenesFor(productType: ProductType): GelatoScene[] {
  return GELATO_SCENES[productType] ?? GELATO_SCENES.posters;
}
