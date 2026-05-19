// Mini text-layer preview rendered inside the admin LayerCanvas tile and
// inside template thumbnails. Reuses the customer `TextLayerView` so admin
// sees decoration (box / side-rules), spans, pt-sizing, AND substituted
// tokens (no raw [[city]] in the preview).
import type { TemplateLayer } from "@/lib/template-schema";
import { TextLayerView } from "@/components/editor/layers/TextLayerView";
import {
  substituteTokensWithSpans,
  FALLBACK_PLACE,
  type LinkedPlace,
} from "@/lib/text-typography";

type TextLayer = Extract<TemplateLayer, { type: "text" }>;

interface Props {
  /** Full text layer (preferred) — gives us linkedTokens/decoration/etc. */
  layer?: TextLayer;
  /** Legacy entry point: just the defaults object. */
  defaults?: TextLayer["defaults"];
  /** All layers in the same layout — used to find the linked map for
   *  substitution. Optional (Stockholm fallback). */
  allLayers?: TemplateLayer[];
  /** Layer pixel height (drives legacy %-of-height font-size fallback). */
  height: number;
  /** Layer pixel width — used as `position: relative` parent so the absolute
   *  TextLayerView fills the tile. Defaults to height when not provided. */
  width?: number;
  /** Canvas SHORT side in px — used to size pt against A4. */
  canvasShortPx?: number;
}

function pickPlaceFromMap(
  allLayers: TemplateLayer[] | undefined,
  linkedMapLayerId: string | null | undefined,
): LinkedPlace | null {
  if (!allLayers) return null;
  const candidates = allLayers.filter((l) => l.type === "map") as Array<
    Extract<TemplateLayer, { type: "map" }>
  >;
  if (candidates.length === 0) return null;
  const target = (linkedMapLayerId && candidates.find((m) => m.id === linkedMapLayerId)) || candidates[0];
  return {
    placeName: target.defaults.placeName ?? "",
    city: target.defaults.city ?? null,
    country: target.defaults.country ?? null,
    center: [target.defaults.center[0]!, target.defaults.center[1]!],
  };
}

export default function TextLayerPreview({
  layer,
  defaults,
  allLayers,
  height,
  width,
  canvasShortPx,
}: Props) {
  const d = layer?.defaults ?? defaults!;
  if (!d) return null;
  const w = width ?? height;
  const shortPx = canvasShortPx && canvasShortPx > 0 ? canvasShortPx : Math.min(w, height) * 3;
  const place = pickPlaceFromMap(allLayers, d.linkedMapLayerId) ?? FALLBACK_PLACE;
  const { text: effectiveText, spans: effectiveSpans } = substituteTokensWithSpans(d, place);

  // Synthesize a minimal layer wrapper if only `defaults` was passed (legacy).
  const synthetic: TextLayer = layer ?? ({
    id: "__preview__",
    name: "preview",
    type: "text",
    xPct: 0,
    yPct: 0,
    wPct: 100,
    hPct: 100,
    zIndex: 0,
    locks: {} as TextLayer["locks"],
    defaults: d,
  } as TextLayer);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <TextLayerView
        layer={synthetic}
        effectiveText={effectiveText}
        effectiveFont={d.font}
        effectiveSpans={effectiveSpans}
        canvasShortPx={shortPx}
        layerHeightPx={height}
      />
    </div>
  );
}
