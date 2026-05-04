import type { MockupScene } from "./mockup-scenes";
import { parseSizeCm } from "./mockup-scenes";
import type { Orientation, ProductType } from "./product-config";
import oakTextureUrl from "@/assets/textures/wood-oak.jpg";

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild kunde inte laddas: ${src}`));
    img.src = src;
  });
}

let oakTextureCache: HTMLImageElement | null = null;
async function getOakTexture(): Promise<HTMLImageElement> {
  if (oakTextureCache) return oakTextureCache;
  oakTextureCache = await loadImage(oakTextureUrl, false);
  return oakTextureCache;
}

function isOak(hex: string | null | undefined): boolean {
  return !!hex && hex.toLowerCase() === "#c8a371";
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
  /** Hex-färg för posterhängare (trälist topp+botten). Aldrig samtidigt som ram. */
  hangerColor?: string | null;
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
  hangerColor = null,
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

  // 2. Poster-pixelstorlek inom area (skala efter referensbredd → trovärdig storlek)
  let posterW = (realWcm / scene.referenceWidthCm) * area.w;
  let posterH = posterW * (realHcm / realWcm);

  const frameWpx = frameColor && productType !== "canvas"
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

  // Canvas-djup i scenpixlar
  const depthPx = productType === "canvas"
    ? (canvasDepthCm / scene.referenceWidthCm) * area.w
    : 0;
  const angle = scene.canvasWrap ? (scene.canvasWrap.angleDeg * Math.PI) / 180 : 0;
  const sideVisibleW = productType === "canvas" ? depthPx * Math.sin(angle) : 0;
  const topVisibleH = productType === "canvas" ? depthPx * Math.cos(angle) * 0.35 : 0;

  // Total bounding för canvas = front + synlig sida + synlig topp
  const canvasOuterW = posterW + sideVisibleW;
  const canvasOuterH = posterH + topVisibleH;

  // Centrera enheten i area
  const ox = productType === "canvas"
    ? area.x + (area.w - canvasOuterW) / 2
    : area.x + (area.w - outerW) / 2;
  const oy = productType === "canvas"
    ? area.y + (area.h - canvasOuterH) / 2
    : area.y + (area.h - outerH) / 2;
  const px = productType === "canvas" ? ox : ox + frameWpx;
  const py = productType === "canvas" ? oy + topVisibleH : oy + frameWpx;

  // 3. Skugga
  if (scene.shadow) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowColor = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowBlur = scene.shadow.blur;
    ctx.shadowOffsetY = scene.shadow.offsetY;
    if (productType === "canvas") {
      ctx.fillRect(ox, oy, canvasOuterW, canvasOuterH);
    } else {
      ctx.fillRect(ox, oy, outerW, outerH);
    }
    ctx.restore();
  }

  // 4. Canvas: rita TOPP-wrap (sampla översta ~3% av bilden, sträck över top-trapets)
  if (productType === "canvas" && scene.canvasWrap && topVisibleH > 0.5) {
    const stripSrcH = Math.max(2, fg.naturalHeight * 0.03);
    ctx.save();
    // trapets ovanför postern: vänster topp = (px, py - topVisibleH), höger topp = (px+posterW+sideVisibleW, py-topVisibleH+sideTopOffset)
    // approximation via clip + drawImage skewed
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + posterW, py);
    ctx.lineTo(px + posterW + sideVisibleW, py - topVisibleH);
    ctx.lineTo(px + sideVisibleW * 0.15, py - topVisibleH);
    ctx.closePath();
    ctx.clip();
    // skew så pixlar pressas in mot bakåt-perspektivet
    const skewX = sideVisibleW / Math.max(topVisibleH, 1);
    ctx.transform(1, 0, -skewX * 0.5, 1, 0, 0);
    ctx.drawImage(
      fg,
      0, 0, fg.naturalWidth, stripSrcH,
      px + py * skewX * 0.5, py - topVisibleH, posterW + sideVisibleW, topVisibleH,
    );
    // mörkning bakåt (gradient)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const topGrad = ctx.createLinearGradient(0, py - topVisibleH, 0, py);
    topGrad.addColorStop(0, "rgba(0,0,0,0.35)");
    topGrad.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(px - 5, py - topVisibleH, posterW + sideVisibleW + 10, topVisibleH + 1);
    ctx.restore();
  }

  // 5. Canvas: rita HÖGER SIDO-wrap (sampla högra ~3% av bilden, sträck över sido-trapets)
  if (productType === "canvas" && scene.canvasWrap && sideVisibleW > 0.5) {
    const stripSrcW = Math.max(2, fg.naturalWidth * 0.03);
    ctx.save();
    // sido-trapets: vänster-topp=(px+posterW, py), höger-topp=(px+posterW+sideVisibleW, py-topVisibleH),
    //                höger-bot=(px+posterW+sideVisibleW, py+posterH-topVisibleH*0.4), vänster-bot=(px+posterW, py+posterH)
    ctx.beginPath();
    ctx.moveTo(px + posterW, py);
    ctx.lineTo(px + posterW + sideVisibleW, py - topVisibleH);
    ctx.lineTo(px + posterW + sideVisibleW, py + posterH - topVisibleH * 0.4);
    ctx.lineTo(px + posterW, py + posterH);
    ctx.closePath();
    ctx.clip();
    // approximera perspektiv via horisontell sträckning av högra strippan
    const skewY = -topVisibleH / Math.max(sideVisibleW, 1);
    ctx.transform(1, skewY * 0.5, 0, 1, 0, 0);
    ctx.drawImage(
      fg,
      fg.naturalWidth - stripSrcW, 0, stripSrcW, fg.naturalHeight,
      px + posterW, py - (px + posterW) * skewY * 0.5, sideVisibleW, posterH,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // mörkare gradient mot bakkanten (höger)
    const sideGrad = ctx.createLinearGradient(px + posterW, 0, px + posterW + sideVisibleW, 0);
    sideGrad.addColorStop(0, "rgba(0,0,0,0.05)");
    sideGrad.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = sideGrad;
    ctx.fillRect(px + posterW, py - topVisibleH, sideVisibleW + 1, posterH + topVisibleH);
    ctx.restore();
  }

  // 6. Ram (endast poster med vald färg)
  if (frameColor && frameWpx > 0 && productType !== "canvas") {
    ctx.save();
    if (isOak(frameColor)) {
      try {
        const tex = await getOakTexture();
        const pat = ctx.createPattern(tex, "repeat");
        if (pat) {
          ctx.fillStyle = pat as CanvasPattern;
        } else {
          ctx.fillStyle = frameColor;
        }
      } catch {
        ctx.fillStyle = frameColor;
      }
    } else {
      ctx.fillStyle = frameColor;
    }
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

  // 7. Front: postern själv — RAKT, ingen skew (innehåll ska aldrig förvrängas)
  // När hängare är vald simulerar vi pappersmarginal: motivet krymps i höjd
  // så listerna kan klämma fast pappret utan att täcka motivet.
  const hasHanger = !!hangerColor && productType === "posters";
  const slatHForMargin = hasHanger ? Math.max(3, (0.6 / scene.referenceWidthCm) * area.w) : 0;
  const paperMarginY = hasHanger ? slatHForMargin * 1.15 : 0;

  if (hasHanger) {
    // Vit pappersbakgrund över hela paper-arean
    ctx.save();
    ctx.fillStyle = "#fafaf7";
    ctx.fillRect(px, py, posterW, posterH);
    ctx.restore();

    const motifH = posterH - paperMarginY * 2;
    const motifAspect = posterW / posterH;
    let motifW = motifH * motifAspect;
    let motifX = px + (posterW - motifW) / 2;
    if (motifW > posterW) {
      motifW = posterW;
      motifX = px;
    }
    ctx.drawImage(fg, motifX, py + paperMarginY, motifW, motifH);
  } else {
    ctx.drawImage(fg, px, py, posterW, posterH);
  }


  // 8. Diskret skugga i hörnen för att binda postern mot väggen
  if (productType !== "canvas") {
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
  }

  // 9. Posterhängare (trälist topp+botten + snöre i trekant)
  if (hangerColor && productType === "posters") {
    const slatH = Math.max(3, (0.6 / scene.referenceWidthCm) * area.w);
    const overhang = slatH * 0.25;
    const cordRise = Math.max(slatH * 1.8, (1.8 / scene.referenceWidthCm) * area.w);
    const x0 = px - overhang;
    const x1 = px + posterW + overhang;

    let oakPattern: CanvasPattern | null = null;
    if (isOak(hangerColor)) {
      try {
        const tex = await getOakTexture();
        oakPattern = ctx.createPattern(tex, "repeat");
      } catch {
        oakPattern = null;
      }
    }

    const drawSlat = (yTop: number) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = slatH * 0.5;
      ctx.shadowOffsetY = slatH * 0.2;
      ctx.fillStyle = oakPattern ?? hangerColor;
      ctx.fillRect(x0, yTop, x1 - x0, slatH);
      ctx.restore();
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop + slatH);
      grad.addColorStop(0, "rgba(255,255,255,0.22)");
      grad.addColorStop(0.5, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = grad;
      ctx.fillRect(x0, yTop, x1 - x0, slatH);
      if (hangerColor.toLowerCase() === "#f5f5f2") {
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, yTop + 0.5, x1 - x0 - 1, slatH - 1);
      }
    };
    drawSlat(py);
    drawSlat(py + posterH - slatH);

    // Snöre i trekant — två räta linjer som möts vid en topp-punkt (spiken)
    const cordY = py + slatH * 0.5;
    const apexX = (x0 + x1) / 2;
    const apexY = py - cordRise;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 + slatH * 0.5, cordY);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(x1 - slatH * 0.5, cordY);
    ctx.lineWidth = Math.max(1.5, slatH * 0.18);
    ctx.strokeStyle = "rgba(40,30,20,0.78)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Spik vid spetsen
    const nailR = Math.max(1.5, slatH * 0.32);
    ctx.beginPath();
    ctx.arc(apexX, apexY, nailR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(70,55,45,0.95)";
    ctx.fill();
    // liten highlight på spiken
    ctx.beginPath();
    ctx.arc(apexX - nailR * 0.3, apexY - nailR * 0.3, nailR * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
    ctx.restore();
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}
