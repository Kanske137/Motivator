import type { MockupScene } from "./mockup-scenes";
import { parseSizeCm } from "./mockup-scenes";
import type { Orientation, ProductType } from "./product-config";

/**
 * Ladda en bild som <img>. CORS för cross-origin (Supabase Storage).
 */
function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild kunde inte laddas: ${src}`));
    img.src = src;
  });
}

interface CompositArgs {
  scene: MockupScene;
  printUrl: string;
  size: string;
  orientation: Orientation;
  productType: ProductType;
  /** Endast canvas: 2 eller 4 (cm). */
  canvasDepthCm?: number;
}

/**
 * Compositera tryckfilen ovanpå scen-bilden och returnera en data-URL.
 *
 * Skala:
 *  - postern placeras inom `scene.area`
 *  - dess fysiska bredd i scenen = `size.wCm`
 *  - referensbredden för area = `scene.referenceWidthCm`
 *  - poster-bredd i px = (size.wCm / referenceWidthCm) * area.w
 *  - höjd följer aspect ratio från size
 *  - clamp:as så den aldrig växer utanför area
 */
export async function compositeMockup({
  scene,
  printUrl,
  size,
  orientation,
  productType,
  canvasDepthCm = 2,
}: CompositArgs): Promise<string> {
  const sizeCm = parseSizeCm(size);
  if (!sizeCm) throw new Error(`Ogiltig storlek: ${size}`);

  // För landscape: byt bredd/höjd
  const realWcm = orientation === "landscape" ? sizeCm.hCm : sizeCm.wCm;
  const realHcm = orientation === "landscape" ? sizeCm.wCm : sizeCm.hCm;

  const [bg, fg] = await Promise.all([
    loadImage(scene.src, false),
    loadImage(printUrl, true),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = bg.naturalWidth;
  canvas.height = bg.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte skapa 2D-context");

  // 1. Bakgrund
  ctx.drawImage(bg, 0, 0);

  // 2. Räkna ut poster-pixelstorlek inom area
  const { area } = scene;
  let posterW = (realWcm / scene.referenceWidthCm) * area.w;
  let posterH = posterW * (realHcm / realWcm);

  // Om för stor i höjd → clamp till area.h
  if (posterH > area.h) {
    const scale = area.h / posterH;
    posterH = area.h;
    posterW *= scale;
  }
  // Om för bred → clamp
  if (posterW > area.w) {
    const scale = area.w / posterW;
    posterW = area.w;
    posterH *= scale;
  }

  // Centrera inom area (vertikal toppjustering kan kännas naturligare i rum)
  const px = area.x + (area.w - posterW) / 2;
  const py = area.y + (area.h - posterH) / 2;

  // 3. Skugga
  if (scene.shadow) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowColor = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowBlur = scene.shadow.blur;
    ctx.shadowOffsetY = scene.shadow.offsetY;
    ctx.fillRect(px, py, posterW, posterH);
    ctx.restore();
  }

  // 4. Canvas wrap (3D-djup på höger sida)
  if (productType === "canvas" && scene.canvasWrap) {
    // Djup i px = (canvasDepthCm / referenceWidthCm) * area.w
    const depthPx = (canvasDepthCm / scene.referenceWidthCm) * area.w;
    const angle = (scene.canvasWrap.angleDeg * Math.PI) / 180;
    const sideW = depthPx * Math.cos(angle);
    const sideTopOffset = depthPx * Math.sin(angle) * 0.5;

    // Rita höger sidoremsa - mörkare version av högra kanten av printen
    // Vi sampler kantbild via clipping
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px + posterW, py);
    ctx.lineTo(px + posterW + sideW, py - sideTopOffset);
    ctx.lineTo(px + posterW + sideW, py + posterH - sideTopOffset);
    ctx.lineTo(px + posterW, py + posterH);
    ctx.closePath();
    ctx.clip();
    // Stretch en smal vertical strip från högra kanten av fg
    const stripSrcW = Math.max(2, fg.naturalWidth * 0.02);
    ctx.drawImage(
      fg,
      fg.naturalWidth - stripSrcW, 0, stripSrcW, fg.naturalHeight,
      px + posterW, py - sideTopOffset, sideW, posterH,
    );
    // Mörka sidan något
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(px + posterW, py - sideTopOffset, sideW, posterH + sideTopOffset * 2);
    ctx.restore();
  }

  // 5. Postern själv (med ev. perspektivlutning för canvas)
  if (productType === "canvas" && scene.canvasWrap && scene.canvasWrap.angleDeg !== 0) {
    const angle = (scene.canvasWrap.angleDeg * Math.PI) / 180;
    const skewY = Math.tan(angle) * 0.15; // mild lutning
    ctx.save();
    ctx.transform(1, 0, skewY, 1, px - py * skewY, 0);
    ctx.drawImage(fg, px, py, posterW, posterH);
    ctx.restore();
  } else {
    ctx.drawImage(fg, px, py, posterW, posterH);
  }

  return canvas.toDataURL("image/jpeg", 0.88);
}
