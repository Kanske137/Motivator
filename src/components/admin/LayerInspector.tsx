// Properties panel for the currently selected layer.
//   - Edit defaults per layer-type
//   - Toggle each lock independently
//   - Edit position/size numerically (snap to 5%)
//   - Map: search a default place (geocoding) → updates center/zoom +
//     placeName/city/country, AND auto-builds text for any linked text layers.
import React, { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
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
  AiPhotoSubjectKind,
  LayerLocks,
  LinkedTextToken,
  TemplateLayer,
  TextDecoration,
  TextSpan,
} from "@/lib/template-schema";
import { resolveLinkedTokens, substituteTokens, FALLBACK_PLACE } from "@/lib/text-typography";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { applyAdminPlaceToLinkedTexts } from "@/lib/template-migrate";
import { MAP_STYLE_CATALOG } from "@/lib/map-style-catalog";
import { uploadAiReferenceImage } from "@/lib/ai-reference-upload";
import { FONT_CATALOG, FONT_CATEGORY_LABELS, type FontCategory } from "@/lib/font-catalog";
import { BUILTIN_RECIPES, type MediaLayerAi } from "@/lib/ai-recipe";
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
  onChange: (next: TemplateLayer) => void;
  /** Bulk replacement (used when picking a default place updates linked texts). */
  onLayersChange?: (next: TemplateLayer[]) => void;
}

const LOCK_LABELS: Array<{ key: keyof LayerLocks; label: string }> = [
  { key: "position", label: "Position (karta pan/zoom)" },
  { key: "move", label: "Förflytta lager" },
  { key: "size", label: "Storlek" },
  { key: "shape", label: "Form" },
  { key: "content", label: "Innehåll" },
  { key: "font", label: "Typsnitt" },
  { key: "visibility", label: "Synlighet" },
  { key: "style", label: "Stil" },
];

export default function LayerInspector({ config, layer, allLayers, onChange, onLayersChange }: Props) {
  if (!layer) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Välj ett lager för att redigera dess inställningar.
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
      <Field label="Namn">
        <Input
          value={layer.name}
          onChange={(e) => onChange({ ...layer, name: e.target.value })}
        />
      </Field>

      {/* Position + size */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="X (%)">
          <Input
            type="number"
            value={layer.xPct}
            min={0}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, xPct: Number(e.target.value) })}
          />
        </Field>
        <Field label="Y (%)">
          <Input
            type="number"
            value={layer.yPct}
            min={0}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, yPct: Number(e.target.value) })}
          />
        </Field>
        <Field label="Bredd (%)">
          <Input
            type="number"
            value={layer.wPct}
            min={1}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, wPct: Number(e.target.value) })}
          />
        </Field>
        <Field label="Höjd (%)">
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
            Karta — defaults
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

          <Field label="Form">
            <Select
              value={layer.defaults.shape}
              onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Fyll lager (rektangel)</SelectItem>
                <SelectItem value="circle">Cirkel</SelectItem>
                <SelectItem value="heart">Hjärta</SelectItem>
                <SelectItem value="star">Stjärna</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kartstil">
            <Select
              value={layer.defaults.styleId}
              onValueChange={(v) => updateDefaults({ styleId: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MAP_STYLE_CATALOG.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lng">
              <Input
                type="number"
                step="0.0001"
                value={layer.defaults.center[0]}
                onChange={(e) =>
                  updateDefaults({ center: [Number(e.target.value), layer.defaults.center[1]] })
                }
              />
            </Field>
            <Field label="Lat">
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
          <Field label="Zoom">
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
            <Label className="text-sm">Visa labels</Label>
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
            Photo — defaults
          </p>
          <Field label="Shape">
            <Select
              value={layer.defaults.shape}
              onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Rectangle</SelectItem>
                <SelectItem value="circle">Circle</SelectItem>
                <SelectItem value="heart">Heart</SelectItem>
                <SelectItem value="star">Star</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fit">
            <Select
              value={layer.defaults.fit}
              onValueChange={(v) => updateDefaults({ fit: v as typeof layer.defaults.fit })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Fill (cover)</SelectItem>
                <SelectItem value="contain">Fit inside (contain)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Placeholder image (URL, optional)">
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
            Shown in the admin canvas and customer editor before a photo is uploaded.
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
            Marginal — defaults
          </p>
          <p className="text-[11px] text-muted-foreground">
            Symmetrisk marginal runt hela motivet. Tjockleken är samma åt alla
            sidor oavsett orientering. Kunden kan inte ändra detta.
          </p>
          <Field label={`Tjocklek: ${layer.defaults.thicknessPct}% av kortsidan`}>
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
          <Field label="Färg">
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
            Linje — defaults
          </p>
          <p className="text-[11px] text-muted-foreground">
            Position och längd styrs via X/Y/Bredd/Höjd ovan. Kunden kan inte
            ändra linjen.
          </p>
          <Field label="Orientering">
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
                <SelectItem value="horizontal">Horisontell</SelectItem>
                <SelectItem value="vertical">Vertikal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tjocklek (mm)">
            <Input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={layer.defaults.thicknessMm}
              onChange={(e) => updateDefaults({ thicknessMm: Number(e.target.value) })}
            />
          </Field>
          <Field label="Färg">
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
            Figur — defaults
          </p>
          <p className="text-[11px] text-muted-foreground">
            Admin-bara dekoration. Position och storlek styrs via X/Y/Bredd/Höjd
            ovan. Kunden kan inte ändra figuren.
          </p>
          <Field label="Form">
            <Select
              value={layer.defaults.kind}
              onValueChange={(v) => updateDefaults({ kind: v as typeof layer.defaults.kind })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="line-horizontal">Horisontell linje</SelectItem>
                <SelectItem value="line-vertical">Vertikal linje</SelectItem>
                <SelectItem value="frame-rect">Rektangulär ram</SelectItem>
                <SelectItem value="frame-oval">Oval ram</SelectItem>
                <SelectItem value="frame-rounded">Rundad ram</SelectItem>
                <SelectItem value="frame-double">Dubbel ram</SelectItem>
                <SelectItem value="frame-corners">Hörn-dekoration</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tjocklek (mm)">
            <Input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={layer.defaults.strokeMm}
              onChange={(e) => updateDefaults({ strokeMm: Number(e.target.value) })}
            />
          </Field>
          <Field label="Färg">
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
          {layer.defaults.kind === "frame-rounded" && (
            <Field label="Hörnradie (% av kortsida)">
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
            <Field label="Mellanrum (mm)">
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
            Lås per egenskap
          </p>
          <p className="text-xs text-muted-foreground">
            Olåsta egenskaper kan kunden ändra i editorn.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-2">
            {LOCK_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center justify-between gap-2 text-sm">
                <span>{label}</span>
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
        AI recipe
      </p>
      <Field label="Recipe">
        <Select value={recipeId} onValueChange={pickRecipe}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_RECIPE}>No recipe (plain photo)</SelectItem>
            <SelectGroup>
              <SelectLabel>Starters</SelectLabel>
              {BUILTIN_RECIPES.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectGroup>
            {saved.length > 0 && (
              <SelectGroup>
                <SelectLabel>Your recipes</SelectLabel>
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
          <Field label="What is the customer's photo of?">
            <Input
              value={binding?.motif ?? ""}
              placeholder="e.g. a pet, a person, a residential house"
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
            Tells the AI what to keep when it removes the background. Without it a
            whole-scene photo keeps its surroundings.
          </p>
        </>
      )}
    </div>
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
      <Label className="text-xs">Förvald plats</Label>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Vald: <span className="font-medium text-foreground">{current || "—"}</span>
      </p>
      <Popover open={results.length > 0}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök stad eller adress…"
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
      toast.message("Markera först en del av texten");
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
        Text — defaults
      </p>
      <Field label="Innehåll (Enter ger ny rad)">
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
          Förhandsvisning:{" "}
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
              return substituteTokens(d, place).replace(/\n/g, " · ") || "(tom)";
            })()}
          </span>
        </p>
      )}
      <Field label="Typsnitt">
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
                  <SelectLabel>{FONT_CATEGORY_LABELS[cat]}</SelectLabel>
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
        <Field label="Storlek (pt)">
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
        <Field label="Radavstånd">
          <Input
            type="number"
            min={0.8}
            max={3}
            step={0.05}
            value={d.lineHeight ?? 1.15}
            onChange={(e) => updateDefaults({ lineHeight: Number(e.target.value) })}
          />
        </Field>
        <Field label="Justering">
          <Select
            value={d.align}
            onValueChange={(v) => updateDefaults({ align: v as typeof d.align })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Vänster</SelectItem>
              <SelectItem value="center">Mitten</SelectItem>
              <SelectItem value="right">Höger</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {typeof d.fontSizePct === "number" && typeof d.fontSizePt !== "number" && (
        <p className="text-[11px] text-amber-600">
          Använder gammal storlek (% av höjd: {d.fontSizePct}%). Sätt en pt-storlek
          för att uppgradera.
        </p>
      )}
      <Field label="Färg">
        <Input
          type="color"
          value={d.color}
          onChange={(e) => updateDefaults({ color: e.target.value })}
        />
      </Field>
      <Field label="Bakgrundsfärg">
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
              Ta bort
            </button>
          ) : (
            <button
              type="button"
              onClick={() => updateDefaults({ backgroundColor: "#ffffff" })}
              className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            >
              Lägg till
            </button>
          )}
        </div>
      </Field>

      {/* Decoration */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Design (anpassar sig efter texten)
        </p>
        <Field label="Stil">
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
              <SelectItem value="none">Ingen</SelectItem>
              <SelectItem value="box">Ruta runt texten</SelectItem>
              <SelectItem value="side-rules">Streck på sidorna</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {decoration.kind !== "none" && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Tjocklek (mm)">
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
            <Field label="Padding (mm)">
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
            <Field label="Färg">
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
            <Field label="Strecklängd (mm) — tomt = elastisk">
              <Input
                type="number"
                min={0}
                max={300}
                step={1}
                value={decoration.ruleLengthMm ?? ""}
                placeholder="t.ex. 25"
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
            <Field label="Strecken börjar vid">
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
                  <SelectItem value="text-edge">Texten</SelectItem>
                  <SelectItem value="layer-edge">Layerkanten</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
      </div>

      {/* Map link */}
      <Field label="Länka till karta">
        <Select
          value={d.linkedMapLayerId ?? "__none__"}
          onValueChange={(v) =>
            updateDefaults({ linkedMapLayerId: v === "__none__" ? null : v })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Ingen (statisk text)</SelectItem>
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
            Länkade rader (drag för att ordna)
          </p>
          <p className="text-[10px] text-muted-foreground -mt-1">
            Ordningen avgör visningsordning. För finkontroll: skriv
            <code className="px-1">[[city]]</code>,
            <code className="px-1">[[country]]</code> eller
            <code className="px-1">[[coords]]</code> i innehållet — då följer
            renderaren din egen layout (samma rad eller egen rad).
          </p>
          {(["city", "country", "coordinates"] as const).map((tok) => {
            const labels = { city: "Stad / ort [[city]]", country: "Land [[country]]", coordinates: "Koordinater [[coords]]" };
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
                      Infoga
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
            Format-markeringar
          </p>
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            onClick={addSpanFromSelection}
          >
            + Markering
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Markera text i innehållet ovan, klicka <em>+ Markering</em> och sätt
          font/storlek/färg endast för det området.
        </p>
        {(d.spans ?? []).length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">Inga markeringar.</p>
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
          Ta bort
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
          placeholder="Typsnitt"
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
          Fet
        </label>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.italic}
            onCheckedChange={(c) => onChange({ italic: c === true })}
          />
          Kursiv
        </label>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.underline}
            onCheckedChange={(c) => onChange({ underline: c === true })}
          />
          Understruken
        </label>
      </div>
    </div>
  );
}
