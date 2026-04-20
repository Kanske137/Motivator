import { useEditorStore } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ProductConfig } from "@/lib/product-config";

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  onProductChange: (handle: string) => void;
}

export function FormatSection({ configs, activeHandle, onProductChange }: Props) {
  const { config, size, variant, orientation, setSize, setVariant, setOrientation } = useEditorStore();

  if (!config) return null;

  const sizeDef = config.sizes.find((s) => s.size === size);
  const isCanvas = config.product_type === "canvas";

  return (
    <div className="space-y-5">
      {/* Produkt */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Produkt</Label>
        <div className="grid grid-cols-2 gap-2">
          {configs.map((c) => (
            <Button
              key={c.shopify_handle}
              variant={c.shopify_handle === activeHandle ? "default" : "outline"}
              onClick={() => onProductChange(c.shopify_handle)}
              className="h-auto py-3"
            >
              {c.product_type === "posters" ? "Poster" : "Canvas"}
            </Button>
          ))}
        </div>
      </div>

      {/* Storlek */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Storlek (cm)</Label>
        <div className="grid grid-cols-3 gap-2">
          {config.sizes.map((s) => (
            <Button
              key={s.size}
              size="sm"
              variant={s.size === size ? "default" : "outline"}
              onClick={() => setSize(s.size)}
            >
              {s.size}
            </Button>
          ))}
        </div>
      </div>

      {/* Ram / Djup */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {isCanvas ? "Djup" : "Ram"}
        </Label>
        <div className={`grid gap-2 ${isCanvas ? "grid-cols-2" : "grid-cols-3"}`}>
          {sizeDef?.variants.map((v) => (
            <Button
              key={v.name}
              size="sm"
              variant={v.name === variant ? "default" : "outline"}
              onClick={() => setVariant(v.name)}
              className="flex flex-col h-auto py-2"
            >
              <span>{v.name}</span>
              <span className="text-[10px] opacity-70">{v.price} kr</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Orientering */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Orientering</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant={orientation === "portrait" ? "default" : "outline"}
            onClick={() => setOrientation("portrait")}
          >
            Stående
          </Button>
          <Button
            size="sm"
            variant={orientation === "landscape" ? "default" : "outline"}
            onClick={() => setOrientation("landscape")}
          >
            Liggande
          </Button>
        </div>
      </div>
    </div>
  );
}
