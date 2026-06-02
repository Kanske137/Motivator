// Customer-placeable map icons. Each entry mirrors a compact filled SVG so
// we can render it both as React (in the editor) and as a raw SVG string for
// the canvas pipeline (cart thumbnails + Gelato print files). Pixel-for-pixel
// parity is guaranteed: editor preview === cart thumbnail === print file.
//
// Style: solid, Mapiful-like filled silhouettes on a 24x24 grid.

export type IconAttr = Record<string, string | number>;
export type IconNode = Array<[string, IconAttr]>;

export interface MapIconDef {
  id: string;
  /** Fallback Swedish label when no `mapIcon.<id>` translation exists. */
  fallbackLabel: string;
  iconNode: IconNode;
}

// All paths assume default `fill="currentColor"` and `stroke="none"`.
// Use `fillRule: "evenodd"` for shapes with holes (mapPin, smile, briefcase).
export const MAP_ICONS: MapIconDef[] = [
  {
    id: "heart",
    fallbackLabel: "Hjärta",
    iconNode: [
      [
        "path",
        {
          d: "M12 21s-7-4.6-9.5-9C.7 8.4 2.7 4 6.6 4 8.6 4 10.4 5 12 7c1.6-2 3.4-3 5.4-3 3.9 0 5.9 4.4 4.1 8C19 16.4 12 21 12 21z",
        },
      ],
    ],
  },
  {
    id: "home",
    fallbackLabel: "Hem",
    iconNode: [
      [
        "path",
        {
          d: "M12 3 2.5 11.2c-.4.3-.1 1 .4 1H4v8.3c0 .3.2.5.5.5H9.5V15h5v6h5c.3 0 .5-.2.5-.5v-8.3h1.1c.5 0 .8-.7.4-1L12 3z",
        },
      ],
    ],
  },
  {
    id: "briefcase",
    fallbackLabel: "Jobb",
    iconNode: [
      [
        "path",
        {
          d: "M9 3h6a2 2 0 0 1 2 2v2h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1h4V5a2 2 0 0 1 2-2zm0 2v2h6V5H9z",
          fillRule: "evenodd",
        },
      ],
    ],
  },
  {
    id: "mapPin",
    fallbackLabel: "Plats",
    iconNode: [
      [
        "path",
        {
          d: "M12 2a8 8 0 0 1 8 8c0 5.6-8 13-8 13S4 15.6 4 10a8 8 0 0 1 8-8zm0 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
          fillRule: "evenodd",
        },
      ],
    ],
  },
  {
    id: "smile",
    fallbackLabel: "Smiley",
    iconNode: [
      [
        "path",
        {
          d: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM8.5 9.5a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm7 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM7.6 14.5c1 1.7 2.6 2.7 4.4 2.7s3.4-1 4.4-2.7H7.6z",
          fillRule: "evenodd",
        },
      ],
    ],
  },
  {
    id: "user",
    fallbackLabel: "Person",
    iconNode: [
      ["circle", { cx: 12, cy: 8, r: 4 }],
      [
        "path",
        {
          d: "M4 21a8 8 0 0 1 16 0v.5a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5V21z",
        },
      ],
    ],
  },
  {
    id: "star",
    fallbackLabel: "Stjärna",
    iconNode: [
      [
        "path",
        {
          d: "M12 2.5 14.9 8.8l6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 21.1l1.4-6.8L2.2 9.6l6.9-.8L12 2.5z",
        },
      ],
    ],
  },
  {
    id: "building",
    fallbackLabel: "Byggnad",
    iconNode: [
      [
        "path",
        {
          d: "M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1h-4v-4h-4v4H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm3 4v2h2V6H8zm0 4v2h2v-2H8zm0 4v2h2v-2H8zm6-8v2h2V6h-2zm0 4v2h2v-2h-2zm0 4v2h2v-2h-2z",
          fillRule: "evenodd",
        },
      ],
    ],
  },
  {
    id: "arrowRight",
    fallbackLabel: "Pil höger",
    iconNode: [["path", { d: "M13 4 22 12l-9 8v-5H2v-6h11V4z" }]],
  },
  {
    id: "arrowLeft",
    fallbackLabel: "Pil vänster",
    iconNode: [["path", { d: "M11 4 2 12l9 8v-5h11V9H11V4z" }]],
  },
  {
    id: "arrowUp",
    fallbackLabel: "Pil upp",
    iconNode: [["path", { d: "M12 2 4 11h5v11h6V11h5l-8-9z" }]],
  },
  {
    id: "arrowDown",
    fallbackLabel: "Pil ner",
    iconNode: [["path", { d: "M12 22 4 13h5V2h6v11h5l-8 9z" }]],
  },
  {
    id: "lifeBuoy",
    fallbackLabel: "Fotboll",
    iconNode: [
      [
        "path",
        {
          d: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 5-3.5 2.5L10 14h4l1.5-4.5L12 7z",
          fillRule: "evenodd",
        },
      ],
    ],
  },
  {
    id: "ball",
    fallbackLabel: "Boll",
    iconNode: [
      [
        "path",
        {
          d: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 4-4 3 1.5 4.5h5L16 9l-4-3zM5 12l1.5 4 2-.5L7 12l-2 0zm14 0-2 0-1.5 3.5 2 .5L19 12z",
          fillRule: "evenodd",
        },
      ],
    ],
  },

  {
    id: "camera",
    fallbackLabel: "Kamera",
    iconNode: [
      [
        "path",
        {
          d: "M9 3h6l1.5 2H21a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5L9 3zm3 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
          fillRule: "evenodd",
        },
      ],
    ],
  },
  {
    id: "zap",
    fallbackLabel: "Blixt",
    iconNode: [["path", { d: "M13 2 3 14h6l-2 8 11-13h-6l1-7z" }]],
  },
];

export const MAP_ICON_INITIAL_COUNT = 16;

export function getMapIcon(id: string): MapIconDef | undefined {
  return MAP_ICONS.find((i) => i.id === id);
}

/** Convert React-style camelCase attr key to SVG kebab-case (fillRule → fill-rule). */
function svgAttrName(key: string): string {
  return key.replace(/([A-Z])/g, "-$1").toLowerCase();
}

/** Render an icon's iconNode as an inline SVG string for canvas rasterisation. */
export function iconSvgString(id: string, color = "#111"): string | null {
  const def = getMapIcon(id);
  if (!def) return null;
  const inner = def.iconNode
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${svgAttrName(k)}="${v}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${color}" stroke="none">${inner}</svg>`;
}
