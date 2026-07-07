// Shopify App Bridge session-token helper — ADMIN ONLY.
//
// When the admin runs embedded inside Shopify admin, App Bridge mints a
// short-lived session token (JWT signed with the app secret). We send that to
// the tenant-scoped edge functions (`admin-templates`), which verify it and
// derive the merchant's `installation_id`.
//
// App Bridge's CDN build exposes `window.shopify`. We inject it LAZILY (only
// when an admin action needs a token) so the customer storefront editor — a
// different iframe inside the merchant's theme — never loads it.
//
// Requires `VITE_SHOPIFY_API_KEY` (= the app's client id / API key; public,
// not a secret) to be set at build time.

const APP_BRIDGE_SRC = "https://cdn.shopify.com/shopifycloud/app-bridge.js";
const READY_TIMEOUT_MS = 5000;

interface ShopifyGlobal {
  idToken?: () => Promise<string>;
}
declare global {
  interface Window {
    shopify?: ShopifyGlobal;
  }
}

let injecting: Promise<void> | null = null;

/** True when we're loaded inside Shopify admin (iframe + `host` query param). */
export function isEmbedded(): boolean {
  try {
    const hasHost = new URLSearchParams(window.location.search).has("host");
    return window.top !== window.self && hasHost;
  } catch {
    // Cross-origin access to window.top throws → we're framed by someone else.
    return new URLSearchParams(window.location.search).has("host");
  }
}

function waitForShopify(resolve: () => void, reject: (e: Error) => void) {
  const started = Date.now();
  const poll = () => {
    if (window.shopify?.idToken) return resolve();
    if (Date.now() - started > READY_TIMEOUT_MS) {
      return reject(
        new Error("App Bridge initierades inte — öppna appen inifrån Shopify admin."),
      );
    }
    setTimeout(poll, 50);
  };
  poll();
}

function injectAppBridge(): Promise<void> {
  if (injecting) return injecting;
  injecting = new Promise<void>((resolve, reject) => {
    if (window.shopify?.idToken) return resolve();

    const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY as string | undefined;
    if (!apiKey) {
      return reject(new Error("VITE_SHOPIFY_API_KEY saknas — kan inte initiera App Bridge."));
    }

    const existing = document.querySelector(`script[src="${APP_BRIDGE_SRC}"]`);
    if (existing) return waitForShopify(resolve, reject);

    const s = document.createElement("script");
    s.src = APP_BRIDGE_SRC;
    s.setAttribute("data-api-key", apiKey);
    s.onload = () => waitForShopify(resolve, reject);
    s.onerror = () => reject(new Error("Kunde inte ladda App Bridge-skriptet."));
    document.head.appendChild(s);
  });
  // Let a failed attempt be retried on the next call.
  injecting.catch(() => {
    injecting = null;
  });
  return injecting;
}

/** Fetch a fresh Shopify session token for an admin request. Throws with a
 *  human-readable message if the app isn't embedded / App Bridge is unavailable. */
export async function getAdminSessionToken(): Promise<string> {
  await injectAppBridge();
  const token = await window.shopify?.idToken?.();
  if (!token) throw new Error("Ingen Shopify session-token tillgänglig.");
  return token;
}
