import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore } from "@/stores/editorStore";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { MAPBOX_STYLE_LABELS, type ProductConfig } from "@/lib/product-config";
import { FormatSection } from "./FormatSection";
import { Loader2, Search } from "lucide-react";

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  onProductChange: (handle: string) => void;
}

export function ControlPanel({ configs, activeHandle, onProductChange }: Props) {
  const {
    config,
    mapZoom,
    setMapZoom,
    mapStyleId,
    setMapStyleId,
    setMapCenter,
    setPlaceName,
    placeName,
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

  if (!config) return null;

  const onSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const r = await geocode(query);
    setResults(r);
    setSearching(false);
  };

  const onPick = (r: GeocodeResult) => {
    setMapCenter(r.center);
    setPlaceName(r.place_name);
    setResults([]);
    setQuery("");
  };

  return (
    <Accordion type="multiple" defaultValue={["format", "plats"]} className="w-full">
      <AccordionItem value="format">
        <AccordionTrigger className="text-sm font-semibold">Format</AccordionTrigger>
        <AccordionContent className="pt-3">
          <FormatSection configs={configs} activeHandle={activeHandle} onProductChange={onProductChange} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="plats">
        <AccordionTrigger className="text-sm font-semibold">Plats</AccordionTrigger>
        <AccordionContent className="pt-3 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Vald plats</Label>
            <p className="text-sm font-medium">{placeName}</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Sök adress eller stad</Label>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
                placeholder="t.ex. Drottninggatan 1, Stockholm"
              />
              <Button size="icon" variant="outline" onClick={onSearch} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {results.length > 0 && (
              <div className="rounded-md border bg-card divide-y max-h-56 overflow-y-auto">
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => onPick(r)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                  >
                    {r.place_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Zoom: {mapZoom.toFixed(1)}</Label>
            <Slider
              value={[mapZoom]}
              min={1}
              max={20}
              step={0.1}
              onValueChange={(v) => setMapZoom(v[0])}
            />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="kartstil">
        <AccordionTrigger className="text-sm font-semibold">Kartstil</AccordionTrigger>
        <AccordionContent className="pt-3">
          <div className="grid grid-cols-3 gap-2">
            {config.map_styles.map((s) => (
              <button
                key={s}
                onClick={() => setMapStyleId(s)}
                className={`relative aspect-square rounded-md overflow-hidden border-2 transition ${
                  s === mapStyleId ? "border-primary ring-2 ring-primary/30" : "border-border"
                }`}
              >
                <div
                  className="absolute inset-0"
                  style={{ background: stylePreviewBg(s) }}
                />
                <span className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm text-[10px] py-1 font-medium">
                  {MAPBOX_STYLE_LABELS[s] ?? s}
                </span>
              </button>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="text">
        <AccordionTrigger className="text-sm font-semibold">Text</AccordionTrigger>
        <AccordionContent className="pt-3 space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Visa text</Label>
            <Switch checked={textVisible} onCheckedChange={setTextVisible} />
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Din text här…"
            maxLength={config.text_config.maxChars}
            rows={3}
          />
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Typsnitt</Label>
            <div className="grid grid-cols-3 gap-2">
              {config.text_config.fonts.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={f === textFont ? "default" : "outline"}
                  onClick={() => setTextFont(f)}
                  style={{ fontFamily: f }}
                  className="text-xs"
                >
                  {f.split(" ")[0]}
                </Button>
              ))}
            </div>
          </div>
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
