// Helpers för "fri mall"-läget (is_freeform): skapar nya lager med vettiga
// defaults och muterar en Template för att lägga till / ta bort / flytta
// dem i det aktiva layout-blocket (default eller canvas, valt orientering).
//
// Customer-additioner persisteras INTE till DB — de lever bara i editor-state
// under sessionen. När sidan laddas om återgår mallen till sin
// admin-definierade utgångspunkt.
import type {
  TemplateLayer,
  Template,
  Orientation,
  OrientationLayout,
} from "./template-schema";
import { defaultLocks, DEFAULT_LAYOUT_ID } from "./template-schema";

export type FreeformLayerType =
  | "photo"
  | "map"
  | "text"
  | "shape"
  | "line"
  | "margin";


/** Stable prefix vi använder för id:n på kund-tillagda lager så
 *  snapshot/pris/sync m.fl. kan filtrera bort dem om de behöver. */
export const CUSTOM_LAYER_PREFIX = "cust-";

export function isCustomLayerId(id: string): boolean {
  return id.startsWith(CUSTOM_LAYER_PREFIX);
}

function newId(): string {
  return `${CUSTOM_LAYER_PREFIX}${crypto.randomUUID()}`;
}

const UNLOCKED = () =>
  defaultLocks({
    position: false,
    move: false,
    size: false,
    shape: false,
    content: false,
    visibility: false,
    style: false,
    font: false,
  });

interface CreateOpts {
  name?: string;
  zIndex?: number;
  /** Önskat default-typsnitt för text-lager (override). */
  defaultFont?: string;
  /** Default kartstil-id om vi skapar ett map-lager. */
  defaultMapStyleId?: string;
  /** Specifik form-variant när type === "shape" (default: frame-rect). */
  shapeKind?: import("./template-schema").ShapeKind;
  /** Specifik linjeorientering när type === "line" (default: horizontal). */
  lineOrientation?: "horizontal" | "vertical";
}

/** Skapa ett nytt TemplateLayer med vettiga defaults för fri-mall. */
export function createFreeformLayer(
  type: FreeformLayerType,
  opts: CreateOpts = {},
): TemplateLayer {
  const id = newId();
  const zIndex = opts.zIndex ?? 50;
  const base = {
    id,
    xPct: 20,
    yPct: 20,
    wPct: 60,
    hPct: 60,
    rotation: 0,
    zIndex,
  };
  const locks = UNLOCKED();

  switch (type) {
    case "photo":
      return {
        ...base,
        type: "photo",
        name: opts.name ?? "Bild",
        locks,
        defaults: { shape: "rect", fit: "cover" },
      };


    case "map":
      return {
        ...base,
        type: "map",
        name: opts.name ?? "Karta",
        locks,
        defaults: {
          shape: "rect",
          styleId: opts.defaultMapStyleId ?? "light-v11",
          center: [18.0686, 59.3293],
          zoom: 13,
          showLabels: true,
        },
      };
    case "text":
      return {
        ...base,
        hPct: 15,
        type: "text",
        name: opts.name ?? "Text",
        locks: defaultLocks({
          position: false,
          move: false,
          size: false,
          content: false,
          visibility: false,
          font: false,
          style: false,
          shape: true,
        }),
        defaults: {
          text: "Din text",
          font: opts.defaultFont ?? "Inter",
          fontSizePt: 24,
          align: "center",
          color: "#000000",
        },
      };
    case "shape": {
      const kind = opts.shapeKind ?? "frame-rect";
      const defaults: import("./template-schema").ShapeDefaults = {
        kind,
        strokeMm: 1,
        color: "#000000",
        ...(kind === "frame-rounded" ? { cornerRadiusPct: 8 } : {}),
        ...(kind === "frame-double" ? { gapMm: 4 } : {}),
      };
      return {
        ...base,
        type: "shape",
        name: opts.name ?? "Form",
        locks,
        defaults,
      };
    }
    case "line": {
      const orientation = opts.lineOrientation ?? "horizontal";
      // Linje-höjd vs bredd: en horisontell linje får liten "tjocklek-låda"
      // i hPct (height) men full wPct (length). Vertikal tvärtom.
      return {
        ...base,
        wPct: orientation === "horizontal" ? 60 : 1,
        hPct: orientation === "horizontal" ? 1 : 60,
        type: "line",
        name: opts.name ?? "Linje",
        locks,
        defaults: {
          orientation,
          thicknessMm: 1,
          color: "#000000",
        },
      };
    }
    case "margin":
      return {
        ...base,
        xPct: 0,
        yPct: 0,
        wPct: 100,
        hPct: 100,
        type: "margin",
        name: opts.name ?? "Marginal",
        locks,
        defaults: { thicknessPct: 5, color: "#FFFFFF" },
      };
  }
}

/** Returnera en kopia av template där `fn` har körts mot det aktiva
 *  orientation-block för (productType, layoutId). Mutationen är ren —
 *  inget objekt utanför kopian rörs. */
export function mutateActiveLayoutBlock(
  template: Template,
  productType: string | null | undefined,
  layoutId: string | null | undefined,
  orientation: Orientation,
  fn: (layers: TemplateLayer[]) => TemplateLayer[],
): Template {
  const id = layoutId ?? DEFAULT_LAYOUT_ID;
  const isCanvas = productType === "canvas";
  const next: Template = JSON.parse(JSON.stringify(template));

  let block:
    | { portrait: OrientationLayout; landscape: OrientationLayout }
    | undefined;

  if (id === DEFAULT_LAYOUT_ID) {
    block = isCanvas && next.canvasLayout ? next.canvasLayout : next.defaultLayout;
  } else {
    const extra = next.extraLayouts?.find((l) => l.id === id);
    if (extra) {
      block = isCanvas && extra.canvasLayout ? extra.canvasLayout : extra.defaultLayout;
    }
  }
  if (!block) return template;
  const updated = fn(block[orientation].layers);
  block[orientation].layers = updated;
  return next;
}

/** Beräkna en zIndex som lägger nytt lager överst i nuvarande block. */
export function nextTopZIndex(layers: TemplateLayer[]): number {
  if (layers.length === 0) return 10;
  const max = layers.reduce((m, l) => Math.max(m, l.zIndex), 0);
  return max + 10;
}
