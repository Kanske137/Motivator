// Properties panel for the currently selected layer.
//   - Edit defaults per layer-type
//   - Toggle each lock independently
//   - Edit position/size numerically (snap to 5%)
//   - Map: search a default place (geocoding) → updates center/zoom +
//     placeName/city/country, AND auto-builds text for any linked text layers.
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Loader2, Plus, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { ProductConfig } from "@/lib/product-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  LayerLocks,
  LinkedTextToken,
  MapStylePreset,
  ProductOptions,
  TemplateLayer,
  TextDecoration,
  TextSpan,
} from "@/lib/template-schema";
import { resolveLinkedTokens, substituteTokens, FALLBACK_PLACE } from "@/lib/text-typography";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { applyAdminPlaceToLinkedTexts } from "@/lib/template-migrate";
import {
  MAP_STYLE_CATALOG,
  MAP_STYLE_BY_ID,
  getEnabledMapStyleIds,
  isKnownMapStyle,
  mapStyleThumbnailUrl,
} from "@/lib/map-style-catalog";
import { uploadAiReferenceImage } from "@/lib/ai-reference-upload";
import { FONT_CATALOG, FONT_CATEGORY_LABELS, type FontCategory } from "@/lib/font-catalog";
import { BUILTIN_RECIPES, MODEL_CATALOG, recipeUsesReferences, type AiRecipe, type MediaLayerAi, type RecipeReference } from "@/lib/ai-recipe";
import { listRecipes, type SavedRecipe } from "@/lib/ai-recipes-api";

/** A sensible motif to prefill when a starter's subject is obvious. Blank = the
 *  merchant must say what the customer uploads. */
const STARTER_MOTIF: Record<string, string> = {
  "builtin-pet": "a pet",
  "builtin-face-swap": "a person",
};

interface Props {
  config: ProductConfig;
  layer: TemplateLayer | null;
  allLayers: TemplateLayer[];
  /** Template-level product options — used to seed a map layer's style list from
   *  the old template-level `mapStyles` the first time it's edited per-layer. */
  productOptions?: ProductOptions | null;
  onChange: (next: TemplateLayer) => void;
  /** Bulk replacement (used when picking a default place updates linked texts). */
  onLayersChange?: (next: TemplateLayer[]) => void;
}

const LOCK_LABELS: Array<{ key: keyof LayerLocks; labelKey: string }> = [
  { key: "position", labelKey: "admin.layerInspector.lockPosition" },
  { key: "move", labelKey: "admin.layerInspector.lockMove" },
  { key: "size", labelKey: "admin.layerInspector.lockSize" },
  { key: "shape", labelKey: "admin.layerInspector.lockShape" },
  { key: "content", labelKey: "admin.layerInspector.lockContent" },
  { key: "font", labelKey: "admin.layerInspector.lockFont" },
  { key: "visibility", labelKey: "admin.layerInspector.lockVisibility" },
  { key: "style", labelKey: "admin.layerInspector.lockStyle" },
];

export default function LayerInspector({ config, layer, allLayers, productOptions, onChange, onLayersChange }: Props) {
  const { t } = useTranslation();
  if (!layer) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {t("admin.layerInspector.selectLayerPrompt")}
      </p>
    );
  }

  function updateDefaults<T extends TemplateLayer>(patch: Partial<T["defaults"]>) {
    onChange({
      ...layer,
      defaults: { ...layer!.defaults, ...patch },
    } as TemplateLayer);
  }

  function updateLock(key: keyof LayerLocks, value: boolean) {
    onChange({ ...layer!, locks: { ...layer!.locks, [key]: value } });
  }

  return (
    <div className="space-y-5">
      {/* Name */}
      <Field label={t("admin.layerInspector.name")}>
        <Input
          value={layer.name}
          onChange={(e) => onChange({ ...layer, name: e.target.value })}
        />
      </Field>

      {/* Position + size */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("admin.layerInspector.xPercent")}>
          <Input
            type="number"
            value={layer.xPct}
            min={0}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, xPct: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("admin.layerInspector.yPercent")}>
          <Input
            type="number"
            value={layer.yPct}
            min={0}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, yPct: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("admin.layerInspector.widthPercent")}>
          <Input
            type="number"
            value={layer.wPct}
            min={1}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, wPct: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("admin.layerInspector.heightPercent")}>
          <Input
            type="number"
            value={layer.hPct}
            min={1}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, hPct: Number(e.target.value) })}
          />
        </Field>
      </div>

      {/* Type-specific defaults */}
      {layer.type === "map" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.mapDefaults")}
          </p>

          <DefaultPlaceSearch
            current={layer.defaults.placeName}
            onPick={(r) => {
              const mapId = layer.id;
              const nextMap: TemplateLayer = {
                ...layer,
                defaults: {
                  ...layer.defaults,
                  center: r.center,
                  placeName: r.place_name,
                  city: r.city,
                  country: r.country,
                },
              };
              if (onLayersChange) {
                const replaced = allLayers.map((l) => (l.id === mapId ? nextMap : l));
                const propagated = applyAdminPlaceToLinkedTexts(replaced, mapId, {
                  placeName: r.place_name,
                  city: r.city,
                  country: r.country,
                  center: r.center,
                });
                onLayersChange(propagated);
              } else {
                onChange(nextMap);
              }
            }}
          />

          <Field label={t("admin.layerInspector.shape")}>
            <Select
              value={layer.defaults.shape}
              onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">{t("admin.layerInspector.mapShapeRect")}</SelectItem>
                <SelectItem value="circle">{t("admin.layerInspector.shapeCircle")}</SelectItem>
                <SelectItem value="heart">{t("admin.layerInspector.shapeHeart")}</SelectItem>
                <SelectItem value="star">{t("admin.layerInspector.shapeStar")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("admin.layerInspector.mapStyle")}>
            <MapStyleListEditor
              value={layer.defaults.styleOptions}
              seedEnabledIds={getEnabledMapStyleIds(
                productOptions ? { productOptions } : null,
                config.map_styles,
              )}
              onChange={(next) => {
                const firstEnabled = next.find((s) => s.enabled !== false)?.id;
                updateDefaults({
                  styleOptions: next,
                  ...(firstEnabled ? { styleId: firstEnabled } : {}),
                });
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("admin.layerInspector.lng")}>
              <Input
                type="number"
                step="0.0001"
                value={layer.defaults.center[0]}
                onChange={(e) =>
                  updateDefaults({ center: [Number(e.target.value), layer.defaults.center[1]] })
                }
              />
            </Field>
            <Field label={t("admin.layerInspector.lat")}>
              <Input
                type="number"
                step="0.0001"
                value={layer.defaults.center[1]}
                onChange={(e) =>
                  updateDefaults({ center: [layer.defaults.center[0], Number(e.target.value)] })
                }
              />
            </Field>
          </div>
          <Field label={t("admin.layerInspector.zoom")}>
            <Input
              type="number"
              step="0.5"
              min={0}
              max={22}
              value={layer.defaults.zoom}
              onChange={(e) => updateDefaults({ zoom: Number(e.target.value) })}
            />
          </Field>
          <div className="flex items-center justify-between">
            <Label className="text-sm">{t("admin.layerInspector.showLabels")}</Label>
            <Switch
              checked={layer.defaults.showLabels}
              onCheckedChange={(c) => updateDefaults({ showLabels: c })}
            />
          </div>
        </div>
      )}

      {layer.type === "text" && (
        <TextLayerDefaults
          layer={layer}
          allLayers={allLayers}
          updateDefaults={updateDefaults}
        />
      )}

      {layer.type === "photo" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.photoDefaults")}
          </p>
          <Field label={t("admin.layerInspector.shape")}>
            <Select
              value={layer.defaults.shape}
              onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">{t("admin.layerInspector.photoShapeRect")}</SelectItem>
                <SelectItem value="circle">{t("admin.layerInspector.shapeCircle")}</SelectItem>
                <SelectItem value="heart">{t("admin.layerInspector.shapeHeart")}</SelectItem>
                <SelectItem value="star">{t("admin.layerInspector.shapeStar")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("admin.layerInspector.fit")}>
            <Select
              value={layer.defaults.fit}
              onValueChange={(v) => updateDefaults({ fit: v as typeof layer.defaults.fit })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">{t("admin.layerInspector.fitCover")}</SelectItem>
                <SelectItem value="contain">{t("admin.layerInspector.fitContain")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("admin.layerInspector.placeholderImage")}>
            <Input
              value={layer.defaults.placeholderUrl ?? ""}
              placeholder="https://…"
              onChange={(e) =>
                updateDefaults({
                  placeholderUrl: e.target.value.trim() ? e.target.value.trim() : undefined,
                })
              }
            />
          </Field>
          <p className="text-[11px] text-muted-foreground -mt-1">
            {t("admin.layerInspector.placeholderHint")}
          </p>

          <PhotoRecipeBinding
            binding={layer.defaults.ai}
            onChange={(ai) => updateDefaults({ ai })}
          />
        </div>
      )}

      {layer.type === "margin" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.marginDefaults")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("admin.layerInspector.marginHint")}
          </p>
          <Field label={t("admin.layerInspector.thicknessOfShortSide", { pct: layer.defaults.thicknessPct })}>
            <Input
              type="number"
              min={0}
              max={40}
              step={0.5}
              value={layer.defaults.thicknessPct}
              onChange={(e) =>
                updateDefaults({ thicknessPct: Math.max(0, Math.min(40, Number(e.target.value))) })
              }
            />
          </Field>
          <Field label={t("admin.layerInspector.color")}>
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
        </div>
      )}

      {layer.type === "line" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.lineDefaults")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("admin.layerInspector.lineHint")}
          </p>
          <Field label={t("admin.layerInspector.orientation")}>
            <Select
              value={layer.defaults.orientation}
              onValueChange={(v) => {
                const nextOrientation = v as typeof layer.defaults.orientation;
                if (nextOrientation === layer.defaults.orientation) return;
                // Swap width/height so the line keeps its length when rotating,
                // and re-centre so it doesn't visually jump.
                const newW = layer.hPct;
                const newH = layer.wPct;
                const cx = layer.xPct + layer.wPct / 2;
                const cy = layer.yPct + layer.hPct / 2;
                const clamp = (n: number, min: number, max: number) =>
                  Math.max(min, Math.min(max, n));
                const newX = clamp(cx - newW / 2, 0, Math.max(0, 100 - newW));
                const newY = clamp(cy - newH / 2, 0, Math.max(0, 100 - newH));
                onChange({
                  ...layer,
                  xPct: newX,
                  yPct: newY,
                  wPct: newW,
                  hPct: newH,
                  defaults: { ...layer.defaults, orientation: nextOrientation },
                });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="horizontal">{t("admin.layerInspector.orientationHorizontal")}</SelectItem>
                <SelectItem value="vertical">{t("admin.layerInspector.orientationVertical")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("admin.layerInspector.thicknessMm")}>
            <Input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={layer.defaults.thicknessMm}
              onChange={(e) => updateDefaults({ thicknessMm: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("admin.layerInspector.color")}>
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
        </div>
      )}

      {layer.type === "shape" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.shapeDefaults")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("admin.layerInspector.shapeHint")}
          </p>
          <Field label={t("admin.layerInspector.shape")}>
            <Select
              value={layer.defaults.kind}
              onValueChange={(v) => updateDefaults({ kind: v as typeof layer.defaults.kind })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="line-horizontal">{t("admin.layerInspector.shapeKindLineHorizontal")}</SelectItem>
                <SelectItem value="line-vertical">{t("admin.layerInspector.shapeKindLineVertical")}</SelectItem>
                <SelectItem value="frame-rect">{t("admin.layerInspector.shapeKindFrameRect")}</SelectItem>
                <SelectItem value="frame-oval">{t("admin.layerInspector.shapeKindFrameOval")}</SelectItem>
                <SelectItem value="frame-rounded">{t("admin.layerInspector.shapeKindFrameRounded")}</SelectItem>
                <SelectItem value="frame-double">{t("admin.layerInspector.shapeKindFrameDouble")}</SelectItem>
                <SelectItem value="frame-corners">{t("admin.layerInspector.shapeKindFrameCorners")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("admin.layerInspector.thicknessMm")}>
            <Input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={layer.defaults.strokeMm}
              onChange={(e) => updateDefaults({ strokeMm: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("admin.layerInspector.color")}>
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
          {layer.defaults.kind === "frame-rounded" && (
            <Field label={t("admin.layerInspector.cornerRadius")}>
              <Input
                type="number"
                min={0}
                max={50}
                step={1}
                value={layer.defaults.cornerRadiusPct ?? 5}
                onChange={(e) => updateDefaults({ cornerRadiusPct: Number(e.target.value) })}
              />
            </Field>
          )}
          {layer.defaults.kind === "frame-double" && (
            <Field label={t("admin.layerInspector.gapMm")}>
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={layer.defaults.gapMm ?? 4}
                onChange={(e) => updateDefaults({ gapMm: Number(e.target.value) })}
              />
            </Field>
          )}
        </div>
      )}

      {/* Locks — hidden for admin-only layer types */}
      {layer.type !== "margin" && layer.type !== "line" && layer.type !== "shape" && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.locksHeading")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("admin.layerInspector.locksHint")}
          </p>
          <div className="grid grid-cols-2 gap-2 pt-2">
            {LOCK_LABELS.map(({ key, labelKey }) => (
              <label key={key} className="flex items-center justify-between gap-2 text-sm">
                <span>{t(labelKey)}</span>
                <Switch
                  checked={layer.locks[key]}
                  onCheckedChange={(c) => updateLock(key, c)}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const Field = React.forwardRef<HTMLDivElement, { label: string; children: React.ReactNode }>(
  ({ label, children }, ref) => (
    <div ref={ref} className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  ),
);
Field.displayName = "Field";

// ---------- map layer → per-layer style list (toggle + reorder) ----------
// Which map styles this layer offers the customer, and in what order. The array
// order IS the customer-facing order; `enabled:false` hides a style. Seeds from
// the old template-level list the first time so existing templates keep behaviour.
function MapStyleListEditor({
  value,
  seedEnabledIds,
  onChange,
}: {
  value: MapStylePreset[] | undefined;
  seedEnabledIds: string[];
  onChange: (next: MapStylePreset[]) => void;
}) {
  const { t } = useTranslation();

  // Working list = the full catalog in the current order, with enable flags.
  const list: MapStylePreset[] =
    value && value.length > 0
      ? [
          ...value.filter((v) => isKnownMapStyle(v.id)),
          // Append any catalog styles not yet in the stored list (disabled).
          ...MAP_STYLE_CATALOG.filter((s) => !value.some((v) => v.id === s.id)).map((s) => ({
            id: s.id,
            enabled: false,
          })),
        ]
      : MAP_STYLE_CATALOG.map((s) => ({ id: s.id, enabled: seedEnabledIds.includes(s.id) }));

  const enabledCount = list.filter((x) => x.enabled !== false).length;
  const toggle = (id: string, enabled: boolean) =>
    onChange(list.map((x) => (x.id === id ? { ...x, enabled } : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        {t("admin.layerInspector.mapStylesHint", { count: enabledCount, total: list.length })}
      </p>
      {list.map((item, i) => {
        const cat = MAP_STYLE_BY_ID[item.id];
        const label = cat?.labelKey ? t(cat.labelKey, { defaultValue: cat.label }) : cat?.label ?? item.id;
        const enabled = item.enabled !== false;
        const thumb = mapStyleThumbnailUrl(item.id);
        return (
          <div key={item.id} className="flex items-center gap-2 rounded-md border bg-background p-1.5">
            <div className="flex flex-col">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={t("admin.layerInspector.moveUp")}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
                aria-label={t("admin.layerInspector.moveDown")}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            {thumb ? (
              <img
                src={thumb}
                alt={label}
                className="h-8 w-8 shrink-0 rounded border object-cover"
                loading="lazy"
                draggable={false}
              />
            ) : (
              <div
                className="h-8 w-8 shrink-0 rounded border"
                style={{ background: cat?.previewBg }}
                aria-hidden
              />
            )}
            <span className={`flex-1 truncate text-sm ${enabled ? "" : "text-muted-foreground line-through"}`}>
              {label}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={(c) => toggle(item.id, c)}
              aria-label={t("admin.mapStyles.enableAria", { label })}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------- photo layer → optional recipe binding ----------
// The photo/aiPhoto merge at the UI: a photo layer optionally points at a
// recipe. "No recipe" = plain photo. Choosing a recipe reveals the motif field —
// what the customer's photo depicts — which the executor injects as {motif}.
const NO_RECIPE = "__none__";

function PhotoRecipeBinding({
  binding,
  onChange,
}: {
  binding: MediaLayerAi | undefined;
  onChange: (ai: MediaLayerAi | undefined) => void;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<SavedRecipe[]>([]);
  useEffect(() => {
    // Best-effort: starters always work even if the shop has no saved recipes.
    listRecipes().then(setSaved).catch(() => setSaved([]));
  }, []);

  const recipeId = binding?.recipeId ?? NO_RECIPE;
  const chosen =
    BUILTIN_RECIPES.find((r) => r.id === recipeId) ?? saved.find((r) => r.id === recipeId);

  function pickRecipe(id: string) {
    if (id === NO_RECIPE) {
      onChange(undefined);
      return;
    }
    onChange({
      recipeId: id,
      references: binding?.references ?? [],
      // Prefill an obvious subject; keep an existing motif when re-picking.
      motif: binding?.motif ?? STARTER_MOTIF[id],
    });
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("admin.layerInspector.aiRecipe")}
      </p>
      <Field label={t("admin.layerInspector.recipe")}>
        <Select value={recipeId} onValueChange={pickRecipe}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_RECIPE}>{t("admin.layerInspector.noRecipe")}</SelectItem>
            <SelectGroup>
              <SelectLabel>{t("admin.layerInspector.starters")}</SelectLabel>
              {BUILTIN_RECIPES.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectGroup>
            {saved.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t("admin.layerInspector.yourRecipes")}</SelectLabel>
                {saved.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </Field>

      {chosen && (
        <>
          {chosen.description && (
            <p className="text-[11px] text-muted-foreground -mt-1">{chosen.description}</p>
          )}

          {recipeUsesReferences(chosen) && (
            <ReferenceImagesEditor
              recipe={chosen}
              references={binding?.references ?? []}
              onChange={(references) => onChange({ recipeId, references, motif: binding?.motif })}
            />
          )}

          {(chosen.prompt ?? "").includes("{motif}") && (
            <>
              <Field label={t("admin.layerInspector.motifQuestion")}>
                <Input
                  value={binding?.motif ?? ""}
                  placeholder={t("admin.layerInspector.motifPlaceholder")}
                  onChange={(e) =>
                    onChange({
                      recipeId,
                      references: binding?.references ?? [],
                      motif: e.target.value.trim() ? e.target.value : undefined,
                    })
                  }
                />
              </Field>
              <p className="text-[11px] text-muted-foreground -mt-1">
                {t("admin.layerInspector.motifHint")}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Admin editor for a recipe binding's reference images (the costume/scene the
 *  customer's photo is placed onto). Shown for recipes whose model consumes
 *  references (face-swap / ai-edit). Upload one, or several so the customer can
 *  switch between them. Orientation tags let a reference target portrait or
 *  landscape canvases. */
function ReferenceImagesEditor({
  recipe,
  references,
  onChange,
}: {
  recipe: AiRecipe;
  references: RecipeReference[];
  onChange: (refs: RecipeReference[]) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // References are a picker pool — the customer chooses one and only that is
  // sent — so there is no upper bound. `required` = the recipe can't run without
  // at least one (face-swap).
  const required = MODEL_CATALOG[recipe.model].referenceImages.min > 0;

  async function onFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadAiReferenceImage(f);
      const id = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `ref-${Date.now()}`;
      onChange([...references, { id, url, orientation: "any" }]);
    } catch (e) {
      console.error("[LayerInspector] reference upload failed", e);
      toast.error(t("admin.layerInspector.uploadReferenceFailed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Field label={required ? t("admin.layerInspector.referenceImages") : t("admin.layerInspector.referenceImagesOptional")}>
      <div className="space-y-2">
        {references.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {references.map((r) => (
              <div key={r.id} className="space-y-1">
                <div className="relative aspect-square rounded-lg overflow-hidden ring-1 ring-border bg-muted">
                  <img src={r.url} alt={r.label ?? ""} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onChange(references.filter((x) => x.id !== r.id))}
                    className="absolute top-1 right-1 bg-background/85 rounded-md p-1 text-destructive hover:bg-background"
                    title={t("admin.layerInspector.remove")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <Select
                  value={r.orientation ?? "any"}
                  onValueChange={(v) =>
                    onChange(
                      references.map((x) =>
                        x.id === r.id ? { ...x, orientation: v as RecipeReference["orientation"] } : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t("admin.layerInspector.orientationBoth")}</SelectItem>
                    <SelectItem value="portrait">{t("admin.layerInspector.orientationPortrait")}</SelectItem>
                    <SelectItem value="landscape">{t("admin.layerInspector.orientationLandscape")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-1.5" />
          )}
          {t("admin.layerInspector.addReference")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <p className="text-[11px] text-muted-foreground">
          {t("admin.layerInspector.referenceHint")}
        </p>
      </div>
    </Field>
  );
}

// ---------- inline geocoding search for default place ----------
function DefaultPlaceSearch({
  current,
  onPick,
}: {
  current: string | undefined;
  onPick: (r: GeocodeResult) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await geocode(q);
      setResults(r);
      setSearching(false);
    }, 300);
    return () => {
      clearTimeout(t);
      setSearching(false);
    };
  }, [query]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t("admin.layerInspector.defaultPlace")}</Label>
      <p className="text-[11px] text-muted-foreground -mt-1">
        {t("admin.layerInspector.selectedLabel")}{" "}
        <span className="font-medium text-foreground">{current || "—"}</span>
      </p>
      <Popover open={results.length > 0}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("admin.layerInspector.searchPlacePlaceholder")}
              className="pl-9 pr-9"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="p-0 w-[var(--radix-popover-trigger-width)] z-[60] rounded-lg overflow-hidden"
        >
          <div className="max-h-56 overflow-y-auto divide-y">
            {results.slice(0, 5).map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  onPick(r);
                  setQuery("");
                  setResults([]);
                }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-accent transition"
              >
                {r.place_name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}


// =====================================================================
// Text layer v2 — defaults section
// =====================================================================
// (TextLayerDefaults helpers — types/imports defined at top of file)

function TextLayerDefaults({
  layer,
  allLayers,
  updateDefaults,
}: {
  layer: Extract<TemplateLayer, { type: "text" }>;
  allLayers: TemplateLayer[];
  updateDefaults: (patch: Partial<Extract<TemplateLayer, { type: "text" }>["defaults"]>) => void;
}) {
  const { t } = useTranslation();
  const d = layer.defaults;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokens = resolveLinkedTokens(d);
  const decoration: TextDecoration = d.decoration ?? {
    kind: "none",
    thicknessMm: 0.5,
    color: "#000000",
    paddingMm: 2,
  };

  function insertAtCursor(text: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? d.text.length;
    const end = ta.selectionEnd ?? d.text.length;
    const next = d.text.slice(0, start) + text + d.text.slice(end);
    updateDefaults({ text: next });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function moveToken(idx: number, dir: -1 | 1) {
    const next = [...tokens];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    updateDefaults({ linkedTokens: next });
  }

  function toggleToken(tok: LinkedTextToken) {
    const has = tokens.includes(tok);
    const next = has ? tokens.filter((t) => t !== tok) : [...tokens, tok];
    updateDefaults({ linkedTokens: next });
  }

  function addSpanFromSelection() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    if (end <= start) {
      toast.message(t("admin.layerInspector.selectTextFirst"));
      return;
    }
    const next: TextSpan[] = [...(d.spans ?? []), { start, end }];
    updateDefaults({ spans: next });
  }

  function updateSpan(i: number, patch: Partial<TextSpan>) {
    const arr = [...(d.spans ?? [])];
    arr[i] = { ...arr[i], ...patch };
    updateDefaults({ spans: arr });
  }
  function removeSpan(i: number) {
    const arr = [...(d.spans ?? [])];
    arr.splice(i, 1);
    updateDefaults({ spans: arr });
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("admin.layerInspector.textDefaults")}
      </p>
      <Field label={t("admin.layerInspector.contentEnterNewline")}>
        <Textarea
          ref={textareaRef}
          value={d.text}
          rows={4}
          onChange={(e) => updateDefaults({ text: e.target.value })}
          className="font-mono text-sm"
        />
      </Field>
      {(d.linkedMapLayerId || /\[\[(city|country|coords?)\]\]/.test(d.text)) && (
        <p className="text-[11px] text-muted-foreground -mt-1 px-0.5">
          {t("admin.layerInspector.preview")}{" "}
          <span className="font-medium text-foreground/80 whitespace-pre-wrap">
            {(() => {
              const sibling = allLayers.find(
                (l) => l.type === "map" && (!d.linkedMapLayerId || l.id === d.linkedMapLayerId),
              );
              const place =
                sibling && sibling.type === "map"
                  ? {
                      placeName: sibling.defaults.placeName ?? "",
                      city: sibling.defaults.city ?? null,
                      country: sibling.defaults.country ?? null,
                      center: [sibling.defaults.center[0]!, sibling.defaults.center[1]!] as [number, number],
                    }
                  : FALLBACK_PLACE;
              return substituteTokens(d, place).replace(/\n/g, " · ") || t("admin.layerInspector.emptyPreview");
            })()}
          </span>
        </p>
      )}
      <Field label={t("admin.layerInspector.font")}>
        <Select value={d.font} onValueChange={(v) => updateDefaults({ font: v })}>
          <SelectTrigger>
            <SelectValue style={{ fontFamily: `"${d.font}", system-ui, sans-serif` }} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {(["sans", "serif", "display", "script", "mono"] as FontCategory[]).map((cat) => {
              const items = FONT_CATALOG.filter((f) => f.category === cat);
              if (items.length === 0) return null;
              return (
                <SelectGroup key={cat}>
                  <SelectLabel>{t(`admin.fonts.category.${cat}`, { defaultValue: FONT_CATEGORY_LABELS[cat] })}</SelectLabel>
                  {items.map((f) => (
                    <SelectItem
                      key={f.family}
                      value={f.family}
                      style={{ fontFamily: `"${f.family}", system-ui, sans-serif` }}
                    >
                      {f.family}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("admin.layerInspector.sizePt")}>
          <Input
            type="number"
            min={4}
            max={400}
            step={1}
            value={d.fontSizePt ?? ""}
            placeholder="12"
            onChange={(e) => {
              const n = Number(e.target.value);
              updateDefaults({ fontSizePt: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
          />
        </Field>
        <Field label={t("admin.layerInspector.lineHeight")}>
          <Input
            type="number"
            min={0.8}
            max={3}
            step={0.05}
            value={d.lineHeight ?? 1.15}
            onChange={(e) => updateDefaults({ lineHeight: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("admin.layerInspector.align")}>
          <Select
            value={d.align}
            onValueChange={(v) => updateDefaults({ align: v as typeof d.align })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">{t("admin.layerInspector.alignLeft")}</SelectItem>
              <SelectItem value="center">{t("admin.layerInspector.alignCenter")}</SelectItem>
              <SelectItem value="right">{t("admin.layerInspector.alignRight")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {typeof d.fontSizePct === "number" && typeof d.fontSizePt !== "number" && (
        <p className="text-[11px] text-amber-600">
          {t("admin.layerInspector.legacySizeWarning", { pct: d.fontSizePct })}
        </p>
      )}
      <Field label={t("admin.layerInspector.color")}>
        <Input
          type="color"
          value={d.color}
          onChange={(e) => updateDefaults({ color: e.target.value })}
        />
      </Field>
      <Field label={t("admin.layerInspector.backgroundColor")}>
        <div className="flex items-center gap-2">
          <Input
            type="color"
            value={d.backgroundColor || "#ffffff"}
            onChange={(e) => updateDefaults({ backgroundColor: e.target.value })}
            disabled={!d.backgroundColor}
            className="flex-1"
          />
          {d.backgroundColor ? (
            <button
              type="button"
              onClick={() => updateDefaults({ backgroundColor: undefined })}
              className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            >
              {t("admin.layerInspector.remove")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => updateDefaults({ backgroundColor: "#ffffff" })}
              className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            >
              {t("admin.layerInspector.add")}
            </button>
          )}
        </div>
      </Field>

      {/* Decoration */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("admin.layerInspector.designHeading")}
        </p>
        <Field label={t("admin.layerInspector.style")}>
          <Select
            value={decoration.kind}
            onValueChange={(v) =>
              updateDefaults({
                decoration: { ...decoration, kind: v as TextDecoration["kind"] },
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("admin.layerInspector.decorationNone")}</SelectItem>
              <SelectItem value="box">{t("admin.layerInspector.decorationBox")}</SelectItem>
              <SelectItem value="side-rules">{t("admin.layerInspector.decorationSideRules")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {decoration.kind !== "none" && (
          <div className="grid grid-cols-3 gap-2">
            <Field label={t("admin.layerInspector.thicknessMm")}>
              <Input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={decoration.thicknessMm}
                onChange={(e) =>
                  updateDefaults({
                    decoration: { ...decoration, thicknessMm: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label={t("admin.layerInspector.paddingMm")}>
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={decoration.paddingMm}
                onChange={(e) =>
                  updateDefaults({
                    decoration: { ...decoration, paddingMm: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label={t("admin.layerInspector.color")}>
              <Input
                type="color"
                value={decoration.color}
                onChange={(e) =>
                  updateDefaults({
                    decoration: { ...decoration, color: e.target.value },
                  })
                }
              />
            </Field>
          </div>
        )}
        {decoration.kind === "side-rules" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("admin.layerInspector.ruleLength")}>
              <Input
                type="number"
                min={0}
                max={300}
                step={1}
                value={decoration.ruleLengthMm ?? ""}
                placeholder={t("admin.layerInspector.ruleLengthPlaceholder")}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  updateDefaults({
                    decoration: {
                      ...decoration,
                      ruleLengthMm: Number.isFinite(n) && n > 0 ? n : undefined,
                    },
                  });
                }}
              />
            </Field>
            <Field label={t("admin.layerInspector.ruleStartAt")}>
              <Select
                value={decoration.ruleAlign ?? "text-edge"}
                onValueChange={(v) =>
                  updateDefaults({
                    decoration: { ...decoration, ruleAlign: v as "text-edge" | "layer-edge" },
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text-edge">{t("admin.layerInspector.ruleAlignText")}</SelectItem>
                  <SelectItem value="layer-edge">{t("admin.layerInspector.ruleAlignLayerEdge")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
      </div>

      {/* Map link */}
      <Field label={t("admin.layerInspector.linkToMap")}>
        <Select
          value={d.linkedMapLayerId ?? "__none__"}
          onValueChange={(v) =>
            updateDefaults({ linkedMapLayerId: v === "__none__" ? null : v })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("admin.layerInspector.noneStaticText")}</SelectItem>
            {allLayers
              .filter((l) => l.type === "map")
              .map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name || m.id}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      {d.linkedMapLayerId && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.linkedRowsHeading")}
          </p>
          <p className="text-[10px] text-muted-foreground -mt-1">
            {t("admin.layerInspector.linkedRowsHintPre")}{" "}
            <code className="px-1">[[city]]</code>,
            <code className="px-1">[[country]]</code> {t("admin.layerInspector.linkedRowsHintOr")}{" "}
            <code className="px-1">[[coords]]</code> {t("admin.layerInspector.linkedRowsHintPost")}
          </p>
          {(["city", "country", "coordinates"] as const).map((tok) => {
            const labels = { city: t("admin.layerInspector.tokenLabelCity"), country: t("admin.layerInspector.tokenLabelCountry"), coordinates: t("admin.layerInspector.tokenLabelCoordinates") };
            const idx = tokens.indexOf(tok);
            const checked = idx !== -1;
            return (
              <div key={tok} className="flex items-center gap-2 text-xs">
                <Checkbox checked={checked} onCheckedChange={() => toggleToken(tok)} />
                <span className="flex-1">{labels[tok]}</span>
                {checked && (
                  <>
                    <button
                      type="button"
                      className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-muted"
                      disabled={idx <= 0}
                      onClick={() => moveToken(idx, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-muted"
                      disabled={idx >= tokens.length - 1}
                      onClick={() => moveToken(idx, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-muted"
                      onClick={() => insertAtCursor(`[[${tok === "coordinates" ? "coords" : tok}]]`)}
                    >
                      {t("admin.layerInspector.insert")}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Spans (rich text overrides) */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.layerInspector.formatMarkings")}
          </p>
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            onClick={addSpanFromSelection}
          >
            {t("admin.layerInspector.addMarking")}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("admin.layerInspector.spanHintPre")} <em>{t("admin.layerInspector.addMarking")}</em> {t("admin.layerInspector.spanHintPost")}
        </p>
        {(d.spans ?? []).length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">{t("admin.layerInspector.noMarkings")}</p>
        )}
        {(d.spans ?? []).map((s, i) => (
          <SpanEditor
            key={i}
            span={s}
            text={d.text}
            onChange={(p) => updateSpan(i, p)}
            onRemove={() => removeSpan(i)}
          />
        ))}
      </div>
    </div>
  );
}

function SpanEditor({
  span,
  text,
  onChange,
  onRemove,
}: {
  span: TextSpan;
  text: string;
  onChange: (p: Partial<TextSpan>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const slice = text.slice(span.start, span.end);
  return (
    <div className="rounded border bg-background p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <code className="text-[11px] truncate flex-1 bg-muted px-1.5 py-0.5 rounded">
          [{span.start}–{span.end}] "{slice}"
        </code>
        <button
          type="button"
          className="text-[11px] text-destructive hover:underline"
          onClick={onRemove}
        >
          {t("admin.layerInspector.remove")}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          type="number"
          placeholder="pt"
          value={span.fontSizePt ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ fontSizePt: Number.isFinite(n) && n > 0 ? n : undefined });
          }}
        />
        <Input
          placeholder={t("admin.layerInspector.font")}
          value={span.font ?? ""}
          onChange={(e) => onChange({ font: e.target.value || undefined })}
        />
        <Input
          type="color"
          value={span.color ?? "#000000"}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.bold}
            onCheckedChange={(c) => onChange({ bold: c === true })}
          />
          {t("admin.layerInspector.bold")}
        </label>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.italic}
            onCheckedChange={(c) => onChange({ italic: c === true })}
          />
          {t("admin.layerInspector.italic")}
        </label>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.underline}
            onCheckedChange={(c) => onChange({ underline: c === true })}
          />
          {t("admin.layerInspector.underline")}
        </label>
      </div>
    </div>
  );
}
