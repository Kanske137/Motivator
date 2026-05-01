// Close-up "product shot" thumbnails. Renders the customer's print snapshot
// as a paper corner (poster) or canvas wrap corner on a clean white background.
// Output is a JPEG dataURL — drop-in compatible with mockup slot rendering.

import { parseSizeCm } from "./mockup-scenes";
import type { Orientation } from "./product-config";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild kunde inte laddas: ${src}`));
    img.src = src;
  });
}

const OUT_SIZE = 1024;

/** Quick procedural noise → very subtle paper/canvas grain overlay. */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
) {
  const off = document.createElement("canvas");
  const tile = 64;
  off.width = tile;
  off.height = tile;
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(tile, tile);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "multiply";
  const pat = ctx.createPattern(off, "repeat");
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/**
 * Draws a source rect from `img` into a quad (4 corner points) using a
 * horizontal-band approximation. Good enough for slight perspective tilts.
 */
function drawImageQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  // destination quad: tl, tr, br, bl
  tl: { x: number; y: number },
  tr: { x: number; y: number },
  br: { x: number; y: number },
  bl: { x: number; y: number },
  bands = 40,
) {
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    // Interpolate left & right edges
    const lx0 = tl.x + (bl.x - tl.x) * t0;
    const ly0 = tl.y + (bl.y - tl.y) * t0;
    const lx1 = tl.x + (bl.x - tl.x) * t1;
    const ly1 = tl.y + (bl.y - tl.y) * t1;
    const rx0 = tr.x + (br.x - tr.x) * t0;
    const ry0 = tr.y + (br.y - tr.y) * t0;
    const rx1 = tr.x + (br.x - tr.x) * t1;
    const ry1 = tr.y + (br.y - tr.y) * t1;

    // Source band
    const ssy = sy + sh * t0;
    const ssh = sh * (t1 - t0) + 0.5; // 0.5 overlap to avoid seams

    // Affine that maps (0,0)->(lx0,ly0), (sw,0)->(rx0,ry0), (0,bandH)->(lx1,ly1)
    const bandH = ssh;
    const a = (rx0 - lx0) / sw;
    const b = (ry0 - ly0) / sw;
    const c = (lx1 - lx0) / bandH;
    const d = (ly1 - ly0) / bandH;
    const e = lx0;
    const f = ly0;

    ctx.save();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(img, sx, ssy, sw, ssh, 0, 0, sw, bandH);
    ctx.restore();
  }
}

function softShadow(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  blur: number,
  offsetY: number,
  alpha: number,
) {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = offsetY;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTER CORNER
// ─────────────────────────────────────────────────────────────────────────────

interface PosterShotArgs {
  printUrl: string;
  orientation: Orientation;
  size: string; // "30x40"
}

export async function renderPosterCornerShot({
  printUrl,
  orientation,
  size,
}: PosterShotArgs): Promise<string> {
  const sizeCm = parseSizeCm(size);
  if (!sizeCm) throw new Error(`Ogiltig storlek: ${size}`);
  const wCm = orientation === "landscape" ? sizeCm.hCm : sizeCm.wCm;
  const hCm = orientation === "landscape" ? sizeCm.wCm : sizeCm.hCm;

  const img = await loadImage(printUrl);

  const canvas = document.createElement("canvas");
  canvas.width = OUT_SIZE;
  canvas.height = OUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte skapa 2D-context");

  // Soft off-white background
  const bg = ctx.createLinearGradient(0, 0, 0, OUT_SIZE);
  bg.addColorStop(0, "#fafafa");
  bg.addColorStop(1, "#eeeeee");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);

  // We render a tilted poster where the lower-right corner is closer/larger.
  // Place the poster so its bottom-right corner sits roughly at (78%, 78%)
  // of the canvas, and only ~50% of the poster width is visible.
  const aspect = wCm / hCm;

  // Target visible width on canvas (≈ 1.6× canvas width so the poster extends
  // off the top-left edge — we see only the bottom-right corner).
  const visW = OUT_SIZE * 1.55;
  const visH = visW / aspect;

  // Anchor: bottom-right corner near (0.82, 0.85)
  const brX = OUT_SIZE * 0.82;
  const brY = OUT_SIZE * 0.86;

  // Untilted corners (before perspective)
  const tlX0 = brX - visW;
  const tlY0 = brY - visH;
  const trX0 = brX;
  const trY0 = tlY0;
  const blX0 = tlX0;
  const blY0 = brY;

  // Apply slight rotation around BR (so the visible corner stays anchored)
  const rot = -0.10; // radians (~ -5.7°), negative → tilts top-left further away
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rotate = (x: number, y: number) => {
    const dx = x - brX;
    const dy = y - brY;
    return { x: brX + dx * cos - dy * sin, y: brY + dx * sin + dy * cos };
  };
  let tl = rotate(tlX0, tlY0);
  let tr = rotate(trX0, trY0);
  let bl = rotate(blX0, blY0);
  const br = { x: brX, y: brY };

  // Perspective: shrink the far (top-left) edge slightly toward its midpoint
  // to fake depth — the bottom-right corner is "closer" to the viewer.
  const perspective = 0.92;
  const mid = { x: (tl.x + tr.x) / 2, y: (tl.y + bl.y) / 2 };
  tl = { x: mid.x + (tl.x - mid.x) * perspective, y: tl.y };
  tr = { x: tr.x, y: mid.y + (tr.y - mid.y) * perspective };
  bl = { x: bl.x, y: mid.y + (bl.y - mid.y) * perspective };
  // br stays anchored

  // Soft contact shadow under the paper
  softShadow(
    ctx,
    [tl, tr, br, bl].map((p) => ({ x: p.x + 6, y: p.y + 14 })),
    28,
    14,
    0.18,
  );

  // Draw the print into the quad
  drawImageQuad(
    ctx,
    img,
    0,
    0,
    img.naturalWidth,
    img.naturalHeight,
    tl,
    tr,
    br,
    bl,
    50,
  );

  // Subtle paper grain over the poster region (clip to quad)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.clip();
  drawGrain(ctx, 0, 0, OUT_SIZE, OUT_SIZE, 0.07);

  // Subtle directional sheen (top-left brighter, bottom-right slightly darker)
  const sheen = ctx.createLinearGradient(tl.x, tl.y, br.x, br.y);
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(0.6, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.06)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
  ctx.restore();

  // Crisp paper edge along the two visible (right & bottom) sides
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL("image/jpeg", 0.92);
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS CORNER (with wrap depth)
// ─────────────────────────────────────────────────────────────────────────────

interface CanvasShotArgs {
  printUrl: string; // snapshot INCLUDES wrap+bleed border
  orientation: Orientation;
  size: string;
  depthCm: number;
  wrapCm: number; // typically equal to depthCm
  bleedCm: number;
}

export async function renderCanvasCornerShot({
  printUrl,
  orientation,
  size,
  depthCm,
  wrapCm,
  bleedCm,
}: CanvasShotArgs): Promise<string> {
  const sizeCm = parseSizeCm(size);
  if (!sizeCm) throw new Error(`Ogiltig storlek: ${size}`);
  const frontWcm = orientation === "landscape" ? sizeCm.hCm : sizeCm.wCm;
  const frontHcm = orientation === "landscape" ? sizeCm.wCm : sizeCm.hCm;

  const img = await loadImage(printUrl);

  // Snapshot dimensions: the snapshot has wrap+bleed on every side, so we
  // need to know what fraction of the snapshot is the FRONT zone.
  const borderCm = wrapCm + bleedCm;
  const totalWcm = frontWcm + 2 * borderCm;
  const totalHcm = frontHcm + 2 * borderCm;
  const frontFracX = frontWcm / totalWcm;
  const frontFracY = frontHcm / totalHcm;
  const borderFracX = borderCm / totalWcm;
  // Right wrap strip in source pixels (wrap zone, NOT including bleed at far edge)
  const wrapFracX = wrapCm / totalWcm;

  const sW = img.naturalWidth;
  const sH = img.naturalHeight;
  // Front zone in source pixels
  const sFrontX = sW * borderFracX;
  const sFrontY = sH * borderFracX; // square border in cm-fraction terms
  const sFrontW = sW * frontFracX;
  const sFrontH = sH * frontFracY;
  // Right wrap zone source rect (immediately to the right of front zone)
  const sWrapX = sFrontX + sFrontW;
  const sWrapW = sW * wrapFracX;

  const canvas = document.createElement("canvas");
  canvas.width = OUT_SIZE;
  canvas.height = OUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte skapa 2D-context");

  // Clean off-white background
  const bg = ctx.createLinearGradient(0, 0, 0, OUT_SIZE);
  bg.addColorStop(0, "#fbfbfb");
  bg.addColorStop(1, "#ececec");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);

  // Layout: show the bottom-right corner of the canvas. Front face occupies a
  // tilted quad; right-side wrap panel is drawn as a narrower trapezoid going
  // away to the right.
  const aspect = frontWcm / frontHcm;

  // Front face visible width
  const frontW = OUT_SIZE * 1.45;
  const frontH = frontW / aspect;

  // Depth in pixels — derived from real cm so 4cm canvas looks visibly thicker
  // than 2cm. Scale relative to the front width on screen.
  const depthPx = (depthCm / frontWcm) * frontW;

  // Anchor BR of front face
  const brX = OUT_SIZE * 0.62;
  const brY = OUT_SIZE * 0.82;

  const frontTL0 = { x: brX - frontW, y: brY - frontH };
  const frontTR0 = { x: brX, y: brY - frontH };
  const frontBL0 = { x: brX - frontW, y: brY };
  const frontBR0 = { x: brX, y: brY };

  // Slight tilt of the front face — rotate around BR so anchor stays put.
  const rot = -0.08;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rotate = (p: { x: number; y: number }) => {
    const dx = p.x - brX;
    const dy = p.y - brY;
    return { x: brX + dx * cos - dy * sin, y: brY + dx * sin + dy * cos };
  };
  const fTL = rotate(frontTL0);
  const fTR = rotate(frontTR0);
  const fBL = rotate(frontBL0);
  const fBR = frontBR0;

  // Side panel (right wrap): goes from fTR/fBR backward+right to give the
  // illusion of depth. Use a small angle.
  const sideAngle = 0.45; // radians, side recedes up-and-right
  const sideDx = depthPx * Math.cos(sideAngle);
  const sideDy = -depthPx * Math.sin(sideAngle);

  const sTL = fTR;
  const sBL = fBR;
  const sTR = { x: fTR.x + sideDx, y: fTR.y + sideDy };
  const sBR = { x: fBR.x + sideDx, y: fBR.y + sideDy };

  // Bottom panel (bottom wrap): tiny visible strip from fBL→fBR going down
  const botDx = 0;
  const botDy = depthPx * 0.55;
  const bTL = fBL;
  const bTR = fBR;
  const bBL = { x: fBL.x + botDx, y: fBL.y + botDy };
  const bBR = { x: fBR.x + botDx, y: fBR.y + botDy };

  // Soft shadow under the whole canvas-corner shape
  softShadow(
    ctx,
    [
      { x: fTL.x + 8, y: fTL.y + 16 },
      { x: sTR.x + 8, y: sTR.y + 16 },
      { x: sBR.x + 8, y: sBR.y + 22 },
      { x: bBR.x + 8, y: bBR.y + 22 },
      { x: bBL.x + 8, y: bBL.y + 22 },
    ],
    32,
    18,
    0.22,
  );

  // 1) Front face — front zone of snapshot
  drawImageQuad(ctx, img, sFrontX, sFrontY, sFrontW, sFrontH, fTL, fTR, fBR, fBL, 45);

  // Subtle canvas weave + sheen on front
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fTL.x, fTL.y);
  ctx.lineTo(fTR.x, fTR.y);
  ctx.lineTo(fBR.x, fBR.y);
  ctx.lineTo(fBL.x, fBL.y);
  ctx.closePath();
  ctx.clip();
  drawGrain(ctx, 0, 0, OUT_SIZE, OUT_SIZE, 0.10);
  const sheen = ctx.createLinearGradient(fTL.x, fTL.y, fBR.x, fBR.y);
  sheen.addColorStop(0, "rgba(255,255,255,0.08)");
  sheen.addColorStop(0.7, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.05)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
  ctx.restore();

  // 2) Right side panel — wrap strip from snapshot, mapped onto recede-quad
  drawImageQuad(ctx, img, sWrapX, sFrontY, sWrapW, sFrontH, sTL, sTR, sBR, sBL, 40);

  // Darken side panel for depth (gradient toward back)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sTL.x, sTL.y);
  ctx.lineTo(sTR.x, sTR.y);
  ctx.lineTo(sBR.x, sBR.y);
  ctx.lineTo(sBL.x, sBL.y);
  ctx.closePath();
  ctx.clip();
  const sideShade = ctx.createLinearGradient(sTL.x, 0, sTR.x, 0);
  sideShade.addColorStop(0, "rgba(0,0,0,0.05)");
  sideShade.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = sideShade;
  ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
  drawGrain(ctx, 0, 0, OUT_SIZE, OUT_SIZE, 0.08);
  ctx.restore();

  // 3) Bottom side panel — sample bottom wrap of snapshot
  const sBotY = sFrontY + sFrontH;
  const sBotH = sH * wrapFracX;
  drawImageQuad(ctx, img, sFrontX, sBotY, sFrontW, sBotH, bTL, bTR, bBR, bBL, 30);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bTL.x, bTL.y);
  ctx.lineTo(bTR.x, bTR.y);
  ctx.lineTo(bBR.x, bBR.y);
  ctx.lineTo(bBL.x, bBL.y);
  ctx.closePath();
  ctx.clip();
  const botShade = ctx.createLinearGradient(0, bTL.y, 0, bBL.y);
  botShade.addColorStop(0, "rgba(0,0,0,0.10)");
  botShade.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = botShade;
  ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
  ctx.restore();

  // 4) Mitre corner fold line (front-BR going diagonally onto the side+bottom)
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 1;
  // front edges (right + bottom)
  ctx.beginPath();
  ctx.moveTo(fTR.x, fTR.y);
  ctx.lineTo(fBR.x, fBR.y);
  ctx.lineTo(fBL.x, fBL.y);
  ctx.stroke();
  // mitre diagonal at corner
  ctx.beginPath();
  ctx.moveTo(fBR.x, fBR.y);
  ctx.lineTo(sBR.x + (bBR.x - fBR.x) * 0.5, sBR.y + (bBR.y - fBR.y) * 0.5);
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL("image/jpeg", 0.92);
}
