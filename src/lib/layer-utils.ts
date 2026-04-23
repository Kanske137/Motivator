// Pure helpers for working with template layers in the admin designer.
//   - factories that produce sane defaults per layer type
//   - zIndex normalisation when reordering
//   - bounds clamping in % of the front zone
//
// Keeping these here means LayerCanvas / LayerList / LayerInspector stay free
// of business logic.
import {
  defaultLocks,
  type LayerType,
  type TemplateLayer,
} from "@/lib/template-schema";

const SNAP_PCT = 5;

export function snapPct(value: number, snap = SNAP_PCT): number {
  return Math.round(value / snap) * snap;
}

export function clampPct(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function clampLayerBounds<T extends TemplateLayer>(layer: T): T {
  const w = clampPct(layer.wPct, 1, 100);
  const h = clampPct(layer.hPct, 1, 100);
  const x = clampPct(layer.xPct, 0, 100 - w);
  const y = clampPct(layer.yPct, 0, 100 - h);
  return { ...layer, xPct: x, yPct: y, wPct: w, hPct: h };
}

let nextIdCounter = 0;
export function newLayerId(): string {
  // Stable enough for in-memory work — Mall persisteras med dessa ID och de
  // matchas senare mot kund-`layerValues`.
  nextIdCounter += 1;
  return `layer_${Date.now().toString(36)}_${nextIdCounter}`;
}

export function nextZIndex(layers: TemplateLayer[]): number {
  if (layers.length === 0) return 1;
  return Math.max(...layers.map((l) => l.zIndex)) + 1;
}

/** Re-pack zIndex to a contiguous 1..N range while preserving order. */
export function normaliseZIndex(layers: TemplateLayer[]): TemplateLayer[] {
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  return sorted.map((l, i) => ({ ...l, zIndex: i + 1 }));
}

/** Move a layer's zIndex up/down by 1 step within the stack. */
export function moveLayer(
  layers: TemplateLayer[],
  id: string,
  direction: "up" | "down",
): TemplateLayer[] {
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((l) => l.id === id);
  if (idx === -1) return layers;
  const swapWith = direction === "up" ? idx + 1 : idx - 1;
  if (swapWith < 0 || swapWith >= sorted.length) return layers;
  const tmp = sorted[idx];
  sorted[idx] = sorted[swapWith];
  sorted[swapWith] = tmp;
  return normaliseZIndex(sorted);
}

// ---------- factories ----------
export function createLayer(type: LayerType, existing: TemplateLayer[]): TemplateLayer {
  const base = {
    id: newLayerId(),
    xPct: 10,
    yPct: 10,
    wPct: 80,
    hPct: 60,
    rotation: 0,
    zIndex: nextZIndex(existing),
    locks: defaultLocks(),
  };

  switch (type) {
    case "map":
      return {
        ...base,
        type: "map",
        name: `Karta ${countOfType(existing, "map") + 1}`,
        defaults: {
          shape: "circle",
          styleId: "light-v11",
          center: [18.0686, 59.3293],
          zoom: 12,
          showLabels: false,
        },
        locks: defaultLocks({ content: false }),
      };
    case "text":
      return {
        ...base,
        yPct: 75,
        hPct: 15,
        type: "text",
        name: `Text ${countOfType(existing, "text") + 1}`,
        defaults: {
          text: "STOCKHOLM",
          font: "Inter",
          fontSizePct: 8,
          align: "center",
          color: "#1A1A1A",
        },
        locks: defaultLocks({ content: false, font: true }),
      };
    case "image":
      return {
        ...base,
        type: "image",
        name: `Bild ${countOfType(existing, "image") + 1}`,
        defaults: { fit: "cover", shape: "rect" },
        locks: defaultLocks({ content: false }),
      };
    case "line":
      return {
        ...base,
        yPct: 70,
        hPct: 1,
        type: "line",
        name: `Linje ${countOfType(existing, "line") + 1}`,
        defaults: { orientation: "horizontal", thicknessMm: 2, color: "#1A1A1A" },
      };
    case "margin":
      return {
        ...base,
        xPct: 0,
        yPct: 0,
        wPct: 100,
        hPct: 100,
        type: "margin",
        name: `Marginal ${countOfType(existing, "margin") + 1}`,
        defaults: { thicknessMm: 5, color: "#FFFFFF" },
      };
    case "photo":
      return {
        ...base,
        xPct: 20,
        yPct: 20,
        wPct: 60,
        hPct: 60,
        type: "photo",
        name: `Foto ${countOfType(existing, "photo") + 1}`,
        defaults: { shape: "rect", fit: "cover" },
        locks: defaultLocks({ content: false, shape: false }),
      };
  }
}

function countOfType(layers: TemplateLayer[], type: LayerType): number {
  return layers.filter((l) => l.type === type).length;
}

/**
 * Build a sensible starter layout (centred map + text below). Mirrors the
 * default the customer editor used before the layer system existed.
 */
export function createDefaultLayout(): TemplateLayer[] {
  const map = createLayer("map", []);
  const text = createLayer("text", [map]);
  // Position map nicely at top, text below
  map.xPct = 10;
  map.yPct = 8;
  map.wPct = 80;
  map.hPct = 62;
  text.xPct = 10;
  text.yPct = 75;
  text.wPct = 80;
  text.hPct = 12;
  return normaliseZIndex([map, text]);
}
