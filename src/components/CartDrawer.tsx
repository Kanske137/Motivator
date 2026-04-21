import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ShoppingCart, Minus, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";

export function CartDrawer() {
  const [open, setOpen] = useState(false);
  const { items, isLoading, isSyncing, updateQuantity, removeItem, getCheckoutUrl, syncCart } = useCartStore();
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = items.reduce((s, i) => s + parseFloat(i.price.amount) * i.quantity, 0);

  useEffect(() => { if (open) syncCart(); }, [open, syncCart]);

  const checkout = () => {
    const url = getCheckoutUrl();
    if (url) {
      window.open(url, "_blank");
      setOpen(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <ShoppingCart className="size-5" />
          {totalItems > 0 && (
            <Badge className="absolute -top-2 -right-2 size-5 rounded-full p-0 flex items-center justify-center text-xs">
              {totalItems}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle>Varukorg ({totalItems})</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <ShoppingCart className="size-10 mx-auto mb-3 opacity-50" />
              <p>Varukorgen är tom</p>
            </div>
          ) : (
            items.map((item) => {
              const previewAttr = item.attributes.find((a) => a.key === "_preview_image")?.value;
              const thumb = previewAttr || item.imageUrl;
              return (
              <div key={item.variantId} className="flex gap-3 p-2 border rounded-md">
                <img src={thumb} alt={item.productTitle} className="size-16 rounded object-cover bg-muted" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.productTitle}</p>
                  <p className="text-xs text-muted-foreground">{item.variantTitle}</p>
                  {item.attributes.filter(a => !a.key.startsWith("_")).map((a) => (
                    <p key={a.key} className="text-xs text-muted-foreground truncate">
                      {a.key}: {a.value}
                    </p>
                  ))}
                  <p className="text-sm font-semibold mt-1">{item.price.amount} {item.price.currencyCode}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => removeItem(item.variantId)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="size-6" onClick={() => updateQuantity(item.variantId, item.quantity - 1)}>
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-6 text-center text-sm">{item.quantity}</span>
                    <Button variant="outline" size="icon" className="size-6" onClick={() => updateQuantity(item.variantId, item.quantity + 1)}>
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>
        {items.length > 0 && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex justify-between font-semibold">
              <span>Totalt</span>
              <span>{totalPrice.toFixed(0)} SEK</span>
            </div>
            <Button className="w-full" size="lg" onClick={checkout} disabled={isLoading || isSyncing}>
              {isLoading || isSyncing ? <Loader2 className="size-4 animate-spin" /> : <><ExternalLink className="size-4 mr-2" />Till kassan</>}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
