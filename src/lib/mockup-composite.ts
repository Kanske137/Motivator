import type { MockupScene } from "./mockup-scenes";
import { parseSizeCm } from "./mockup-scenes";
import type { Orientation, ProductType } from "./product-config";

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
  /** Posters: print-snapshot. Canvas: ignoreras (vi använder prerenderedCanvasPng). */
  printUrl: string;
  size: string;
  orientation: Orientation;
  productType: ProductType;
  /** Hex-färg för ram, eller null för ingen ram (poster). */
  frameColor?: string | null;
  /** Ramens bredd i cm (verklig). Standard 2.5. */
  frameWidthCm?: number;
  /**
   * Endast canvas: en pre-renderad transparent PNG av canvasen från rätt
   * vinkel (matchar `scene.viewKey`). Genereras av `renderCanvas3DViews`.
   */
  prerenderedCanvasPng?: string;
}

export async function compositeMockup({
  scene,
  printUrl,
  size,
  orientation,
  productType,
  frameColor = null,
  frameWidthCm = 2.5,
  prerenderedCanvasPng,
}: CompositArgs): Promise<string> {
  const sizeCm = parseSizeCm(size);
  if (!sizeCm) throw new Error(`Ogiltig storlek: ${size}`);

  const realWcm = orientation === "landscape" ? sizeCm.hCm : sizeCm.wCm;
  const realHcm = orientation === "landscape" ? sizeCm.wCm : sizeCm.hCm;

  // ============ CANVAS-VÄG ============
  // Helt separat från poster-logiken: vi har redan en perspektiv-korrekt
  // pre-renderad PNG med transparent bakgrund. Bara composit på fotot.
  if (productType === "canvas") {
    if (!prerenderedCanvasPng) {
      throw new Error("Canvas-mockup kräver en pre-renderad PNG");
    }
    const [bg, fg] = await Promise.all([
      loadImage(scene.src, false),
      loadImage(prerenderedCanvasPng, false),
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = bg.naturalWidth;
    canvas.height = bg.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kunde inte skapa 2D-context");

    const sceneBase = 1024;
    const sx = bg.naturalWidth / sceneBase;
    const sy = bg.naturalHeight / sceneBase;
    const area = {
      x: scene.area.x * sx,
      y: scene.area.y * sy,
      w: scene.area.w * sx,
      h: scene.area.h * sy,
    };

    // 1. Bakgrund (rummet)
    ctx.drawImage(bg, 0, 0);

    // 2. Skala canvasen efter REAL-bredd vs scenens referensbredd, så en
    // 50 cm canvas ser större ut än en 30 cm canvas på samma vägg.
    // Den pre-renderade PNG:en innehåller hela "bounding box" runt canvasen
    // (front + synliga sidor), så vi behåller PNG:ns proportioner.
    const targetFrontW = (realWcm / scene.referenceWidthCm) * area.w;
    const pngAspect = fg.naturalWidth / fg.naturalHeight;
    // Frontens andel av PNG:n varierar med vy, men eftersom hela PNG:n är
    // tight croppad runt canvasen kan vi bara skala hela till mål-bredden
    // och låta höjden följa naturligt.
    let drawW = targetFrontW * 1.15; // +15% headroom för synliga sidor
    let drawH = drawW / pngAspect;

    // Säkerställ att PNG:n inte sprängs ur väggområdet
    const maxH = area.h * 1.05;
    if (drawH > maxH) {
      const s = maxH / drawH;
      drawH *= s;
      drawW *= s;
    }
    const maxW = area.w * 1.15;
    if (drawW > maxW) {
      const s = maxW / drawW;
      drawW *= s;
      drawH *= s;
    }

    const cx = area.x + (area.w - drawW) / 2;
    const cy = area.y + (area.h - drawH) / 2;

    // 3. Mjuk skugga på väggen bakom canvasen
    if (scene.shadow) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${scene.shadow.alpha})`;
      ctx.shadowBlur = scene.shadow.blur;
      ctx.shadowOffsetY = scene.shadow.offsetY;
      ctx.fillStyle = `rgba(0,0,0,${scene.shadow.alpha})`;
      // Skuggrektangel approximerar canvasens silhuett (något indragen)
      ctx.fillRect(cx + drawW * 0.06, cy + drawH * 0.06, drawW * 0.88, drawH * 0.88);
      ctx.restore();
    }

    // 4. Den pre-renderade canvasen
    ctx.drawImage(fg, cx, cy, drawW, drawH);

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  // ============ POSTER-VÄG (oförändrad) ============
  const [bg, fg] = await Promise.all([
    loadImage(scene.src, false),
    loadImage(printUrl, true),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = bg.naturalWidth;
  canvas.height = bg.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte skapa 2D-context");

  const sceneBase = 1024;
  const sx = bg.naturalWidth / sceneBase;
  const sy = bg.naturalHeight / sceneBase;
  const area = {
    x: scene.area.x * sx,
    y: scene.area.y * sy,
    w: scene.area.w * sx,
    h: scene.area.h * sy,
  };

  // 1. Bakgrund
  ctx.drawImage(bg, 0, 0);

  // 2. Poster-pixelstorlek inom area
  let posterW = (realWcm / scene.referenceWidthCm) * area.w;
  let posterH = posterW * (realHcm / realWcm);

  const frameWpx = frameColor
    ? (frameWidthCm / scene.referenceWidthCm) * area.w
    : 0;

  const totalW = posterW + frameWpx * 2;
  const totalH = posterH + frameWpx * 2;
  if (totalH > area.h) {
    const s = area.h / totalH;
    posterH *= s; posterW *= s;
  }
  if (totalW > area.w) {
    const s = area.w / totalW;
    posterW *= s; posterH *= s;
  }

  const innerW = posterW;
  const innerH = posterH;
  const outerW = innerW + frameWpx * 2;
  const outerH = innerH + frameWpx * 2;

  const ox = area.x + (area.w - outerW) / 2;
  const oy = area.y + (area.h - outerH) / 2;
  const px = ox + frameWpx;
  const py = oy + frameWpx;

  // 3. Skugga
  if (scene.shadow) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowColor = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowBlur = scene.shadow.blur;
    ctx.shadowOffsetY = scene.shadow.offsetY;
    ctx.fillRect(ox, oy, outerW, outerH);
    ctx.restore();
  }

  // 4. Ram (endast poster med vald färg)
  if (frameColor && frameWpx > 0) {
    ctx.save();
    ctx.fillStyle = frameColor;
    ctx.fillRect(ox, oy, outerW, outerH);

    const grad = ctx.createLinearGradient(ox, oy, ox + outerW, oy + outerH);
    grad.addColorStop(0, "rgba(255,255,255,0.18)");
    grad.addColorStop(0.5, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, outerW, outerH);

    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, frameWpx * 0.08);
    ctx.strokeRect(px - 0.5, py - 0.5, innerW + 1, innerH + 1);
    ctx.restore();
  }

  // 5. Front: postern själv
  ctx.drawImage(fg, px, py, posterW, posterH);

  // 6. Diskret skugga i hörnen för att binda postern mot väggen
  ctx.save();
  const cornerGrad = ctx.createRadialGradient(
    px + posterW / 2, py + posterH / 2, posterW * 0.4,
    px + posterW / 2, py + posterH / 2, posterW * 0.7,
  );
  cornerGrad.addColorStop(0, "rgba(0,0,0,0)");
  cornerGrad.addColorStop(1, "rgba(0,0,0,0.08)");
  ctx.fillStyle = cornerGrad;
  ctx.fillRect(px, py, posterW, posterH);
  ctx.restore();

  return canvas.toDataURL("image/jpeg", 0.9);
}
