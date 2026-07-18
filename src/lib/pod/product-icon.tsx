// A representative icon per product type, provider-agnostic.
//
// Gelato's catalog/product API exposes NO thumbnail images (verified: the
// product GET returns attributes/weight/… but no preview URL), and real product
// photos need the async mockup API (heavy, per-design — that's slice 3d). So the
// admin pickers use a lightweight category icon keyed by keyword on the product
// type id / catalog uid, which works for any POD provider's catalog. Icons are a
// stopgap — real per-product mockups replace them with the mockup work.
import {
  Baby,
  Book,
  Calendar,
  Coffee,
  FileText,
  Frame,
  GlassWater,
  HardHat,
  Image as ImageIcon,
  Layers,
  Mail,
  Notebook,
  Package,
  Palette,
  Puzzle,
  ShoppingBag,
  Smartphone,
  Sticker,
  Shirt,
  Square,
  Wallpaper,
  type LucideIcon,
} from "lucide-react";

// Ordered most-specific first — the first matching rule wins.
const RULES: { test: RegExp; icon: LucideIcon }[] = [
  { test: /mug|tumbler/, icon: Coffee },
  { test: /bottle|glass|drinkware/, icon: GlassWater },
  { test: /baby|kids/, icon: Baby },
  { test: /shirt|apparel|hoodie|sweat|polo|tank|clothing|garment|tee|tank-top/, icon: Shirt },
  { test: /hat|beanie|cap|snapback|trucker|bucket/, icon: HardHat },
  { test: /phone|case/, icon: Smartphone },
  { test: /tote|bag/, icon: ShoppingBag },
  { test: /sticker/, icon: Sticker },
  { test: /calendar/, icon: Calendar },
  { test: /notebook/, icon: Notebook },
  { test: /photobook|book/, icon: Book },
  { test: /^card|-card|folded-card|greeting/, icon: Mail },
  { test: /flyer|brochure|letterhead|folder|envelope/, icon: FileText },
  { test: /puzzle/, icon: Puzzle },
  { test: /wallpaper/, icon: Wallpaper },
  // Wall art — kept visually DISTINCT so poster/canvas/metal/acrylic don't all
  // collapse to the same rectangle. (Real mockups replace these later.)
  { test: /framed|mounted|frame|hanger|hanging/, icon: Frame },
  { test: /canvas/, icon: Palette },
  { test: /acrylic|plexiglas/, icon: Layers },
  { test: /metallic|aluminum|aluminium|metal|wood|foam/, icon: Square },
  { test: /poster|print|fine-art/, icon: ImageIcon },
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
