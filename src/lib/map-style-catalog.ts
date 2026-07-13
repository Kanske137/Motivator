// Centralized catalog of all available Mapbox styles. Single source of truth
// for label + preview background. Per-template visibility is controlled via
// `productOptions.mapStyles` (Alt B), with backwards-compat fallback to the
// legacy `config.map_styles` column.
export interface MapStyleCatalogEntry {
  id: string;
  label: string;
  /** Optional i18n key for translated label. Falls back to `label` (Swedish). */
  labelKey?: string;
  previewBg: string;
  /** Full Mapbox style URL, e.g. mapbox://styles/username/style-id */
  styleUrl?: string;
  /** Static image thumbnail URL for the style picker */
  thumbnailUrl?: string;
}

export const MAP_STYLE_CATALOG: MapStyleCatalogEntry[] = [
  {
    id: "skandinavisk",
    label: "Skandinavisk",
    labelKey: "mapStyle.skandinavisk",
    previewBg: "linear-gradient(135deg, #f5f5f0, #e8e8e0)",
    styleUrl: "mapbox://styles/maybe137/cmp2m5h3e000u01sh1w0u5di8",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cmp2mwnte000s01shb15lbfnc/static/18.0686,59.3293,11,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "midnatt",
    label: "Midnatt",
    labelKey: "mapStyle.midnatt",
    previewBg: "linear-gradient(135deg, #1a1a2e, #16213e)",
    styleUrl: "mapbox://styles/maybe137/cmp2m7b2z001x01s6h0dz9kyz",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cmp2mydkw001m01sc4ry6azi8/static/18.0686,59.3293,11,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "outdoors-v12",
    label: "Mintgrön/Salvia",
    labelKey: "mapStyle.mintgron",
    previewBg: "linear-gradient(135deg, #d4e8d4, #a8d5a2)",
    styleUrl: "mapbox://styles/maybe137/cmp2o0s2j001z01sc62sueshh",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cmp2o1ftk000y01shhzca9vui/static/18.0686,59.3293,11,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "satellite-v9",
    label: "Marin Blå",
    labelKey: "mapStyle.marinbla",
    previewBg: "linear-gradient(135deg, #1a2f4a, #0d1b2a)",
    styleUrl: "mapbox://styles/maybe137/cmp2o2107000u01sh0f1v440n",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cmp2o2ojs000v01sh236bexlf/static/18.0686,59.3293,11,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "streets-v12",
    label: "Varm Beige/Cream",
    labelKey: "mapStyle.varmbeige",
    previewBg: "linear-gradient(135deg, #f5efe0, #e8dcc8)",
    styleUrl: "mapbox://styles/maybe137/cmp2o3bmm003301qrbg5vh3wc",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cmp2o3ymr000u01saaicbel9j/static/18.0686,59.3293,11,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "navigation-night-v1",
    label: "Djup Skogsgrön/Svart",
    labelKey: "mapStyle.skogsgron",
    previewBg: "linear-gradient(135deg, #0a1f0a, #051405)",
    styleUrl: "mapbox://styles/maybe137/cmp2o54dh000w01sh3a9n1l1v",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cmp2o5onl000v01sac1278wc7/static/18.0686,59.3293,11,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
];

export const MAP_STYLE_BY_ID: Record<string, MapStyleCatalogEntry> = Object.fromEntries(
  MAP_STYLE_CATALOG.map((s) => [s.id, s]),
);

export function mapStyleLabel(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.label ?? styleId;
}

export function mapStyleLabelKey(styleId: string): string | undefined {
  return MAP_STYLE_BY_ID[styleId]?.labelKey;
}

export function mapStylePreviewBg(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.previewBg ?? "#888";
}

export function mapStyleThumbnailUrl(styleId: string): string | undefined {
  return MAP_STYLE_BY_ID[styleId]?.thumbnailUrl;
}

/** Resolve the full Mapbox style URL for a given catalog style id. */
export function mapStyleUrl(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.styleUrl ?? `mapbox://styles/mapbox/${styleId}`;
}

/** Parse a mapbox://styles/username/style-id URL into its components. */
export function parseMapboxStyleUrl(
  url: string,
): { username: string; styleId: string } | null {
  const match = url.match(/mapbox:\/\/styles\/([^/]+)\/(.+)/);
  if (!match) return null;
  return { username: match[1], styleId: match[2] };
}

export function isKnownMapStyle(styleId: string): boolean {
  return styleId in MAP_STYLE_BY_ID;
}

interface MapStyleTogglesLike {
  productOptions?: {
    mapStyles?: Array<{ id: string; enabled?: boolean }>;
  } | null;
}

/**
 * Resolve the list of map style IDs visible in the customer editor for a given
 * template. Priority:
 *   1. `productOptions.mapStyles` (Alt B per-template enabling)
 *   2. Legacy `config.map_styles` column
 *   3. Full catalog (so a brand-new template still shows something)
 */
export function getEnabledMapStyleIds(
  template: MapStyleTogglesLike | null | undefined,
  legacyConfigStyles: string[] | null | undefined,
): string[] {
  const fromTemplate = template?.productOptions?.mapStyles;
  if (fromTemplate && fromTemplate.length > 0) {
    return fromTemplate
      .filter((s) => s.enabled !== false && isKnownMapStyle(s.id))
      .map((s) => s.id);
  }
  if (legacyConfigStyles && legacyConfigStyles.length > 0) {
    return legacyConfigStyles.filter(isKnownMapStyle);
  }
  return MAP_STYLE_CATALOG.map((s) => s.id);
}

/**
 * Resolve the enabled map style IDs for a SPECIFIC map layer, in customer display
 * order. Priority:
 *   1. The layer's own `styleOptions` (per-layer, Step B — array order = the order
 *      the customer sees, `enabled:false` hides one).
 *   2. Fallback to the template/legacy/catalog resolution above (for layers that
 *      haven't been given per-layer options yet).
 */
export function getLayerMapStyleIds(
  layerStyleOptions: Array<{ id: string; enabled?: boolean }> | null | undefined,
  template: MapStyleTogglesLike | null | undefined,
  legacyConfigStyles: string[] | null | undefined,
): string[] {
  if (layerStyleOptions && layerStyleOptions.length > 0) {
    return layerStyleOptions
      .filter((s) => s.enabled !== false && isKnownMapStyle(s.id))
      .map((s) => s.id);
  }
  return getEnabledMapStyleIds(template, legacyConfigStyles);
}
