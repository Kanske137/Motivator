import { useEffect, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useCartStore } from "@/stores/cartStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ShoppingCart, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  POSTER_PRICES, CANVAS_PRICES,
} from "@/lib/pricing";

const PRODUCT_HANDLES = {
  posters: "personlig-karta-poster",
  canvas: "personlig-karta-canvas",
} as const;

const PRODUCT_BY_HANDLE_QUERY = `
  query Product($handle: String!) {
    product(handle: $handle) {
      id
      title
      images(first: 1) { edges { node { url } } }
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

export function StepMockup() {
  const editor = useEditorStore();
  const { addItem, isLoading } = useCartStore();
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);

  const finalImage = editor.finalImageUrl();
  const uid = editor.getGelatoUid();
  const prices = editor.productType === "posters" ? POSTER_PRICES : CANVAS_PRICES;
  const price = editor.size && editor.variant ? prices[editor.size]?.[editor.variant] : null;

  const generate = async () => {
    if (!finalImage || !uid) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("gelato-mockup", {
        body: { productUid: uid, imageUrl: finalImage },
      });
      if (error) throw error;
      if (data?.mockupUrl) {
        editor.setMockupUrl(data.mockupUrl);
      } else {
        // Fallback: visa bild i CSS-mockup
        editor.setMockupUrl(finalImage);
        toast.message("Mockup ej tillgänglig — visar tryckfilen");
      }
    } catch (e) {
      console.error(e);
      editor.setMockupUrl(finalImage);
      toast.message("Mockup ej tillgänglig — visar tryckfilen");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (finalImage && uid && !editor.mockupUrl) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalImage, uid]);

  const addToCart = async () => {
    if (!editor.productType || !editor.size || !editor.variant || !finalImage || !uid || !price) {
      toast.error("Ofullständig design");
      return;
    }
    setAdding(true);
    try {
      const handle = PRODUCT_HANDLES[editor.productType];
      const { data, error } = await supabase.functions.invoke("shopify-storefront", {
        body: { query: PRODUCT_BY_HANDLE_QUERY, variables: { handle } },
      });
      if (error) throw error;
      const product = data?.data?.product;
      if (!product) throw new Error("Produkt saknas i Shopify");

      // Hitta variant: matcha på Storlek + Ram/Djup
      const variantOptionLabel = editor.productType === "posters" ? "Ram" : "Djup";
      const variantEdge = product.variants.edges.find(
        (e: { node: { selectedOptions: Array<{ name: string; value: string }> } }) => {
          const opts = e.node.selectedOptions;
          return (
            opts.find((o) => o.name.toLowerCase() === "storlek")?.value === editor.size &&
            opts.find((o) => o.name.toLowerCase() === variantOptionLabel.toLowerCase())?.value === editor.variant
          );
        },
      );
      if (!variantEdge) throw new Error("Hittade ingen matchande Shopify-variant");

      await addItem({
        variantId: variantEdge.node.id,
        productTitle: product.title,
        variantTitle: `${editor.size} · ${editor.variant}`,
        imageUrl: editor.mockupUrl || finalImage,
        price: { amount: String(price), currencyCode: "SEK" },
        quantity: 1,
        attributes: [
          { key: "Orientation", value: editor.orientation === "portrait" ? "Stående" : "Liggande" },
          { key: "_gelato_uid", value: uid },
          { key: "_print_file_url", value: finalImage },
          ...(editor.text ? [{ key: "Text", value: editor.text }] : []),
          ...(editor.mapAddress ? [{ key: "Plats", value: editor.mapAddress }] : []),
          ...(editor.stylePreset && editor.stylePreset !== "none"
            ? [{ key: "AI-stil", value: editor.stylePreset }]
            : []),
        ],
      });

      toast.success("Lagt i varukorg!");
      editor.reset();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Kunde inte lägga i varukorg");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-32">
      <p className="text-sm text-muted-foreground">Så här kommer ditt tryck att se ut.</p>

      <Card className="overflow-hidden bg-muted">
        {generating ? (
          <div className="aspect-square flex items-center justify-center">
            <div className="text-center space-y-2">
              <Loader2 className="size-10 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">Genererar förhandsvisning…</p>
            </div>
          </div>
        ) : editor.mockupUrl ? (
          <img src={editor.mockupUrl} alt="Mockup" className="w-full h-auto" />
        ) : (
          <div className="aspect-square flex items-center justify-center text-muted-foreground text-sm">
            Ingen förhandsvisning
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-muted/50 rounded-md p-3">
          <p className="text-xs text-muted-foreground">Produkt</p>
          <p className="font-medium">{editor.productType === "posters" ? "Poster" : "Canvas"}</p>
        </div>
        <div className="bg-muted/50 rounded-md p-3">
          <p className="text-xs text-muted-foreground">Storlek</p>
          <p className="font-medium">{editor.size} cm · {editor.variant}</p>
        </div>
        <div className="bg-muted/50 rounded-md p-3">
          <p className="text-xs text-muted-foreground">Orientering</p>
          <p className="font-medium">{editor.orientation === "portrait" ? "Stående" : "Liggande"}</p>
        </div>
        <div className="bg-muted/50 rounded-md p-3">
          <p className="text-xs text-muted-foreground">Pris</p>
          <p className="font-medium">{price} kr</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={generate} disabled={generating}>
          <RefreshCw className={`size-4 ${generating ? "animate-spin" : ""}`} />
        </Button>
        <Button variant="outline" className="flex-1" onClick={editor.back}>Tillbaka</Button>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 z-40">
        <Button
          className="w-full h-14 text-base bg-emerald-600 hover:bg-emerald-700 text-white"
          size="lg"
          disabled={adding || isLoading || !finalImage || !uid}
          onClick={addToCart}
        >
          {adding || isLoading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <>
              <ShoppingCart className="size-5 mr-2" />
              Lägg i varukorg · {price} kr
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
