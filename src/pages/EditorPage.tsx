import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editorStore";
import { loadAllConfigs, type ProductConfig } from "@/lib/product-config";
import { MapPreview } from "@/components/editor/MapPreview";
import { ControlPanel } from "@/components/editor/ControlPanel";
import { MockupGallery } from "@/components/editor/MockupGallery";
import { useCartStore } from "@/stores/cartStore";
import { CartDrawer } from "@/components/CartDrawer";
import { toast } from "sonner";

const FRAME_BORDER_CSS: Record<string, string> = {
  Ingen: "0",
  Vit: "16px solid hsl(0 0% 98%)",
  Svart: "16px solid hsl(0 0% 8%)",
  Ek: "16px solid hsl(30 35% 55%)",
  Valnöt: "16px solid hsl(20 25% 25%)",
};

export default function EditorPage() {
  const [params, setParams] = useSearchParams();
  const handle = params.get("handle") ?? "personlig-karta-poster";
  const [configs, setConfigs] = useState<ProductConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const { config, setConfig, currentPrice, mapStyleId, mapCenter, mapZoom, text, orientation, size, variant } =
    useEditorStore();
  const addItem = useCartStore((s) => s.addItem);
  const isAdding = useCartStore((s) => s.isLoading);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await loadAllConfigs();
      setConfigs(all);
      const active = all.find((c) => c.shopify_handle === handle) ?? all[0];
      if (active) setConfig(active);
      setLoading(false);
    })();
  }, [handle, setConfig]);

  const onProductChange = (newHandle: string) => {
    const next = configs.find((c) => c.shopify_handle === newHandle);
    if (!next) return;
    setParams({ handle: newHandle }, { replace: true });
    setConfig(next);
  };

  const borderCss = config?.product_type === "posters" ? FRAME_BORDER_CSS[variant ?? "Ingen"] : undefined;

  const orientationLabel = orientation === "portrait" ? "Stående" : "Liggande";
  const variantLabel = config?.product_type === "canvas" ? `${variant ?? ""} djup` : `${variant ?? ""} ram`;
  const summary = [size ? `${size} cm` : null, variantLabel.trim() ? variantLabel : null, orientationLabel]
    .filter(Boolean)
    .join(" · ");

  const handleAddToCart = async () => {
    if (!config || !size || !variant) return;
    const inIframe = window.self !== window.top;
    const properties = {
      Orientation: orientation === "portrait" ? "Stående" : "Liggande",
      Text: text,
      _map_style: mapStyleId,
      _map_center: `${mapCenter[1].toFixed(6)},${mapCenter[0].toFixed(6)}`,
      _map_zoom: mapZoom.toFixed(2),
      _size: size,
      _variant: variant,
    };

    if (inIframe) {
      window.parent.postMessage(
        {
          type: "ADD_TO_CART",
          handle: config.shopify_handle,
          size,
          variant,
          quantity: 1,
          properties,
        },
        "*"
      );
      toast.success("Lagt till i varukorgen");
      return;
    }

    // Standalone preview: simulate cart add (real Shopify variantId not resolved here)
    await addItem({
      variantId: `gid://shopify/ProductVariant/preview-${size}-${variant}`,
      productTitle: config.title,
      variantTitle: `${size} · ${variant}`,
      imageUrl: "",
      price: { amount: String(currentPrice()), currencyCode: "SEK" },
      quantity: 1,
      attributes: Object.entries(properties).map(([key, value]) => ({ key, value: String(value) })),
    });
  };

  if (loading || !config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar (only outside iframe) */}
      {window.self === window.top && (
        <header className="border-b bg-background sticky top-0 z-30">
          <div className="px-4 py-3 flex items-center justify-between">
            <h1 className="font-serif-display text-xl md:text-2xl font-semibold">{config.title}</h1>
            <CartDrawer />
          </div>
        </header>
      )}

      {/* Main: split on desktop, stacked on mobile */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Preview */}
        <div className="flex-1 paper-grain flex items-center justify-center min-h-[65vh] md:min-h-[70vh]">
          <MapPreview borderCss={borderCss} />
        </div>

        {/* Control panel */}
        <aside className="w-full md:w-[380px] lg:w-[420px] border-l bg-background overflow-y-auto pb-24 md:pb-6">
          <div className="p-4 md:p-5">
            <ControlPanel
              configs={configs}
              activeHandle={config.shopify_handle}
              onProductChange={onProductChange}
            />
          </div>

          {/* Desktop: format summary + buy inside panel */}
          <div className="hidden md:block sticky bottom-0 border-t bg-background p-4 space-y-3">
            <div className="text-xs text-muted-foreground truncate">
              {summary}
            </div>
            <Button
              onClick={handleAddToCart}
              disabled={isAdding}
              className="w-full h-14 rounded-full text-base font-semibold"
            >
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex items-center justify-between w-full">
                  <span className="flex items-center">
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    Lägg i varukorg
                  </span>
                  <span className="text-base">{currentPrice()} kr</span>
                </span>
              )}
            </Button>
          </div>
        </aside>
      </div>

      {/* Mockup gallery */}
      <MockupGallery />

      {/* Mobile sticky bottom bar */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-background p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ditt val</div>
          <div className="text-xs font-medium leading-tight truncate">{summary}</div>
        </div>
        <Button
          onClick={handleAddToCart}
          disabled={isAdding}
          className="flex-1 h-12 rounded-full font-semibold"
        >
          {isAdding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className="flex items-center justify-between w-full">
              <span>Lägg i varukorg</span>
              <span>{currentPrice()} kr</span>
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
