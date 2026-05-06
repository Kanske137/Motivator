import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShopContextStore } from "@/stores/shopContextStore";
import { formatPrice, formatMoney } from "@/lib/format-price";
import { useShopifyPriceMap, priceFromMap } from "@/hooks/useShopifyPriceMap";
import { translateVariantName } from "@/lib/variant-labels";
import { useEditorStore } from "@/stores/editorStore";
import {
  loadAllConfigs,
  resolveConfigForHandle,
  deriveTemplateSlug,
  type ProductConfig,
  type ProductType,
} from "@/lib/product-config";
import { MapPreview } from "@/components/editor/MapPreview";
import { ControlPanel } from "@/components/editor/ControlPanel";
import { MockupGallery } from "@/components/editor/MockupGallery";
import { useCartStore } from "@/stores/cartStore";
import { CartDrawer } from "@/components/CartDrawer";
import { renderTemplateSnapshot } from "@/lib/template-snapshot";
import { uploadCartPreview } from "@/lib/upload-preview";
import { getPrintFileUrl } from "@/lib/print-pipeline";
import { resolveShopifyVariantId } from "@/lib/shopify-variant-resolver";
import { hangerColorFromVariant } from "@/lib/mockup-scenes";
import { toast } from "sonner";

const FRAME_COLORS: Record<string, string> = {
  Ingen: "",
  Vit: "hsl(0 0% 98%)",
  Svart: "hsl(0 0% 8%)",
  Ek: "hsl(30 35% 55%)",
  Valnöt: "hsl(20 25% 25%)",
};
const FRAME_WIDTH_CM = 1.2; // matchar Gelato frp_w12xt22-mm (12mm front)

function normalizeType(raw: string | null): ProductType | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === "poster" || v === "posters") return "posters";
  if (v === "canvas") return "canvas";
  return undefined;
}

export default function EditorPage() {
  const [params, setParams] = useSearchParams();
  const handleParam = params.get("handle") ?? "personlig-karta-poster";
  const typeParam = normalizeType(params.get("type"));
  const [configs, setConfigs] = useState<ProductConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const { config, template, layerValues, layerTransforms, whiteMarginEnabled, setConfig, currentPrice, currentLayout, mapStyleId, mapCenter, mapZoom, text, textFont, textVisible, showLabels, mapShape, orientation, size, variant, posterBgColor, designSource, aiPrintFileUrl, aiPhotoResults, shopifyVariantId, shopifyVariantResolving, setShopifyVariantId, setShopifyVariantResolving } =
    useEditorStore();
  const { t } = useTranslation();
  const shopCtx = useShopContextStore();
  const addItem = useCartStore((s) => s.addItem);
  const isAdding = useCartStore((s) => s.isLoading);
  const [isPreparing, setIsPreparing] = useState(false);
  const shopifyPriceMap = useShopifyPriceMap();
  const livePrice = priceFromMap(shopifyPriceMap, size, variant);
  const displayPrice = livePrice
    ? formatMoney(livePrice.amount, livePrice.currencyCode, shopCtx.locale)
    : formatPrice(currentPrice(), shopCtx);

  // All configs that belong to the same template (same template_slug). Passed
  // down so FormatSection can render its poster/canvas toggle without having
  // to re-derive the relationship.
  const sameTemplateConfigs = useMemo(() => {
    if (!config) return [] as ProductConfig[];
    const slug = config.template_slug ?? deriveTemplateSlug(config.shopify_handle);
    return configs.filter(
      (c) => (c.template_slug ?? deriveTemplateSlug(c.shopify_handle)) === slug,
    );
  }, [configs, config]);

  // Resolve real Shopify variant ID whenever handle/size/variant changes.
  useEffect(() => {
    if (!config || !size || !variant) {
      setShopifyVariantId(null);
      return;
    }
    let cancelled = false;
    setShopifyVariantResolving(true);
    resolveShopifyVariantId(config.shopify_handle, size, variant)
      .then((id) => {
        if (cancelled) return;
        setShopifyVariantId(id);
      })
      .finally(() => {
        if (!cancelled) setShopifyVariantResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, size, variant, setShopifyVariantId, setShopifyVariantResolving]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await loadAllConfigs();
      setConfigs(all);
      // Resolve via handle OR template_slug, with optional ?type= preference.
      // This makes both legacy direct-handle links AND new "open template"
      // links work, including links from Shopify product pages where the
      // handle has a -poster/-canvas suffix.
      const active = resolveConfigForHandle(all, handleParam, typeParam) ?? all[0];
      if (active) setConfig(active);
      setLoading(false);
    })();
  }, [handleParam, typeParam, setConfig]);

  const onProductChange = (newHandle: string) => {
    const next = configs.find((c) => c.shopify_handle === newHandle);
    if (!next) return;
    const nextType: "poster" | "canvas" = next.product_type === "canvas" ? "canvas" : "poster";
    // Clear the resolved variant immediately — prevents an in-flight resolve
    // from a previous handle being used in add-to-cart while we switch.
    setShopifyVariantId(null);
    setParams({ handle: newHandle, type: nextType }, { replace: true });
    setConfig(next);
  };

  const frameColor = config?.product_type === "posters" ? FRAME_COLORS[variant ?? "Ingen"] : "";
  const hangerColor = config?.product_type === "posters" ? hangerColorFromVariant(variant) : null;
  const isCanvas = config?.product_type === "canvas";
  const canvasDepthCm = isCanvas
    ? (variant?.match(/(\d+)/)?.[1] ? parseInt(variant!.match(/(\d+)/)![1], 10) : 2)
    : 0;

  const orientationLabel = orientation === "portrait" ? t("orientation.portrait") : t("orientation.landscape");
  const translatedVariant = translateVariantName(variant, t);
  const variantLabel = config?.product_type === "canvas"
    ? `${translatedVariant} ${t("format.depth").toLowerCase()}`
    : translatedVariant;
  const summary = [size ? `${size} cm` : null, variantLabel.trim() ? variantLabel : null, orientationLabel]
    .filter(Boolean)
    .join(" · ");

  const handleAddToCart = async () => {
    if (!config || !size || !variant) return;
    const inIframe = window.self !== window.top;
    const designId = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    if (!template) return;
    const baseTemplateInput = {
      template,
      orientation,
      productType: config?.product_type,
      size,
      layerValues,
      layerTransforms,
      whiteMarginEnabled,
      livePosterBgColor: posterBgColor,
      liveMapCenter: mapCenter,
      liveMapZoom: mapZoom,
      liveMapStyleId: mapStyleId,
      liveMapShape: mapShape,
      liveShowLabels: showLabels,
      liveText: text,
      liveTextFont: textFont,
      liveTextVisible: textVisible,
      wrapCm: isCanvas
        ? (variant?.match(/(\d+)/)?.[1] ? parseInt(variant.match(/(\d+)/)![1], 10) : 2)
        : 0,
      bleedCm: isCanvas ? 0.3 : 0,
      photoOverlayUrl:
        designSource === "ai"
          ? aiPrintFileUrl ?? undefined
          : designSource === "photo"
          ? useEditorStore.getState().photoPreviewUrl ?? undefined
          : undefined,
      aiPhotoResults,
    };

    setIsPreparing(true);
    let previewUrl = "";
    let printFileUrl = "";
    try {
      // 1) Print file via dispatcher (always full multi-layer composite).
      printFileUrl = await getPrintFileUrl({
        source: designSource,
        designId,
        templateInput: baseTemplateInput,
      });

      // 2) Thumbnail for cart display — multi-layer snapshot WITH frame/wrap
      //    overlay so the cart preview matches the editor exactly.
      const thumbDataUrl = await renderTemplateSnapshot({
        ...baseTemplateInput,
        frameColor: !isCanvas ? frameColor : undefined,
        frameWidthCm: !isCanvas ? FRAME_WIDTH_CM : undefined,
        hangerColor: hangerColor ?? undefined,
        canvasWrap: isCanvas,
        acrylicCorners: config?.product_type === "acrylic",
      });
      previewUrl = await uploadCartPreview(thumbDataUrl, designId);
    } catch (err) {
      console.error("[print-pipeline] failed", err);
      const msg = err instanceof Error ? err.message : t("common.unknownError");
      toast.error(t("cartAdd.prepareFailed"), { description: msg });
      setIsPreparing(false);
      return; // ABORT — do NOT add a broken item to the cart.
    } finally {
      setIsPreparing(false);
    }

    const properties: Record<string, string> = {
      Orientering: orientation === "portrait" ? "Stående" : "Liggande",
      _map_style: mapStyleId,
      _map_center: `${mapCenter[1].toFixed(6)},${mapCenter[0].toFixed(6)}`,
      _map_zoom: mapZoom.toFixed(2),
      _size: size,
      _variant: variant,
      _bg_color: posterBgColor,
      _orientation: orientation,
      _product_handle: config.shopify_handle,
      _design_id: designId,
      _map_shape: mapShape,
      _show_labels: showLabels ? "true" : "false",
      _text_visible: textVisible ? "true" : "false",
      _text_font: textFont,
      _text: text,
      _design_source: designSource,
      _preview_image: previewUrl,
      _print_file_url: printFileUrl,
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
      toast.success(t("cartAdd.added"));
      return;
    }

    // Resolve real variant ID. Fall back to a fresh lookup if not yet cached
    // (race when user clicks before the effect resolves).
    let variantGid = shopifyVariantId;
    if (!variantGid) {
      variantGid = await resolveShopifyVariantId(config.shopify_handle, size, variant);
      if (variantGid) setShopifyVariantId(variantGid);
    }
    if (!variantGid) {
      toast.error(t("cartAdd.variantUnavailable"), {
        description: t("cartAdd.variantUnavailableHint", { size, variant, handle: config.shopify_handle }),
      });
      return;
    }

    await addItem({
      variantId: variantGid,
      productTitle: config.title,
      variantTitle: `${size} · ${variant}`,
      imageUrl: previewUrl,
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
        <div className="paper-grain flex items-center justify-center h-[60vh] md:h-auto md:flex-1 md:min-h-[70vh]">
          <MapPreview
            frameColor={frameColor}
            frameWidthCm={FRAME_WIDTH_CM}
            hangerColor={hangerColor ?? undefined}
            wrapCm={canvasDepthCm}
            layersIncludeWrap={isCanvas && !!template?.canvasLayout}
          />
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
              disabled={isAdding || isPreparing}
              className="w-full h-14 rounded-full text-base font-semibold"
            >
              {(isAdding || isPreparing) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex items-center justify-between w-full">
                  <span className="flex items-center">
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    {t("common.addToCart")}
                  </span>
                  <span className="text-base">{formatPrice(currentPrice(), shopCtx)}</span>
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
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("header.yourChoice")}</div>
          <div className="text-xs font-medium leading-tight truncate">{summary}</div>
        </div>
        <Button
          onClick={handleAddToCart}
          disabled={isAdding || isPreparing}
          className="flex-1 h-12 rounded-full font-semibold"
        >
          {(isAdding || isPreparing) ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className="flex items-center justify-between w-full">
              <span>{t("common.addToCart")}</span>
              <span>{formatPrice(currentPrice(), shopCtx)}</span>
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
