// Properties panel for the currently selected layer.
//   - Edit defaults per layer-type
//   - Toggle each lock independently
//   - Edit position/size numerically (snap to 5%)
//   - Map: search a default place (geocoding) → updates center/zoom +
//     placeName/city/country, AND auto-builds text for any linked text layers.
import React, { useEffect, useRef, useState } from "react";
import { Loader2, Search, Upload } from "lucide-react";
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
  TemplateLayer,
} from "@/lib/template-schema";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { applyAdminPlaceToLinkedTexts } from "@/lib/template-migrate";
import { MAP_STYLE_CATALOG } from "@/lib/map-style-catalog";
import { defaultPromptFor } from "@/lib/ai-photo-prompts";
import { uploadAiReferenceImage } from "@/lib/ai-reference-upload";
import { FONT_CATALOG, FONT_CATEGORY_LABELS, type FontCategory } from "@/lib/font-catalog";

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
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Text — defaults
          </p>
          <Field label="Innehåll">
            <Textarea
              value={layer.defaults.text}
              rows={3}
              onChange={(e) => updateDefaults({ text: e.target.value })}
            />
          </Field>
          <Field label="Typsnitt">
            <Select
              value={layer.defaults.font}
              onValueChange={(v) => updateDefaults({ font: v })}
            >
              <SelectTrigger>
                <SelectValue style={{ fontFamily: `"${layer.defaults.font}", system-ui, sans-serif` }} />
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Storlek (% av höjd)">
              <Input
                type="number"
                min={1}
                max={100}
                step={0.5}
                value={layer.defaults.fontSizePct}
                onChange={(e) => updateDefaults({ fontSizePct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Justering">
              <Select
                value={layer.defaults.align}
                onValueChange={(v) => updateDefaults({ align: v as typeof layer.defaults.align })}
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
          <Field label="Färg">
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
          <Field label="Länka till karta">
            <Select
              value={layer.defaults.linkedMapLayerId ?? "__none__"}
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
          {layer.defaults.linkedMapLayerId && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2 -mt-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Visa rader
              </p>
              {(["city", "country", "coordinates"] as const).map((key) => {
                const labels = { city: "Stad / ort", country: "Land", coordinates: "Koordinater" };
                const fields = layer.defaults.linkedMapFields ?? { city: true, country: true, coordinates: true };
                const checked = fields[key] ?? true;
                return (
                  <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) =>
                        updateDefaults({
                          linkedMapFields: { ...fields, [key]: c === true },
                        })
                      }
                    />
                    <span>{labels[key]}</span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground -mt-2">
            När länkad uppdateras texten automatiskt med valda rader (stad / land /
            koordinater) när kunden ändrar plats på den valda kartan, så länge kunden
            inte har redigerat texten manuellt.
          </p>
        </div>
      )}

      {layer.type === "photo" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Foto — defaults
          </p>
          <Field label="Form">
            <Select
              value={layer.defaults.shape}
              onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Rektangel</SelectItem>
                <SelectItem value="circle">Cirkel</SelectItem>
                <SelectItem value="heart">Hjärta</SelectItem>
                <SelectItem value="star">Stjärna</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Anpassning">
            <Select
              value={layer.defaults.fit}
              onValueChange={(v) => updateDefaults({ fit: v as typeof layer.defaults.fit })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Fyll (cover)</SelectItem>
                <SelectItem value="contain">Inrymd (contain)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Placeholder-bild (URL, valfri)">
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
            Visas i admin-canvas + kund-editor när inget kund-foto finns ännu.
          </p>
        </div>
      )}

      {layer.type === "aiPhoto" && (
        <AiPhotoDefaultsSection layer={layer} onChange={onChange} />
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

// ---------- AI-photo (face-swap reference) defaults ----------
function AiPhotoDefaultsSection({
  layer,
  onChange,
}: {
  layer: Extract<TemplateLayer, { type: "aiPhoto" }>;
  onChange: (next: TemplateLayer) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const updateDefaults = (patch: Partial<typeof layer.defaults>) => {
    onChange({ ...layer, defaults: { ...layer.defaults, ...patch } });
  };

  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Endast bildfiler stöds");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadAiReferenceImage(f);
      updateDefaults({ referenceImageUrl: url });
      toast.success("Referensbild uppladdad");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Okänt fel";
      toast.error("Uppladdning misslyckades", { description: msg });
    } finally {
      setUploading(false);
    }
  };

  const isRemoveBg = layer.defaults.subjectKind === "removeBackground";

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        AI-bild — defaults
      </p>
      <p className="text-[11px] text-muted-foreground -mt-1">
        {isRemoveBg
          ? "Kunden laddar upp en bild — vi tar bort bakgrunden och lägger till en lekfull prick-/akvarell-effekt runt motivet. Kunden kan dessutom välja en av de aktiverade AI-stilarna nedanför."
          : "Kunden laddar upp ett ansikte som byts in på referensbilden via AI. Allt annat (kläder, miljö, pose) bevaras från referensbilden."}
      </p>

      <Field label="Motiv">
        <Select
          value={layer.defaults.subjectKind}
          onValueChange={(v) => {
            const kind = v as AiPhotoSubjectKind;
            // Auto-fyll prompten med default för det nya motivet — admin kan
            // sedan redigera fritt.
            updateDefaults({ subjectKind: kind, swapPrompt: defaultPromptFor(kind) });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="human">Människa</SelectItem>
            <SelectItem value="pet">Hund / Katt</SelectItem>
            <SelectItem value="removeBackground">Ta bort bakgrund (ingen referens)</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {!isRemoveBg && (
        <div className="space-y-2">
          <Label className="text-xs">Referensbild</Label>
          {layer.defaults.referenceImageUrl ? (
            <div className="relative rounded-lg overflow-hidden border bg-muted aspect-square w-32">
              <img
                src={layer.defaults.referenceImageUrl}
                alt="Referensbild"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/40 aspect-square w-32 flex items-center justify-center text-[10px] text-muted-foreground text-center px-2">
              Ingen referensbild
            </div>
          )}
          <div className="flex gap-2">
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
              {layer.defaults.referenceImageUrl ? "Byt referensbild" : "Ladda upp referensbild"}
            </Button>
            {layer.defaults.referenceImageUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => updateDefaults({ referenceImageUrl: undefined })}
              >
                Ta bort
              </Button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      )}

      {isRemoveBg && (
        <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          Referensbild behövs inte. Kunden ser de AI-stilar du markerat som
          "enabled" i AI-stilar-sektionen — vald stil läggs på själva motivet
          medan bakgrunden alltid är borttagen.
        </p>
      )}

      <Field label="Form">
        <Select
          value={layer.defaults.shape}
          onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="rect">Rektangel</SelectItem>
            <SelectItem value="circle">Cirkel</SelectItem>
            <SelectItem value="heart">Hjärta</SelectItem>
            <SelectItem value="star">Stjärna</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Anpassning">
        <Select
          value={layer.defaults.fit}
          onValueChange={(v) => updateDefaults({ fit: v as typeof layer.defaults.fit })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cover">Fyll (cover)</SelectItem>
            <SelectItem value="contain">Inrymd (contain)</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label={isRemoveBg ? "Stylguide för prick-effekten (valfri)" : "Prompt (skickas till AI)"}>
        <Textarea
          rows={4}
          value={layer.defaults.swapPrompt}
          onChange={(e) => updateDefaults({ swapPrompt: e.target.value })}
        />
      </Field>
      {!isRemoveBg && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          Tips: referera till <code>input_image_1</code> (din referensbild =
          kostym/scen som ska behållas) och <code>input_image_2</code> (kundens
          foto = ansiktet som ska lyftas in). Var specifik om vad som ska
          bevaras (kläder, frisyr, miljö).
        </p>
      )}
    </div>
  );
}
