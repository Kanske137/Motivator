import { useEditorStore } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  POSTER_SIZES, POSTER_FRAMES, POSTER_PRICES,
  CANVAS_SIZES, CANVAS_DEPTHS, CANVAS_PRICES,
} from "@/lib/pricing";
import { RotateCw } from "lucide-react";

export function StepSize() {
  const { productType, size, variant, orientation, setSize, setOrientation, next, back } = useEditorStore();
  if (!productType) return null;

  const sizes = productType === "posters" ? POSTER_SIZES : CANVAS_SIZES;
  const variants = productType === "posters" ? POSTER_FRAMES : CANVAS_DEPTHS;
  const prices = productType === "posters" ? POSTER_PRICES : CANVAS_PRICES;
  const variantLabel = productType === "posters" ? "Ram" : "Djup";
  const currentPrice = size && variant ? prices[size]?.[variant] : null;

  return (
    <div className="p-4 space-y-5 pb-24">
      <div className="space-y-2">
        <label className="text-sm font-medium">Orientering</label>
        <div className="grid grid-cols-2 gap-2">
          {(["portrait", "landscape"] as const).map((o) => (
            <button
              key={o}
              onClick={() => setOrientation(o)}
              className={`p-3 rounded-md border text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                orientation === o ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <RotateCw className={`size-4 ${o === "landscape" ? "rotate-90" : ""}`} />
              {o === "portrait" ? "Stående" : "Liggande"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Storlek (cm)</label>
        <div className="grid grid-cols-3 gap-2">
          {sizes.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s, variant || variants[0])}
              className={`py-3 rounded-md border text-sm font-medium transition-colors ${
                size === s ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{variantLabel}</label>
        <div className="grid grid-cols-2 gap-2">
          {variants.map((v) => (
            <button
              key={v}
              onClick={() => setSize(size || sizes[0], v)}
              className={`py-3 rounded-md border text-sm font-medium transition-colors ${
                variant === v ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {currentPrice !== null && (
        <Card className="p-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Pris</span>
          <span className="text-2xl font-bold">{currentPrice} kr</span>
        </Card>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={back}>Tillbaka</Button>
        <Button className="flex-1" disabled={!size || !variant} onClick={next}>Förhandsvisa</Button>
      </div>
    </div>
  );
}
