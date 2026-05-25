// Realistic wood textures for frame and hanger rendering.
// Mapped from the hex colors produced by frameColorFromVariant / hangerColorFromVariant
// in mockup-scenes.ts, so callers can keep passing hex without breaking changes.

import oakUrl from "@/assets/frame-textures/oak.jpg";
import walnutUrl from "@/assets/frame-textures/walnut.jpg";
import whiteUrl from "@/assets/frame-textures/white.jpg";
import blackUrl from "@/assets/frame-textures/black.jpg";

export function textureForHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const h = hex.toLowerCase();
  if (h === "#c8a371") return oakUrl;
  if (h === "#5a3a26") return walnutUrl;
  if (h === "#f5f5f2") return whiteUrl;
  if (h === "#1a1a1a") return blackUrl;
  return null;
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();

export function preloadTexture(url: string): Promise<HTMLImageElement> {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Texture load failed: ${url}`));
      img.src = url;
    });
    imgCache.set(url, p);
  }
  return p;
}

export function tryGetLoadedTexture(url: string): HTMLImageElement | null {
  const p = imgCache.get(url);
  if (!p) {
    // Kick off load for next time
    preloadTexture(url).catch(() => {});
    return null;
  }
  // Promise inspection: tag the resolved image onto a side channel.
  const anyP = p as Promise<HTMLImageElement> & { __img?: HTMLImageElement };
  return anyP.__img ?? null;
}

// Eagerly load on import so first paint of mockup composite has textures ready.
[oakUrl, walnutUrl, whiteUrl, blackUrl].forEach((u) => {
  preloadTexture(u).then((img) => {
    const p = imgCache.get(u) as (Promise<HTMLImageElement> & { __img?: HTMLImageElement }) | undefined;
    if (p) p.__img = img;
  }).catch(() => {});
});
