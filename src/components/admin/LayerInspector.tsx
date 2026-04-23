// Properties panel for the currently selected layer.
//   - Edit defaults per layer-type
//   - Toggle each lock independently
//   - Edit position/size numerically (snap to 5%)
//   - Map: search a default place (geocoding) → updates center/zoom +
//     placeName/city/country, AND auto-builds text for any linked text layers.
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { ProductConfig } from "@/lib/product-config";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  LayerLocks,
  TemplateLayer,
} from "@/lib/template-schema";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { applyAdminPlaceToLinkedTexts } from "@/lib/template-migrate";

interface Props {
  config: ProductConfig;
  layer: TemplateLayer | null;
  allLayers: TemplateLayer[];
  onChange: (next: TemplateLayer) => void;
  /** Bulk replacement (used when picking a default place updates linked texts). */
  onLayersChange?: (next: TemplateLayer[]) => void;
}

const LOCK_LABELS: Array<{ key: keyof LayerLocks; label: string }> = [
  { key: "position", label: "Position" },
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
                {config.map_styles.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
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
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {config.text_config.fonts.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
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
          <p className="text-[11px] text-muted-foreground -mt-2">
            När länkad uppdateras texten automatiskt med stad / koordinater när
            kunden ändrar plats på den valda kartan (om kunden inte har ändrat
            texten manuellt). Olänkade texter rörs aldrig av kartan.
          </p>
        </div>
      )}

      {/* Locks */}
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
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
