import { forwardRef, useMemo } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deriveTemplateSlug, getEffectiveSizes, type ProductConfig } from "@/lib/product-config";
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
  const { config, productOptions, template, size, variant, orientation, setSize, setVariant, setOrientation } = useEditorStore();

  const allowedOrientations = template?.orientations ?? ["portrait", "landscape"];

  // Auto-switch to a valid orientation if the current one is disabled by admin.
  useMemo(() => {
    if (!allowedOrientations.includes(orientation) && allowedOrientations[0]) {
      setOrientation(allowedOrientations[0]);
    }
  }, [allowedOrientations, orientation, setOrientation]);

  // Group configs by template_slug → only the configs from the SAME template
  // appear in the Poster/Canvas toggle. This is what fixes the "third Poster
  // option" bug: multiple templates no longer show up here.
  const templateSlug = useMemo(
    () => (config ? config.template_slug ?? deriveTemplateSlug(config.shopify_handle) : ""),
    [config],
  );

  const sameTemplateConfigs = useMemo(() => {
    if (!templateSlug) return [] as ProductConfig[];
    return configs.filter(
      (c) => (c.template_slug ?? deriveTemplateSlug(c.shopify_handle)) === templateSlug,
    );
  }, [configs, templateSlug]);

  if (!config) return null;

  const isCanvas = config.product_type === "canvas";

  // Filter sizes/variants by template's productOptions (admin-controlled).
  // Falls back to all sizes/variants from config when template is missing/empty.
  const allowedSizes = isCanvas
    ? productOptions?.canvas?.allowedSizes
    : productOptions?.poster?.allowedSizes;
  const allowedVariants = isCanvas
    ? productOptions?.canvas?.allowedDepths
    : productOptions?.poster?.allowedFrames;

  // Effective sizes: legacy `config.sizes` if populated, otherwise derived
  // from productOptions × pricing tables. Then filtered to the admin-allowed
  // subset.
  const effectiveSizes = getEffectiveSizes(config, productOptions);
  const visibleSizes = effectiveSizes.filter(
    (s) => !allowedSizes || allowedSizes.length === 0 || allowedSizes.includes(s.size),
  );
  const sizeDef = visibleSizes.find((s) => s.size === size) ?? effectiveSizes.find((s) => s.size === size);
  const visibleVariants = (sizeDef?.variants ?? []).filter(
    (v) => !allowedVariants || allowedVariants.length === 0 || allowedVariants.includes(v.name),
  );

  const currentVariantPrice = sizeDef?.variants.find((v) => v.name === variant)?.price ?? 0;

  // Build a stable Poster/Canvas toggle from the template group (each kind
  // shows up at most once even if multiple configs leak in).
  type Kind = "poster" | "canvas";
  const kindToConfig = new Map<Kind, ProductConfig>();
  for (const c of sameTemplateConfigs) {
    const k: Kind = c.product_type === "canvas" ? "canvas" : "poster";
    if (!kindToConfig.has(k)) kindToConfig.set(k, c);
  }

  const toggleEntries: { kind: Kind; label: string; handle: string; active: boolean }[] = [];
  for (const k of ["poster", "canvas"] as Kind[]) {
    const c = kindToConfig.get(k);
    if (!c) continue;
    toggleEntries.push({
      kind: k,
      label: k === "poster" ? "Poster" : "Canvas",
      handle: c.shopify_handle,
      active: c.shopify_handle === activeHandle,
    });
  }

  // size price diffs use the current variant name (or first variant) for fair comparison
  const variantNameForCompare = variant ?? visibleVariants[0]?.name ?? sizeDef?.variants[0]?.name;
  const currentSizeBasePrice =
    sizeDef?.variants.find((v) => v.name === variantNameForCompare)?.price ?? currentVariantPrice;

  return (
    <div className="space-y-5">
      {/* Produkt — segmented pill toggle. Only renders when this template
          actually has both a poster + canvas variant available. */}
      {toggleEntries.length > 1 && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Produkt</Label>
          <div className="flex p-1 bg-muted rounded-full">
            {toggleEntries.map((e) => (
              <button
                key={e.kind}
                onClick={() => onProductChange(e.handle)}
                className={`flex-1 h-10 rounded-full text-sm font-medium transition ${
                  e.active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground/70 hover:text-foreground"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Storlek dropdown */}
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Storlek</Label>
        <Select value={size ?? undefined} onValueChange={setSize}>
          <SelectTrigger className="h-12 rounded-full px-5 text-base">
            <SelectValue placeholder="Välj storlek" />
          </SelectTrigger>
          <SelectContent className="rounded-2xl">
            {visibleSizes.map((s) => {
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
          {visibleVariants.map((v) => {
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

      {/* Orientering — segmented pill (hidden when only one orientation is allowed) */}
      {allowedOrientations.length > 1 && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Orientering</Label>
          <div className="flex p-1 bg-muted rounded-full">
            {([
              { id: "portrait", label: "Stående" },
              { id: "landscape", label: "Liggande" },
            ] as const)
              .filter(({ id }) => allowedOrientations.includes(id))
              .map(({ id, label }) => {
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
      )}
    </div>
  );
}
