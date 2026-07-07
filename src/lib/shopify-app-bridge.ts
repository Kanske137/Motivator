// Shopify App Bridge session-token helper — ADMIN ONLY.
//
// App Bridge itself is loaded by the CDN <script> in index.html (it MUST be the
// first script in <head> to initialize). Here we just read a short-lived
// session token from `window.shopify` and hand it to the tenant-scoped edge
// functions, which verify it and derive the merchant's installation_id.

interface ShopifyGlobal {
  idToken?: () => Promise<string>;
}
declare global {
  interface Window {
    shopify?: ShopifyGlobal;
  }
}

const READY_TIMEOUT_MS = 5000;

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

/** Wait until App Bridge (window.shopify.idToken) is ready. */
async function waitForAppBridge(): Promise<void> {
  const started = Date.now();
  while (!window.shopify?.idToken) {
    if (Date.now() - started > READY_TIMEOUT_MS) {
      throw new Error("App Bridge är inte tillgängligt — öppna appen inifrån Shopify admin.");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Fetch a fresh Shopify session token for an admin request. */
export async function getAdminSessionToken(): Promise<string> {
  await waitForAppBridge();
  const token = await window.shopify?.idToken?.();
  if (!token) throw new Error("Ingen Shopify session-token tillgänglig.");
  return token;
}
