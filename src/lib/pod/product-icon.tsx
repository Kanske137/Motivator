// A representative icon per product type, provider-agnostic.
//
// Gelato's catalog/product API exposes NO thumbnail images (verified: the
// product GET returns attributes/weight/… but no preview URL), and real product
// photos need the async mockup API (heavy, per-design — that's slice 3d). So the
// admin pickers use a lightweight category icon keyed by keyword on the product
// type id / catalog uid, which works for any POD provider's catalog.
import {
  Book,
  Coffee,
  FileText,
  Frame,
  GlassWater,
  Image as ImageIcon,
  Package,
  ShoppingBag,
  Smartphone,
  Sticker,
  Shirt,
  type LucideIcon,
} from "lucide-react";

const RULES: { test: RegExp; icon: LucideIcon }[] = [
  { test: /mug|bottle|glass|tumbler/, icon: Coffee },
  { test: /shirt|apparel|hoodie|sweat|polo|tank|clothing|baby|kids|garment/, icon: Shirt },
  { test: /phone|case/, icon: Smartphone },
  { test: /tote|bag/, icon: ShoppingBag },
  { test: /sticker/, icon: Sticker },
  { test: /photobook|notebook|calendar|book/, icon: Book },
  { test: /card|flyer|brochure|letterhead|folder|envelope|paper/, icon: FileText },
  { test: /bottle|drinkware/, icon: GlassWater },
  { test: /poster|print|fine-art|framed|frame|hanger|hanging/, icon: Frame },
  { test: /canvas|acrylic|metallic|aluminum|aluminium|wood|foam|wallpaper/, icon: ImageIcon },
];

/** Resolve a product-type id / catalog uid to a representative icon. */
export function getProductIcon(id: string): LucideIcon {
  const key = (id || "").toLowerCase();
  for (const r of RULES) if (r.test.test(key)) return r.icon;
  return Package;
}

/** Convenience wrapper: <ProductIcon id="mugs" className="h-5 w-5" />. */
export function ProductIcon({ id, className }: { id: string; className?: string }) {
  const Icon = getProductIcon(id);
  return <Icon className={className} aria-hidden />;
}
