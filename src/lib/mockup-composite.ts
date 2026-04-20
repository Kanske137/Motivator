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
  printUrl: string;
  size: string;
  orientation: Orientation;
  productType: ProductType;
  /** Endast canvas: 2 eller 4 (cm). */
  canvasDepthCm?: number;
  /** Hex-färg för ram, eller null för ingen ram (poster). */
  frameColor?: string | null;
  /** Ramens bredd i cm (verklig). Standard 2.5. */
  frameWidthCm?: number;
}

export async function compositeMockup({
  scene,
  printUrl,
  size,
  orientation,
  productType,
  canvasDepthCm = 2,
  frameColor = null,
  frameWidthCm = 2.5,
}: CompositArgs): Promise<string> {
  const sizeCm = parseSizeCm(size);
  if (!sizeCm) throw new Error(`Ogiltig storlek: ${size}`);

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

  // Skala bakgrund så scen-koordinater (1024-bas) mappar direkt om bilden är 1024.
  // Om bilden inte är 1024 räknar vi om area-koordinaterna proportionellt.
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

  // 2. Räkna ut poster-pixelstorlek inom area
  let posterW = (realWcm / scene.referenceWidthCm) * area.w;
  let posterH = posterW * (realHcm / realWcm);

  // Ramens bredd i px
  const frameWpx = frameColor && productType !== "canvas"
    ? (frameWidthCm / scene.referenceWidthCm) * area.w
    : 0;

  // Total bredd inkl. ram måste rymmas i area
  const totalW = posterW + frameWpx * 2;
  const totalH = posterH + frameWpx * 2;
  if (totalH > area.h) {
    const scale = area.h / totalH;
    posterH *= scale; posterW *= scale;
  }
  if (totalW > area.w) {
    const scale = area.w / totalW;
    posterW *= scale; posterH *= scale;
  }

  const innerW = posterW;
  const innerH = posterH;
  const outerW = innerW + frameWpx * 2;
  const outerH = innerH + frameWpx * 2;

  // Centrera (lite uppåtjusterat för att kännas naturligt på vägg)
  const ox = area.x + (area.w - outerW) / 2;
  const oy = area.y + (area.h - outerH) / 2;
  const px = ox + frameWpx;
  const py = oy + frameWpx;

  // 3. Skugga (under hela enheten inkl. ram)
  if (scene.shadow) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowColor = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowBlur = scene.shadow.blur;
    ctx.shadowOffsetY = scene.shadow.offsetY;
    ctx.fillRect(ox, oy, outerW, outerH);
    ctx.restore();
  }

  // 4. Canvas wrap (3D-djup på höger sida) — för canvas-produkter
  if (productType === "canvas" && scene.canvasWrap) {
    const depthPx = (canvasDepthCm / scene.referenceWidthCm) * area.w;
    const angle = (scene.canvasWrap.angleDeg * Math.PI) / 180;
    const sideW = depthPx * Math.cos(angle);
    const sideTopOffset = depthPx * Math.sin(angle) * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px + posterW, py);
    ctx.lineTo(px + posterW + sideW, py - sideTopOffset);
    ctx.lineTo(px + posterW + sideW, py + posterH - sideTopOffset);
    ctx.lineTo(px + posterW, py + posterH);
    ctx.closePath();
    ctx.clip();
    const stripSrcW = Math.max(2, fg.naturalWidth * 0.02);
    ctx.drawImage(
      fg,
      fg.naturalWidth - stripSrcW, 0, stripSrcW, fg.naturalHeight,
      px + posterW, py - sideTopOffset, sideW, posterH,
    );
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(px + posterW, py - sideTopOffset, sideW, posterH + sideTopOffset * 2);
    ctx.restore();
  }

  // 5. Ram (endast poster med vald färg)
  if (frameColor && frameWpx > 0 && productType !== "canvas") {
    ctx.save();
    // Bas-färg
    ctx.fillStyle = frameColor;
    ctx.fillRect(ox, oy, outerW, outerH);

    // Trä-/material-textur via gradient på varje sida för djup
    const grad = ctx.createLinearGradient(ox, oy, ox + outerW, oy + outerH);
    grad.addColorStop(0, "rgba(255,255,255,0.18)");
    grad.addColorStop(0.5, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, outerW, outerH);

    // Inner-shadow runt postern (mörk ring inuti glaset/ramen)
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, frameWpx * 0.08);
    ctx.strokeRect(px - 0.5, py - 0.5, innerW + 1, innerH + 1);
    ctx.restore();
  }

  // 6. Postern själv (med ev. perspektivlutning för canvas)
  if (productType === "canvas" && scene.canvasWrap && scene.canvasWrap.angleDeg !== 0) {
    const angle = (scene.canvasWrap.angleDeg * Math.PI) / 180;
    const skewY = Math.tan(angle) * 0.12;
    ctx.save();
    ctx.transform(1, 0, skewY, 1, px - py * skewY, 0);
    ctx.drawImage(fg, px, py, posterW, posterH);
    ctx.restore();
  } else {
    ctx.drawImage(fg, px, py, posterW, posterH);
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}
