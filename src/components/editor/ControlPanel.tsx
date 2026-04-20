import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Square, Circle, RectangleHorizontal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore } from "@/stores/editorStore";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { MAPBOX_STYLE_LABELS, type ProductConfig } from "@/lib/product-config";
import { FormatSection } from "./FormatSection";
import { Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  onProductChange: (handle: string) => void;
}

const cardClass =
  "rounded-2xl bg-card border border-border shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-4";

const BG_SWATCHES = [
  "#EFE7D6", // beige
  "#FFFFFF", // white
  "#F8F4EC", // off-white
  "#E5E5E5", // light gray
  "#D9CDB5", // sand
  "#D6E4D2", // light green
  "#CFE0EA", // light blue
  "#1A1A1A", // black
];

export function ControlPanel({ configs, activeHandle, onProductChange }: Props) {
  const {
    config,
    mapStyleId,
    setMapStyleId,
    applyPlace,
    placeName,
    showLabels,
    setShowLabels,
    mapShape,
    setMapShape,
    posterBgColor,
    setPosterBgColor,
    text,
    setText,
    textFont,
    setTextFont,
    textVisible,
    setTextVisible,
  } = useEditorStore();

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

  if (!config) return null;

  const onPick = (r: GeocodeResult) => {
    applyPlace({
      placeName: r.place_name,
      center: r.center,
      city: r.city,
      country: r.country,
    });
    setResults([]);
    setQuery("");
  };

  return (
    <Accordion type="single" collapsible defaultValue="plats" className="w-full space-y-3">
      {/* 1. Plats */}
      <AccordionItem value="plats" className={cn(cardClass, "border-b-0")}>
        <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
          Plats
        </AccordionTrigger>
        <AccordionContent className="pt-1 pb-4 space-y-4 overflow-visible">
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Vald plats</Label>
            <p className="text-sm font-medium font-serif-display text-base">{placeName}</p>
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Sök adress eller stad
            </Label>
            <Popover open={results.length > 0}>
              <PopoverTrigger asChild>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="t.ex. Drottninggatan 1, Stockholm"
                    className="pl-10 pr-10 h-12 rounded-full bg-background shadow-inner"
                  />
                  {searching && (
                    <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={6}
                onOpenAutoFocus={(e) => e.preventDefault()}
                className="p-0 w-[var(--radix-popover-trigger-width)] z-[60] rounded-2xl overflow-hidden"
              >
                <div className="max-h-[14rem] overflow-y-auto divide-y">
                  {results.slice(0, 4).map((r, i) => (
                    <button
                      key={i}
                      onClick={() => onPick(r)}
                      className="block w-full text-left px-4 py-2 text-sm hover:bg-accent transition h-[3.5rem] leading-tight"
                    >
                      {r.place_name}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tips: dra och zooma direkt i kartan för att finjustera.
          </p>
        </AccordionContent>
      </AccordionItem>

      {/* 2. Kartstil */}
      <AccordionItem value="kartstil" className={cn(cardClass, "border-b-0")}>
        <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
          Kartstil
        </AccordionTrigger>
        <AccordionContent className="pt-1 pb-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {config.map_styles.map((s) => (
              <button
                key={s}
                onClick={() => setMapStyleId(s)}
                className={cn(
                  "relative aspect-square rounded-xl overflow-hidden transition hover:-translate-y-0.5",
                  s === mapStyleId
                    ? "ring-2 ring-primary"
                    : "ring-1 ring-border",
                )}
              >
                <div className="absolute inset-0" style={{ background: stylePreviewBg(s) }} />
                <span className="absolute bottom-0 left-0 right-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 font-medium">
                  {MAPBOX_STYLE_LABELS[s] ?? s}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Label className="text-xs text-foreground">Visa områdesnamn på kartan</Label>
            <Switch checked={showLabels} onCheckedChange={setShowLabels} />
          </div>

          <div className="space-y-2 pt-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Kartans form</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "rect", label: "Standard", Icon: RectangleHorizontal },
                { id: "square", label: "Kvadrat", Icon: Square },
                { id: "circle", label: "Cirkel", Icon: Circle },
              ] as const).map(({ id, label, Icon }) => {
                const selected = mapShape === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMapShape(id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl transition",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-background ring-1 ring-border hover:bg-accent/50",
                    )}
                  >
                    <Icon className="h-7 w-7" />
                    <span className="text-[11px] font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Bakgrundsfärg</Label>
            <div className="flex flex-wrap gap-2 items-center">
              {BG_SWATCHES.map((c) => {
                const selected = posterBgColor.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPosterBgColor(c)}
                    className={cn(
                      "h-8 w-8 rounded-full transition border",
                      selected ? "ring-2 ring-primary ring-offset-2 ring-offset-card border-transparent" : "border-border",
                    )}
                    style={{ background: c }}
                    aria-label={c}
                  />
                );
              })}
              <label className="h-8 w-8 rounded-full border border-dashed border-border flex items-center justify-center cursor-pointer relative overflow-hidden">
                <input
                  type="color"
                  value={posterBgColor}
                  onChange={(e) => setPosterBgColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground">+</span>
              </label>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="text" className={cn(cardClass, "border-b-0")}>
        <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
          Text
        </AccordionTrigger>
        <AccordionContent className="pt-1 pb-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-foreground">Visa text</Label>
            <Switch checked={textVisible} onCheckedChange={setTextVisible} />
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Din text här…"
            maxLength={config.text_config.maxChars}
            rows={3}
            className="rounded-xl"
          />
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Typsnitt</Label>
            <div className="grid grid-cols-3 gap-2">
              {config.text_config.fonts.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={f === textFont ? "default" : "outline"}
                  onClick={() => setTextFont(f)}
                  style={{ fontFamily: f }}
                  className="text-xs rounded-full"
                >
                  {f.split(" ")[0]}
                </Button>
              ))}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 4. Format */}
      <AccordionItem value="format" className={cn(cardClass, "border-b-0")}>
        <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
          Format
        </AccordionTrigger>
        <AccordionContent className="pt-1 pb-4">
          <FormatSection configs={configs} activeHandle={activeHandle} onProductChange={onProductChange} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function stylePreviewBg(styleId: string): string {
  switch (styleId) {
    case "light-v11":
      return "linear-gradient(135deg, #f5f5f0, #e8e8e0)";
    case "dark-v11":
      return "linear-gradient(135deg, #1a1a2e, #16213e)";
    case "outdoors-v12":
      return "linear-gradient(135deg, #c8d99e, #8aa867)";
    case "satellite-v9":
      return "linear-gradient(135deg, #2d3a2e, #4a5d3f)";
    case "streets-v12":
      return "linear-gradient(135deg, #f0e8d8, #d4c89e)";
    case "navigation-night-v1":
      return "linear-gradient(135deg, #0a1929, #1c3a5c)";
    default:
      return "#888";
  }
}
