import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface CartLineAttribute {
  key: string;
  value: string;
}

export interface CartItem {
  lineId: string | null;
  variantId: string;
  productHandle?: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string;
  price: { amount: string; currencyCode: string };
  quantity: number;
  attributes: CartLineAttribute[];
}

interface CartStore {
  items: CartItem[];
  cartId: string | null;
  checkoutUrl: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  addItem: (item: Omit<CartItem, "lineId">) => Promise<void>;
  updateQuantity: (variantId: string, quantity: number) => Promise<void>;
  removeItem: (variantId: string) => Promise<void>;
  clearCart: () => void;
  syncCart: () => Promise<void>;
  getCheckoutUrl: () => string | null;
}

// Shared fragment: read EVERYTHING we need for the cart UI directly from
// Shopify rather than relying on locally-cached strings (which can drift if
// the user re-syncs the template, sees a different product, etc.). The
// `_preview_image` line attribute still wins for the personalised thumbnail,
// but product title / handle now come from Shopify as the source of truth.
const CART_LINE_FRAGMENT = `
  fragment CartLineFields on CartLine {
    id
    quantity
    attributes { key value }
    cost { totalAmount { amount currencyCode } amountPerQuantity { amount currencyCode } }
    merchandise {
      ... on ProductVariant {
        id
        title
        image { url }
        product { id handle title }
      }
    }
  }
`;

const CART_QUERY = `
  ${CART_LINE_FRAGMENT}
  query cart($id: ID!) {
    cart(id: $id) {
      id
      checkoutUrl
      totalQuantity
      lines(first: 100) { edges { node { ...CartLineFields } } }
    }
  }`;

const CART_CREATE_MUTATION = `
  ${CART_LINE_FRAGMENT}
  mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id checkoutUrl
        lines(first: 100) { edges { node { ...CartLineFields } } }
      }
      userErrors { field message }
    }
  }`;

const CART_LINES_ADD_MUTATION = `
  ${CART_LINE_FRAGMENT}
  mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { id lines(first: 100) { edges { node { ...CartLineFields } } } }
      userErrors { field message }
    }
  }`;

const CART_LINES_UPDATE_MUTATION = `
  mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { id } userErrors { field message } }
  }`;

const CART_LINES_REMOVE_MUTATION = `
  mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { id } userErrors { field message } }
  }`;

interface ShopifyCartLineNode {
  id: string;
  quantity: number;
  attributes: Array<{ key: string; value: string }>;
  cost?: {
    totalAmount: { amount: string; currencyCode: string };
    amountPerQuantity?: { amount: string; currencyCode: string };
  };
  merchandise: {
    id: string;
    title: string;
    image?: { url: string } | null;
    product: { id: string; handle: string; title: string };
  };
}

function formatCheckoutUrl(checkoutUrl: string): string {
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set("channel", "online_store");
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

function isCartNotFoundError(userErrors: Array<{ message: string }>): boolean {
  return userErrors.some((e) => /cart not found|does not exist/i.test(e.message));
}

/** Map a Shopify cart line into our local CartItem. The personalised preview
 *  image (uploaded to cart-previews bucket) lives in the line's `_preview_image`
 *  attribute and overrides the variant image. Same for fallbacks like price
 *  currency formatting if needed in the future. */
function mapShopifyLineToCartItem(node: ShopifyCartLineNode, fallback?: Partial<CartItem>): CartItem {
  const attrs = node.attributes ?? [];
  const previewImage = attrs.find((a) => a.key === "_preview_image")?.value;
  const perQty = node.cost?.amountPerQuantity ?? node.cost?.totalAmount;
  return {
    lineId: node.id,
    variantId: node.merchandise.id,
    productHandle: node.merchandise.product.handle,
    productTitle: node.merchandise.product.title,
    variantTitle: node.merchandise.title,
    imageUrl: previewImage || node.merchandise.image?.url || fallback?.imageUrl || "",
    price: perQty
      ? { amount: perQty.amount, currencyCode: perQty.currencyCode }
      : fallback?.price ?? { amount: "0", currencyCode: "SEK" },
    quantity: node.quantity,
    attributes: attrs,
  };
}

async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("shopify-storefront", {
    body: { query, variables },
  });
  if (error) {
    console.error("Storefront proxy error:", error);
    toast.error("Anslutning till butiken misslyckades");
    return null;
  }
  if (data?.errors) {
    throw new Error(data.errors.map((e: { message: string }) => e.message).join(", "));
  }
  return data;
}

async function createShopifyCart(item: Omit<CartItem, "lineId">) {
  const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
    input: {
      lines: [{ quantity: item.quantity, merchandiseId: item.variantId, attributes: item.attributes }],
    },
  });
  const errors = data?.data?.cartCreate?.userErrors || [];
  if (errors.length) {
    console.error("Cart creation failed:", errors);
    return null;
  }
  const cart = data?.data?.cartCreate?.cart;
  if (!cart?.checkoutUrl) return null;
  const lineNodes: ShopifyCartLineNode[] = cart.lines.edges.map((e: { node: ShopifyCartLineNode }) => e.node);
  const items = lineNodes.map((n) => mapShopifyLineToCartItem(n, item));
  return { cartId: cart.id, checkoutUrl: formatCheckoutUrl(cart.checkoutUrl), items };
}

async function addLineToShopifyCart(cartId: string, item: Omit<CartItem, "lineId">) {
  const data = await storefrontApiRequest(CART_LINES_ADD_MUTATION, {
    cartId,
    lines: [{ quantity: item.quantity, merchandiseId: item.variantId, attributes: item.attributes }],
  });
  const errors = data?.data?.cartLinesAdd?.userErrors || [];
  if (isCartNotFoundError(errors)) return { success: false, cartNotFound: true };
  if (errors.length) return { success: false };
  const lineNodes: ShopifyCartLineNode[] = (data?.data?.cartLinesAdd?.cart?.lines?.edges || [])
    .map((e: { node: ShopifyCartLineNode }) => e.node);
  return { success: true, items: lineNodes.map((n) => mapShopifyLineToCartItem(n, item)) };
}

async function updateShopifyCartLine(cartId: string, lineId: string, quantity: number) {
  const data = await storefrontApiRequest(CART_LINES_UPDATE_MUTATION, {
    cartId, lines: [{ id: lineId, quantity }],
  });
  const errors = data?.data?.cartLinesUpdate?.userErrors || [];
  if (isCartNotFoundError(errors)) return { success: false, cartNotFound: true };
  return { success: errors.length === 0 };
}

async function removeLineFromShopifyCart(cartId: string, lineId: string) {
  const data = await storefrontApiRequest(CART_LINES_REMOVE_MUTATION, { cartId, lineIds: [lineId] });
  const errors = data?.data?.cartLinesRemove?.userErrors || [];
  if (isCartNotFoundError(errors)) return { success: false, cartNotFound: true };
  return { success: errors.length === 0 };
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      cartId: null,
      checkoutUrl: null,
      isLoading: false,
      isSyncing: false,

      addItem: async (item) => {
        const { cartId, clearCart } = get();
        set({ isLoading: true });
        try {
          if (!cartId) {
            const result = await createShopifyCart(item);
            if (result) {
              set({
                cartId: result.cartId,
                checkoutUrl: result.checkoutUrl,
                items: result.items,
              });
            }
          } else {
            const result = await addLineToShopifyCart(cartId, item);
            if (result.success && result.items) {
              // Replace local items with Shopify's authoritative list — this is
              // what fixes "fel produkt visas i kundvagn" since we no longer
              // trust client-side product titles.
              set({ items: result.items });
            } else if (result.cartNotFound) {
              clearCart();
            }
          }
        } finally {
          set({ isLoading: false });
        }
      },

      updateQuantity: async (variantId, quantity) => {
        if (quantity <= 0) return get().removeItem(variantId);
        const { items, cartId, clearCart } = get();
        const item = items.find((i) => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;
        set({ isLoading: true });
        try {
          const result = await updateShopifyCartLine(cartId, item.lineId, quantity);
          if (result.success) {
            set({ items: get().items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)) });
          } else if (result.cartNotFound) {
            clearCart();
          }
        } finally {
          set({ isLoading: false });
        }
      },

      removeItem: async (variantId) => {
        const { items, cartId, clearCart } = get();
        const item = items.find((i) => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;
        set({ isLoading: true });
        try {
          const result = await removeLineFromShopifyCart(cartId, item.lineId);
          if (result.success) {
            const next = get().items.filter((i) => i.variantId !== variantId);
            next.length === 0 ? clearCart() : set({ items: next });
          } else if (result.cartNotFound) {
            clearCart();
          }
        } finally {
          set({ isLoading: false });
        }
      },

      clearCart: () => set({ items: [], cartId: null, checkoutUrl: null }),
      getCheckoutUrl: () => get().checkoutUrl,

      syncCart: async () => {
        const { cartId, isSyncing, clearCart } = get();
        if (!cartId || isSyncing) return;
        set({ isSyncing: true });
        try {
          const data = await storefrontApiRequest(CART_QUERY, { id: cartId });
          if (!data) return;
          const cart = data?.data?.cart;
          if (!cart || cart.totalQuantity === 0) {
            clearCart();
            return;
          }
          // Rebuild items from Shopify so we always show real product titles
          // / images (esp. important after a template re-sync).
          const lineNodes: ShopifyCartLineNode[] = cart.lines.edges.map(
            (e: { node: ShopifyCartLineNode }) => e.node,
          );
          set({
            items: lineNodes.map((n) => mapShopifyLineToCartItem(n)),
            checkoutUrl: cart.checkoutUrl ? formatCheckoutUrl(cart.checkoutUrl) : get().checkoutUrl,
          });
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: "shopify-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items, cartId: state.cartId, checkoutUrl: state.checkoutUrl }),
    },
  ),
);
