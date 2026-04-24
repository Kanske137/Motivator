// Centralized catalog of all available Mapbox styles. Single source of truth
// for label + preview background. Per-template visibility is controlled via
// `productOptions.mapStyles` (Alt B), with backwards-compat fallback to the
// legacy `config.map_styles` column.
export interface MapStyleCatalogEntry {
  id: string;
  label: string;
  previewBg: string;
}

export const MAP_STYLE_CATALOG: MapStyleCatalogEntry[] = [
  {
    id: "light-v11",
    label: "Ljus",
    previewBg: "linear-gradient(135deg, #f5f5f0, #e8e8e0)",
  },
  {
    id: "dark-v11",
    label: "Mörk",
    previewBg: "linear-gradient(135deg, #1a1a2e, #16213e)",
  },
  {
    id: "outdoors-v12",
    label: "Terräng",
    previewBg: "linear-gradient(135deg, #c8d99e, #8aa867)",
  },
  {
    id: "satellite-v9",
    label: "Satellit",
    previewBg: "linear-gradient(135deg, #2d3a2e, #4a5d3f)",
  },
  {
    id: "streets-v12",
    label: "Gatukarta",
    previewBg: "linear-gradient(135deg, #f0e8d8, #d4c89e)",
  },
  {
    id: "navigation-night-v1",
    label: "Natt",
    previewBg: "linear-gradient(135deg, #0a1929, #1c3a5c)",
  },
];

export const MAP_STYLE_BY_ID: Record<string, MapStyleCatalogEntry> = Object.fromEntries(
  MAP_STYLE_CATALOG.map((s) => [s.id, s]),
);

export function mapStyleLabel(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.label ?? styleId;
}

export function mapStylePreviewBg(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.previewBg ?? "#888";
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
