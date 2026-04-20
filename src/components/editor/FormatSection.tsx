import { useEditorStore } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductConfig } from "@/lib/product-config";
import { FrameOption } from "./FrameOption";
import frameWhite from "@/assets/frames/frame-white.jpg";
import frameOak from "@/assets/frames/frame-oak.jpg";
import frameWalnut from "@/assets/frames/frame-walnut.jpg";
import frameBlack from "@/assets/frames/frame-black.jpg";

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  onProductChange: (handle: string) => void;
}

const FRAME_THUMBS: Record<string, string> = {
  Vit: frameWhite,
  Ek: frameOak,
  Valnöt: frameWalnut,
  Svart: frameBlack,
};

function formatDiff(diff: number): string {
  if (diff === 0) return "Ingen extra";
  if (diff > 0) return `+${diff} kr`;
  return `−${Math.abs(diff)} kr`;
}

function NoFrameIcon() {
  return (
    <svg viewBox="0 0 40 40" className="w-1/2 h-1/2" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="5" width="30" height="30" rx="1" strokeDasharray="3 3" />
    </svg>
  );
}

function DepthIcon({ depth }: { depth: string }) {
  const thickness = depth.includes("4") ? 14 : 7;
  return (
    <svg viewBox="0 0 40 40" className="w-2/3 h-2/3" fill="currentColor">
      <rect x="6" y={20 - thickness / 2} width="28" height={thickness} rx="1" opacity="0.85" />
    </svg>
  );
}

export function FormatSection({ configs, activeHandle, onProductChange }: Props) {
  const { config, size, variant, orientation, setSize, setVariant, setOrientation } = useEditorStore();

  if (!config) return null;

  const sizeDef = config.sizes.find((s) => s.size === size);
  const isCanvas = config.product_type === "canvas";
  const currentVariantPrice = sizeDef?.variants.find((v) => v.name === variant)?.price ?? 0;

  // size price diffs use the current variant name (or first variant) for fair comparison
  const variantNameForCompare = variant ?? sizeDef?.variants[0]?.name;
  const currentSizeBasePrice =
    sizeDef?.variants.find((v) => v.name === variantNameForCompare)?.price ?? currentVariantPrice;

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
              className="h-auto py-2.5"
              size="sm"
            >
              {c.product_type === "posters" ? "Poster" : "Canvas"}
            </Button>
          ))}
        </div>
      </div>

      {/* Storlek dropdown */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Storlek</Label>
        <Select value={size ?? undefined} onValueChange={setSize}>
          <SelectTrigger>
            <SelectValue placeholder="Välj storlek" />
          </SelectTrigger>
          <SelectContent>
            {config.sizes.map((s) => {
              const matchVariant =
                s.variants.find((v) => v.name === variantNameForCompare) ?? s.variants[0];
              const diff = (matchVariant?.price ?? 0) - currentSizeBasePrice;
              const isCurrent = s.size === size;
              return (
                <SelectItem key={s.size} value={s.size}>
                  <div className="flex items-center justify-between w-full gap-4">
                    <span>{s.size} cm</span>
                    {!isCurrent && (
                      <span className="text-xs text-muted-foreground">{formatDiff(diff)}</span>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Ram / Djup */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {isCanvas ? "Djup" : "Ram"}
        </Label>
        <div className={`grid gap-2 ${isCanvas ? "grid-cols-2" : "grid-cols-3"}`}>
          {sizeDef?.variants.map((v) => {
            const diff = v.price - currentVariantPrice;
            const isNoFrame = v.name.toLowerCase() === "ingen";
            return (
              <FrameOption
                key={v.name}
                name={v.name}
                thumbnail={isCanvas ? undefined : isNoFrame ? undefined : FRAME_THUMBS[v.name]}
                svg={isCanvas ? <DepthIcon depth={v.name} /> : isNoFrame ? <NoFrameIcon /> : undefined}
                selected={v.name === variant}
                onClick={() => setVariant(v.name)}
                priceLabel={formatDiff(diff)}
              />
            );
          })}
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
