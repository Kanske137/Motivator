import { forwardRef } from "react";
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
  if (diff === 0) return "+0 kr";
  if (diff > 0) return `+${diff} kr`;
  return `−${Math.abs(diff)} kr`;
}

const NoFrameIcon = forwardRef<SVGSVGElement>((_, ref) => (
  <svg ref={ref} viewBox="0 0 40 40" className="w-1/2 h-1/2" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="5" width="30" height="30" rx="1" strokeDasharray="3 3" />
  </svg>
));
NoFrameIcon.displayName = "NoFrameIcon";

const DepthIcon = forwardRef<SVGSVGElement, { depth: string }>(({ depth }, ref) => {
  const thickness = depth.includes("4") ? 14 : 7;
  return (
    <svg ref={ref} viewBox="0 0 40 40" className="w-2/3 h-2/3" fill="currentColor">
      <rect x="6" y={20 - thickness / 2} width="28" height={thickness} rx="1" opacity="0.85" />
    </svg>
  );
});
DepthIcon.displayName = "DepthIcon";

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
      {/* Produkt — segmented pill toggle */}
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Produkt</Label>
        <div className="flex p-1 bg-muted rounded-full">
          {configs.map((c) => {
            const active = c.shopify_handle === activeHandle;
            return (
              <button
                key={c.shopify_handle}
                onClick={() => onProductChange(c.shopify_handle)}
                className={`flex-1 h-10 rounded-full text-sm font-medium transition ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground/70 hover:text-foreground"
                }`}
              >
                {c.product_type === "posters" ? "Poster" : "Canvas"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Storlek dropdown */}
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Storlek</Label>
        <Select value={size ?? undefined} onValueChange={setSize}>
          <SelectTrigger className="h-12 rounded-full px-5 text-base">
            <SelectValue placeholder="Välj storlek" />
          </SelectTrigger>
          <SelectContent className="rounded-2xl">
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
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
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

      {/* Orientering — segmented pill */}
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Orientering</Label>
        <div className="flex p-1 bg-muted rounded-full">
          {([
            { id: "portrait", label: "Stående" },
            { id: "landscape", label: "Liggande" },
          ] as const).map(({ id, label }) => {
            const active = orientation === id;
            return (
              <button
                key={id}
                onClick={() => setOrientation(id)}
                className={`flex-1 h-10 rounded-full text-sm font-medium transition ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground/70 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
