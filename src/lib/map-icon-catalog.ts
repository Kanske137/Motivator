// Customer-placeable map icons. Each entry mirrors the relevant lucide-react
// icon's iconNode so we can both render it as React (via a small generic
// component) AND serialise it to a raw SVG string for the template-snapshot
// canvas pipeline. That guarantees editor preview === cart thumbnail ===
// Gelato print file, pixel-for-pixel.

export type IconAttr = Record<string, string | number>;
export type IconNode = Array<[string, IconAttr]>;

export interface MapIconDef {
  id: string;
  /** i18n label key suffix — full key is `mapIcon.<id>`. Fallback: this label. */
  fallbackLabel: string;
  iconNode: IconNode;
}

// Lucide stroke defaults: stroke-width 2, linecap/linejoin round, viewBox 24.
export const MAP_ICONS: MapIconDef[] = [
  {
    id: "heart",
    fallbackLabel: "Hjärta",
    iconNode: [
      [
        "path",
        {
          d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
        },
      ],
    ],
  },
  {
    id: "home",
    fallbackLabel: "Hem",
    iconNode: [
      ["path", { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }],
      [
        "path",
        {
          d: "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
        },
      ],
    ],
  },
  {
    id: "briefcase",
    fallbackLabel: "Jobb",
    iconNode: [
      ["path", { d: "M12 12h.01" }],
      ["path", { d: "M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" }],
      ["path", { d: "M22 13a18.15 18.15 0 0 1-20 0" }],
      ["rect", { width: 20, height: 14, x: 2, y: 6, rx: 2 }],
    ],
  },
  {
    id: "mapPin",
    fallbackLabel: "Plats",
    iconNode: [
      [
        "path",
        {
          d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
        },
      ],
      ["circle", { cx: 12, cy: 10, r: 3 }],
    ],
  },
  {
    id: "smile",
    fallbackLabel: "Smiley",
    iconNode: [
      ["circle", { cx: 12, cy: 12, r: 10 }],
      ["path", { d: "M8 14s1.5 2 4 2 4-2 4-2" }],
      ["line", { x1: 9, x2: 9.01, y1: 9, y2: 9 }],
      ["line", { x1: 15, x2: 15.01, y1: 9, y2: 9 }],
    ],
  },
  {
    id: "user",
    fallbackLabel: "Person",
    iconNode: [
      ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
      ["circle", { cx: 12, cy: 7, r: 4 }],
    ],
  },
  {
    id: "star",
    fallbackLabel: "Stjärna",
    iconNode: [
      [
        "path",
        {
          d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
        },
      ],
    ],
  },
  {
    id: "building",
    fallbackLabel: "Byggnad",
    iconNode: [
      ["path", { d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" }],
      ["path", { d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" }],
      ["path", { d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" }],
      ["path", { d: "M10 6h4" }],
      ["path", { d: "M10 10h4" }],
      ["path", { d: "M10 14h4" }],
      ["path", { d: "M10 18h4" }],
    ],
  },
  {
    id: "arrowRight",
    fallbackLabel: "Pil höger",
    iconNode: [
      ["path", { d: "M5 12h14" }],
      ["path", { d: "m12 5 7 7-7 7" }],
    ],
  },
  {
    id: "arrowLeft",
    fallbackLabel: "Pil vänster",
    iconNode: [
      ["path", { d: "m12 19-7-7 7-7" }],
      ["path", { d: "M19 12H5" }],
    ],
  },
  {
    id: "arrowUp",
    fallbackLabel: "Pil upp",
    iconNode: [
      ["path", { d: "m5 12 7-7 7 7" }],
      ["path", { d: "M12 19V5" }],
    ],
  },
  {
    id: "arrowDown",
    fallbackLabel: "Pil ner",
    iconNode: [
      ["path", { d: "M12 5v14" }],
      ["path", { d: "m19 12-7 7-7-7" }],
    ],
  },
  {
    id: "lifeBuoy",
    fallbackLabel: "Livboj",
    iconNode: [
      ["circle", { cx: 12, cy: 12, r: 10 }],
      ["path", { d: "m4.93 4.93 4.24 4.24" }],
      ["path", { d: "m14.83 9.17 4.24-4.24" }],
      ["path", { d: "m14.83 14.83 4.24 4.24" }],
      ["path", { d: "m9.17 14.83-4.24 4.24" }],
      ["circle", { cx: 12, cy: 12, r: 4 }],
    ],
  },
  {
    id: "ball",
    fallbackLabel: "Boll",
    iconNode: [
      ["path", { d: "M11.1 7.1a16.55 16.55 0 0 1 10.9 4" }],
      ["path", { d: "M12 12a12.6 12.6 0 0 1-8.7 5" }],
      ["path", { d: "M16.8 13.6a16.55 16.55 0 0 1-9 7.5" }],
      ["path", { d: "M20.7 17a12.8 12.8 0 0 0-8.7-5 13.3 13.3 0 0 1 0-10" }],
      ["path", { d: "M6.3 3.8a16.55 16.55 0 0 0 1.9 11.5" }],
      ["circle", { cx: 12, cy: 12, r: 10 }],
    ],
  },
  {
    id: "camera",
    fallbackLabel: "Kamera",
    iconNode: [
      [
        "path",
        {
          d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
        },
      ],
      ["circle", { cx: 12, cy: 13, r: 3 }],
    ],
  },
  {
    id: "zap",
    fallbackLabel: "Blixt",
    iconNode: [
      [
        "path",
        {
          d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
        },
      ],
    ],
  },
];

export const MAP_ICON_INITIAL_COUNT = 16;

export function getMapIcon(id: string): MapIconDef | undefined {
  return MAP_ICONS.find((i) => i.id === id);
}

/** Render an icon's iconNode as an inline SVG string for canvas rasterisation. */
export function iconSvgString(id: string, color = "#111", strokeWidth = 2): string | null {
  const def = getMapIcon(id);
  if (!def) return null;
  const inner = def.iconNode
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
