// Default AI style presets seeded into ProductOptions.aiStyles when admin opens
// the editor for the first time and the list is empty. Prompts are tuned for
// Flux Kontext Pro (`replicate-style` edge function) and stay deliberately
// generic so they work on any photo.
//
// `bridge` states the medium and ends in "not a photo". Kontext ignores a terse
// `styleInstruction` on its own and hands back a photograph. The phrasings are
// verbatim from the legacy `bridge` regex in `replicate-face-swap/index.ts`,
// which inferred the medium by matching the label against Swedish and English
// words. Carrying it as data instead means nothing has to guess.
import type { AiStylePreset } from "./template-schema";

const THUMB_BASE =
  "https://ptzmnusfgdwcqpjpbyco.supabase.co/storage/v1/object/public/ai-references/style-thumbnails";

export const DEFAULT_AI_STYLES: AiStylePreset[] = [
  {
    id: "watercolor",
    label: "Akvarell",
    enabled: true,
    thumbnailUrl: `${THUMB_BASE}/watercolor.png`,
    prompt:
      "Transform this photo into a soft watercolor painting with delicate brush strokes, gentle pastel washes, and visible paper texture. Preserve the composition and main subject.",
    styleInstruction: "make this in watercolor styling",
    bridge:
      "soft watercolor painting, wet-on-wet washes, pigment bleed, visible paper grain, not a photo",
  },
  {
    id: "sketch",
    label: "Skiss",
    enabled: true,
    thumbnailUrl: `${THUMB_BASE}/sketch.png`,
    prompt:
      "Convert this photo into a detailed pencil sketch with fine cross-hatching, soft graphite shading on white paper. Keep the original composition.",
    styleInstruction: "make this in sketch styling",
    bridge:
      "pencil drawing, graphite strokes, paper grain, cross hatching, not a photo",
  },
  {
    id: "oil",
    label: "Olja",
    enabled: true,
    thumbnailUrl: `${THUMB_BASE}/oil.png`,
    prompt:
      "Reimagine this photo as a classical oil painting with thick impasto brush strokes, rich saturated colors, and dramatic light. Maintain the subject and framing.",
    styleInstruction: "make this in oil styling",
    bridge:
      "oil painting, impasto, brush strokes, canvas texture, not a photo",
  },
  {
    id: "pop-art",
    label: "Pop-art",
    enabled: true,
    thumbnailUrl: `${THUMB_BASE}/pop-art.png`,
    prompt:
      "Transform this photo into bold pop-art style with bright flat colors, halftone dots, thick outlines, and high contrast — Andy Warhol inspired.",
    styleInstruction: "make this in pop-art styling",
    bridge:
      "flat comic poster, halftone, hard outlines, saturated color blocks, not a photo",
  },
  {
    id: "lineart",
    label: "Linjekonst",
    enabled: true,
    thumbnailUrl: `${THUMB_BASE}/lineart.png`,
    prompt:
      "Convert this photo into clean minimalist line art — thin black continuous lines on a white background, no shading, no fill. Preserve the silhouette.",
    styleInstruction: "make this in line art styling",
    bridge:
      "black ink line drawing, minimal fill, white paper, not a photo",
  },
  {
    id: "vintage-poster",
    label: "Vintage",
    enabled: true,
    thumbnailUrl: `${THUMB_BASE}/vintage-poster.png`,
    prompt:
      "Reimagine this photo as a vintage travel poster from the 1950s — limited color palette, screen-printed look, slightly faded, retro typography vibe (no text).",
    styleInstruction: "make this in vintage art styling",
    bridge:
      "screen printed 1950s poster illustration, flat shapes, limited palette, grain, not a photo",
  },
];
