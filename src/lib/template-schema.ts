// Zod schema + TS types for the modular design template stored in
// `product_configs.template`. See `.lovable/plan.md` for the high-level model.
//
// Coordinate system: layer position/size are PERCENT of the FRONT zone of the
// design canvas. Marginal/line thickness is in millimetres so the print-file
// pipeline can convert them via PX_PER_CM.
import { z } from "zod";

// ---------- shared ----------
export const orientationSchema = z.enum(["portrait", "landscape"]);
export type Orientation = z.infer<typeof orientationSchema>;

export const aspectSchema = z.enum(["3:4", "4:3", "1:1"]);
export type Aspect = z.infer<typeof aspectSchema>;

export const productTypeSchema = z.enum(["poster", "canvas"]);
export type TemplateProductType = z.infer<typeof productTypeSchema>;

export const mapShapeSchema = z.enum(["circle", "heart", "star"]);
export type MapShape = z.infer<typeof mapShapeSchema>;

export const imageFitSchema = z.enum(["cover", "contain"]);
export const imageShapeSchema = z.enum(["rect", "square", "circle"]);
export const textAlignSchema = z.enum(["left", "center", "right"]);
export const lineOrientationSchema = z.enum(["horizontal", "vertical"]);

// Hex string `#RRGGBB`. We keep this loose on purpose — the editor enforces
// the picker, so a free-form hex is enough at the schema level.
export const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{6})$/u, "Must be a #RRGGBB hex colour");

// ---------- locks ----------
// Every layer carries the same lock surface. Defaults are set per layer-type
// where it makes sense (e.g. text font usually stays admin-controlled).
export const layerLocksSchema = z.object({
  position: z.boolean(),
  size: z.boolean(),
  shape: z.boolean(),
  content: z.boolean(),
  font: z.boolean(),
  visibility: z.boolean(),
  style: z.boolean(),
});
export type LayerLocks = z.infer<typeof layerLocksSchema>;

export const defaultLocks = (overrides: Partial<LayerLocks> = {}): LayerLocks => ({
  position: true,
  size: true,
  shape: true,
  content: false,
  font: true,
  visibility: true,
  style: true,
  ...overrides,
});

// ---------- per-type defaults ----------
export const mapDefaultsSchema = z.object({
  shape: mapShapeSchema,
  styleId: z.string().min(1),
  center: z.tuple([z.number(), z.number()]), // [lng, lat]
  zoom: z.number().min(0).max(22),
  showLabels: z.boolean(),
  // Optional admin-set default place metadata (used to hydrate "Vald plats" and
  // auto-build linked text content on customer-side load).
  placeName: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});
export type MapDefaults = z.infer<typeof mapDefaultsSchema>;

export const imageDefaultsSchema = z.object({
  url: z.string().url().optional(),
  fit: imageFitSchema,
  shape: imageShapeSchema,
});
export type ImageDefaults = z.infer<typeof imageDefaultsSchema>;

// Photo layer = a customer-fillable image placeholder. Distinct from `image`
// (which is admin-static art). Shape is shared with the map shape vocabulary
// + a plain rectangle.
export const photoShapeSchema = z.enum(["rect", "circle", "heart", "star"]);
export type PhotoShape = z.infer<typeof photoShapeSchema>;

export const photoDefaultsSchema = z.object({
  shape: photoShapeSchema,
  fit: imageFitSchema,
  /** Optional placeholder image URL the admin can supply for preview only. */
  placeholderUrl: z.string().url().optional(),
});
export type PhotoDefaults = z.infer<typeof photoDefaultsSchema>;

export const textDefaultsSchema = z.object({
  text: z.string(),
  font: z.string().min(1),
  fontSizePct: z.number().positive().max(100),
  align: textAlignSchema,
  color: hexColorSchema,
  // When set, this text auto-updates to match the selected place of the
  // referenced map layer (city/country/coords). Customer manual edits override
  // the auto-text until the field is cleared.
  linkedMapLayerId: z.string().nullable().optional(),
});
export type TextDefaults = z.infer<typeof textDefaultsSchema>;

export const lineDefaultsSchema = z.object({
  orientation: lineOrientationSchema,
  thicknessMm: z.number().positive().max(50),
  color: hexColorSchema,
});
export type LineDefaults = z.infer<typeof lineDefaultsSchema>;

export const marginDefaultsSchema = z.object({
  /** Margin thickness as % of the canvas SHORT side. Symmetric on all sides. */
  thicknessPct: z.number().min(0).max(40),
  color: hexColorSchema,
});
export type MarginDefaults = z.infer<typeof marginDefaultsSchema>;

// ---------- shape layer ----------
// Generic admin-only decoration: lines (h/v) and frames (rect, oval, double,
// rounded, decorative-corners). Strokes are in mm just like the legacy line
// layer so print + editor + 3D match exactly.
export const shapeKindSchema = z.enum([
  "line-horizontal",
  "line-vertical",
  "frame-rect",
  "frame-oval",
  "frame-double",
  "frame-rounded",
  "frame-corners",
]);
export type ShapeKind = z.infer<typeof shapeKindSchema>;

export const shapeDefaultsSchema = z.object({
  kind: shapeKindSchema,
  /** Stroke thickness in mm — true print measurement, identical formula
   *  to legacy line.thicknessMm so the editor visualises 1:1 with print. */
  strokeMm: z.number().positive().max(50),
  color: hexColorSchema,
  /** frame-rounded: corner radius as % of the shape's short side. */
  cornerRadiusPct: z.number().min(0).max(50).optional(),
  /** frame-double: gap (mm) between inner and outer stroke. */
  gapMm: z.number().min(0).max(50).optional(),
  /** frame-corners: which corner motif to draw. */
  cornerStyle: z.enum(["bracket", "art-deco", "floral"]).optional(),
});
export type ShapeDefaults = z.infer<typeof shapeDefaultsSchema>;

// ---------- layer base + discriminated union ----------
const layerBase = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  wPct: z.number().min(0).max(100),
  hPct: z.number().min(0).max(100),
  rotation: z.number().min(-360).max(360).default(0),
  zIndex: z.number().int(),
  locks: layerLocksSchema,
});

export const mapLayerSchema = layerBase.extend({
  type: z.literal("map"),
  defaults: mapDefaultsSchema,
});
export const imageLayerSchema = layerBase.extend({
  type: z.literal("image"),
  defaults: imageDefaultsSchema,
});
export const textLayerSchema = layerBase.extend({
  type: z.literal("text"),
  defaults: textDefaultsSchema,
});
export const lineLayerSchema = layerBase.extend({
  type: z.literal("line"),
  defaults: lineDefaultsSchema,
});
export const marginLayerSchema = layerBase.extend({
  type: z.literal("margin"),
  defaults: marginDefaultsSchema,
});
export const photoLayerSchema = layerBase.extend({
  type: z.literal("photo"),
  defaults: photoDefaultsSchema,
});
export const shapeLayerSchema = layerBase.extend({
  type: z.literal("shape"),
  defaults: shapeDefaultsSchema,
});

export const layerSchema = z.discriminatedUnion("type", [
  mapLayerSchema,
  imageLayerSchema,
  textLayerSchema,
  lineLayerSchema,
  marginLayerSchema,
  photoLayerSchema,
  shapeLayerSchema,
]);
export type TemplateLayer = z.infer<typeof layerSchema>;
export type LayerType = TemplateLayer["type"];

// ---------- layout per orientation ----------
export const orientationLayoutSchema = z.object({
  aspect: aspectSchema,
  background: z.object({ color: hexColorSchema }),
  layers: z.array(layerSchema),
});
export type OrientationLayout = z.infer<typeof orientationLayoutSchema>;

export const sizeOverrideSchema = z.object({
  portrait: orientationLayoutSchema.partial({ aspect: true, background: true }).optional(),
  landscape: orientationLayoutSchema.partial({ aspect: true, background: true }).optional(),
});
export type SizeOverride = z.infer<typeof sizeOverrideSchema>;

// ---------- product options (replaces old `supports` block) ----------
const posterOptionsSchema = z.object({
  enabled: z.boolean(),
  allowedSizes: z.array(z.string()),
  allowedFrames: z.array(z.string()),
});
const canvasOptionsSchema = z.object({
  enabled: z.boolean(),
  allowedSizes: z.array(z.string()),
  allowedDepths: z.array(z.string()),
});
export const aiStylePresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  thumbnailUrl: z.string().url().optional(),
  prompt: z.string().min(1),
  /** Per-template visibility toggle. Defaults to true for backwards-compat. */
  enabled: z.boolean().optional().default(true),
});
export type AiStylePreset = z.infer<typeof aiStylePresetSchema>;

export const mapStylePresetSchema = z.object({
  id: z.string().min(1),
  /** Per-template visibility toggle. Defaults to true for backwards-compat. */
  enabled: z.boolean().optional().default(true),
});
export type MapStylePreset = z.infer<typeof mapStylePresetSchema>;

export const productOptionsSchema = z.object({
  poster: posterOptionsSchema.optional(),
  canvas: canvasOptionsSchema.optional(),
  /** Available AI style presets shown in the customer editor. Optional —
   *  when missing/empty the AI section is hidden. */
  aiStyles: z.array(aiStylePresetSchema).optional(),
  /** Per-template enabled map styles. When missing the editor falls back to
   *  the legacy `config.map_styles` column, then to the full catalog. */
  mapStyles: z.array(mapStylePresetSchema).optional(),
});
export type ProductOptions = z.infer<typeof productOptionsSchema>;

// ---------- root template ----------
export const templateSchema = z
  .object({
    version: z.literal(1),
    publishedAt: z.string().datetime().nullable().optional(),
    productOptions: productOptionsSchema,
    orientations: z.array(orientationSchema).min(1),
    defaultLayout: z.object({
      portrait: orientationLayoutSchema,
      landscape: orientationLayoutSchema,
    }),
    sizeOverrides: z.record(z.string(), sizeOverrideSchema).default({}),
  })
  .superRefine((tpl, ctx) => {
    const anyEnabled =
      (tpl.productOptions.poster?.enabled ?? false) ||
      (tpl.productOptions.canvas?.enabled ?? false);
    if (!anyEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one product type must be enabled",
        path: ["productOptions"],
      });
    }
    for (const key of ["poster", "canvas"] as const) {
      const opt = tpl.productOptions[key];
      if (opt?.enabled && opt.allowedSizes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is enabled but has no allowedSizes`,
          path: ["productOptions", key, "allowedSizes"],
        });
      }
    }
  });

export type Template = z.infer<typeof templateSchema>;

export type ParseTemplateResult =
  | { ok: true; template: Template }
  | { ok: false; error: z.ZodError };

/**
 * `safeParse` + return either a typed template or a structured error report.
 * Use this at all read boundaries (loadConfig, edge function, snapshot).
 */
export function parseTemplate(value: unknown): ParseTemplateResult {
  const r = templateSchema.safeParse(value);
  return r.success ? { ok: true, template: r.data } : { ok: false, error: r.error };
}

export function isEmptyTemplate(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 0;
}
