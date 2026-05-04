/**
 * Procedurell trä-textur (ek/valnöt) för canvas + CSS.
 *
 * Används för att rita ramar och posterhängare i preview/cart/mockup.
 * RÖR ALDRIG TRYCKFILEN — kallas bara från icke-hires renderingar.
 *
 * Två API:
 *   - paintWoodGrain(ctx, ...) — ritar på en 2D-canvas (snapshot, mockup)
 *   - woodCssBackground(variant) — returnerar `background-image`-string för
 *     live-editorn (CSS-only, ingen JS-ritning).
 */

export type WoodVariant = "oak" | "walnut";
export type WoodDirection = "horizontal" | "vertical";

interface Palette {
  base: string;
  baseLight: string;
  baseDark: string;
  grain: string;
  grainLight: string;
  knot: string;
}

const PALETTES: Record<WoodVariant, Palette> = {
  oak: {
    base: "#c8a371",
    baseLight: "#dcbb88",
    baseDark: "#a78050",
    grain: "#8a6a3e",
    grainLight: "#e6cf9e",
    knot: "#5e4422",
  },
  walnut: {
    base: "#5a3a26",
    baseLight: "#7a5230",
    baseDark: "#3a230f",
    grain: "#2c1a10",
    grainLight: "#8e6238",
    knot: "#1a0c06",
  },
};

/**
 * Identifiera trä-variant från en färgsträng (hex, hsl, eller variantnamn).
 * Returnerar null om färgen inte är ek/valnöt — då ska anroparen falla
 * tillbaka till sin gamla flata fyllning.
 */
export function woodVariantFromColor(color: string | null | undefined): WoodVariant | null {
  if (!color) return null;
  const c = color.toLowerCase().replace(/\s+/g, "");
  // Hängare-hex
  if (c === "#c8a371") return "oak";
  if (c === "#5a3a26") return "walnut";
  // Ram-HSL (EditorPage FRAME_COLORS)
  if (c.includes("hsl(30") && c.includes("35%") && c.includes("55%")) return "oak";
  if (c.includes("hsl(20") && c.includes("25%") && c.includes("25%")) return "walnut";
  // Variantnamn (om någon skickar in det rakt av)
  if (c === "ek" || c === "oak") return "oak";
  if (c === "valnöt" || c === "valnot" || c === "walnut") return "walnut";
  return null;
}

/* ───────────────────────── Deterministisk slump ───────────────────────── */

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ───────────────────────── Canvas-ritning ───────────────────────── */

interface PaintOpts {
  direction?: WoodDirection;
  /** Frö för deterministisk ådring (samma input → samma utseende). */
  seed?: string | number;
  /** Multiplicera ådringens täthet (1 = standard). */
  grainDensity?: number;
}

/**
 * Måla en trä-rektangel på `ctx` i bounding-box (x,y,w,h).
 * Ådringen följer `direction`-axeln (horizontal = ådring längs x-axeln).
 */
export function paintWoodGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: WoodVariant,
  opts: PaintOpts = {},
): void {
  if (w <= 1 || h <= 1) return;
  const direction: WoodDirection = opts.direction ?? "horizontal";
  const pal = PALETTES[variant];
  const seed = typeof opts.seed === "number"
    ? opts.seed
    : hashString(`${variant}|${Math.round(w)}x${Math.round(h)}|${opts.seed ?? ""}`);
  const rand = mulberry32(seed);

  ctx.save();
  // Klipp till rektangeln så ådring/kvistar inte spiller över.
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 1. Bas-färg + lågfrekvent färgdrift (warm/cool fält).
  ctx.fillStyle = pal.base;
  ctx.fillRect(x, y, w, h);

  // 2. Bred bas-gradient längs ådringens axel — varma och svala band.
  const isH = direction === "horizontal";
  const longSide = isH ? w : h;
  const shortSide = isH ? h : w;
  const bandCount = Math.max(3, Math.round(longSide / Math.max(40, shortSide * 0.8)));
  for (let i = 0; i < bandCount; i++) {
    const t = (i + rand() * 0.6) / bandCount;
    const center = (isH ? x : y) + t * longSide;
    const width = longSide * (0.18 + rand() * 0.22);
    const grad = isH
      ? ctx.createLinearGradient(center - width / 2, 0, center + width / 2, 0)
      : ctx.createLinearGradient(0, center - width / 2, 0, center + width / 2);
    const tone = rand() < 0.5 ? pal.baseDark : pal.baseLight;
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, hexToRgba(tone, 0.35));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  // 3. Ådringslinjer — böljande sinus-kurvor längs långaxeln.
  const grainCount = Math.max(8, Math.round(shortSide / 3 * (opts.grainDensity ?? 1)));
  ctx.lineCap = "round";
  for (let i = 0; i < grainCount; i++) {
    const cross = (isH ? y : x) + (i / grainCount) * shortSide + (rand() - 0.5) * (shortSide / grainCount) * 0.8;
    const amp = shortSide * (0.015 + rand() * 0.05);
    const freq = (Math.PI * 2 * (1 + rand() * 2.5)) / longSide;
    const phase = rand() * Math.PI * 2;
    const isLight = rand() < 0.18;
    const color = isLight ? pal.grainLight : pal.grain;
    const alpha = isLight ? 0.18 + rand() * 0.15 : 0.22 + rand() * 0.35;
    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = Math.max(0.4, shortSide * (0.004 + rand() * 0.012));
    ctx.beginPath();
    const steps = Math.max(20, Math.round(longSide / 6));
    for (let s = 0; s <= steps; s++) {
      const u = (s / steps) * longSide;
      const wave = Math.sin(u * freq + phase) * amp + Math.sin(u * freq * 2.3 + phase * 1.7) * amp * 0.3;
      const px = isH ? x + u : x + cross + wave;
      const py = isH ? y + cross + wave : y + u;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 4. Por-textur — korta dashes parallellt med ådringen.
  const poreCount = Math.round((w * h) / 800);
  ctx.fillStyle = hexToRgba(pal.grain, 0.35);
  for (let i = 0; i < poreCount; i++) {
    const px = x + rand() * w;
    const py = y + rand() * h;
    const len = isH ? 1.2 + rand() * 2.5 : 0.6 + rand() * 1;
    const thick = isH ? 0.5 + rand() * 0.6 : 1.2 + rand() * 2.5;
    ctx.fillRect(px, py, isH ? len : thick, isH ? thick : len);
  }

  // 5. Kvistar (knots) — 0–2 elliptiska mörka fläckar med ringar.
  const knotCount = rand() < 0.55 ? (rand() < 0.35 ? 2 : 1) : 0;
  for (let i = 0; i < knotCount; i++) {
    const kx = x + (0.15 + rand() * 0.7) * w;
    const ky = y + (0.2 + rand() * 0.6) * h;
    const kr = shortSide * (0.18 + rand() * 0.22);
    const kry = isH ? kr * 0.45 : kr;
    const krx = isH ? kr : kr * 0.45;
    // Mörk kärna
    ctx.save();
    const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, Math.max(krx, kry));
    kg.addColorStop(0, hexToRgba(pal.knot, 0.85));
    kg.addColorStop(0.5, hexToRgba(pal.knot, 0.45));
    kg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = kg;
    ctx.beginPath();
    ctx.ellipse(kx, ky, krx, kry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ringar runt kärnan
    ctx.strokeStyle = hexToRgba(pal.grain, 0.45);
    for (let r = 1; r <= 3; r++) {
      ctx.lineWidth = Math.max(0.5, shortSide * 0.006);
      ctx.beginPath();
      const f = 1 + r * 0.55;
      ctx.ellipse(kx, ky, krx * f, kry * f, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6. 3D-gradient över kortaxeln (highlight uppe/vänster, skugga nere/höger).
  const fg = isH
    ? ctx.createLinearGradient(0, y, 0, y + h)
    : ctx.createLinearGradient(x, 0, x + w, 0);
  fg.addColorStop(0, "rgba(255,255,255,0.18)");
  fg.addColorStop(0.5, "rgba(255,255,255,0)");
  fg.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

/* ───────────────────────── CSS-bakgrund ───────────────────────── */

/**
 * CSS-approximation av samma material — staplade gradients som ger
 * ådringskänsla utan extern bild eller JS-ritning. Använd i live-editorn.
 *
 * Returnerar ett objekt med `backgroundColor`, `backgroundImage` och
 * `backgroundSize` som kan spreadas in i ett `style`-objekt.
 */
export function woodCssBackground(
  variant: WoodVariant,
  direction: WoodDirection = "horizontal",
): React.CSSProperties {
  const pal = PALETTES[variant];
  const along = direction === "horizontal" ? "to right" : "to bottom";
  const across = direction === "horizontal" ? "to bottom" : "to right";

  // Ådring: tre överlagrade repeating-linear-gradients i olika frekvens
  // och alfa, plus en bred ljus-mörk drift.
  const grainA = `repeating-linear-gradient(${along},
    ${hexToRgba(pal.grain, 0)} 0px,
    ${hexToRgba(pal.grain, 0.18)} 1px,
    ${hexToRgba(pal.grain, 0)} 4px,
    ${hexToRgba(pal.grain, 0.10)} 7px,
    ${hexToRgba(pal.grain, 0)} 11px)`;
  const grainB = `repeating-linear-gradient(${along},
    ${hexToRgba(pal.grain, 0)} 0px,
    ${hexToRgba(pal.grain, 0.22)} 2px,
    ${hexToRgba(pal.grain, 0)} 9px,
    ${hexToRgba(pal.grainLight, 0.14)} 14px,
    ${hexToRgba(pal.grain, 0)} 22px)`;
  const grainC = `repeating-linear-gradient(${along},
    ${hexToRgba(pal.grain, 0)} 0px,
    ${hexToRgba(pal.grainLight, 0.10)} 30px,
    ${hexToRgba(pal.grain, 0.14)} 55px,
    ${hexToRgba(pal.grain, 0)} 90px)`;
  // Bred drift tvärs över för 3D-känsla
  const drift = `linear-gradient(${across},
    ${hexToRgba(pal.baseLight, 0.45)} 0%,
    ${hexToRgba(pal.base, 0)} 35%,
    ${hexToRgba(pal.baseDark, 0.35)} 100%)`;

  return {
    backgroundColor: pal.base,
    backgroundImage: `${grainA}, ${grainB}, ${grainC}, ${drift}`,
    backgroundBlendMode: "multiply, multiply, multiply, normal",
  };
}

/* ───────────────────────── helpers ───────────────────────── */

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
