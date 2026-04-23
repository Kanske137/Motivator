// Shared Shopify Admin auth + GraphQL helper for edge functions.
//
// Token resolution order (deterministic, with logging of source name only,
// never the value):
//   1. SHOPIFY_ONLINE_ACCESS_TOKEN:user:<uid>  (Lovable Shopify integration)
//   2. SHOPIFY_ADMIN_ACCESS_TOKEN              (manually-provisioned admin token)
//   3. SHOPIFY_ACCESS_TOKEN                    (legacy fallback)
//
// On the first call per cold start, we run a tiny `{ shop { name } }` query to
// verify auth. The result is cached in-memory so subsequent calls are cheap.

export const SHOPIFY_API_VERSION = "2025-07";

export interface ShopifyAuthError extends Error {
  code: "no_token" | "invalid_token" | "missing_scope" | "network" | "unknown";
  source?: string;
  domain?: string;
  status?: number;
  body?: unknown;
}

function makeAuthError(
  code: ShopifyAuthError["code"],
  message: string,
  extra: Partial<ShopifyAuthError> = {},
): ShopifyAuthError {
  const e = new Error(message) as ShopifyAuthError;
  e.code = code;
  Object.assign(e, extra);
  return e;
}

export function getShopifyDomain(): string {
  const domain = Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")
    ?? Deno.env.get("SHOPIFY_STORE_DOMAIN")
    ?? "canvas-poster-creator-2wh5d.myshopify.com";
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

interface TokenPick {
  token: string;
  source: string;
}

export function pickShopifyToken(): TokenPick {
  // 1. Online token from the Lovable Shopify integration.
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (k.startsWith("SHOPIFY_ONLINE_ACCESS_TOKEN") && v) {
      return { token: v, source: k };
    }
  }
  // 2. Manually-provisioned admin token.
  const admin = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN");
  if (admin) return { token: admin, source: "SHOPIFY_ADMIN_ACCESS_TOKEN" };
  // 3. Legacy fallback.
  const legacy = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (legacy) return { token: legacy, source: "SHOPIFY_ACCESS_TOKEN" };

  throw makeAuthError(
    "no_token",
    "Ingen Shopify Admin-token hittades i backend-secrets. " +
      "Återanslut Shopify-integrationen eller lägg till SHOPIFY_ADMIN_ACCESS_TOKEN.",
  );
}

let preflightOk: { source: string; domain: string } | null = null;

export async function ensureShopifyAuth(): Promise<{ source: string; domain: string }> {
  if (preflightOk) return preflightOk;
  const { token, source } = pickShopifyToken();
  const domain = getShopifyDomain();
  console.log(`[shopify-auth] preflight using source=${source} domain=${domain}`);

  const r = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: "{ shop { name myshopifyDomain } }" }),
    },
  ).catch((err) => {
    throw makeAuthError("network", `Network error mot Shopify: ${err.message}`, {
      source,
      domain,
    });
  });

  const raw = await r.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }

  if (r.status === 401 || r.status === 403) {
    throw makeAuthError(
      "invalid_token",
      `Backend Shopify Admin-token är ogiltig (${r.status}). ` +
        `Källa: ${source}. Återanslut Shopify i Lovable så installeras en ny token.`,
      { source, domain, status: r.status, body: json ?? raw },
    );
  }
  if (!r.ok || json?.errors) {
    // Could be missing access scope — Shopify returns 200 with errors for that.
    const msg = JSON.stringify(json?.errors ?? json ?? raw).slice(0, 400);
    if (/access scope|not approved|ACCESS_DENIED/i.test(msg)) {
      throw makeAuthError(
        "missing_scope",
        `Shopify-token saknar nödvändiga scopes (write_products m.fl.). Detalj: ${msg}`,
        { source, domain, status: r.status, body: json ?? raw },
      );
    }
    throw makeAuthError(
      "unknown",
      `Shopify preflight misslyckades (${r.status}): ${msg}`,
      { source, domain, status: r.status, body: json ?? raw },
    );
  }

  preflightOk = { source, domain };
  console.log(`[shopify-auth] preflight ok shop=${json?.data?.shop?.name}`);
  return preflightOk;
}

export async function shopifyAdmin<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const { domain } = await ensureShopifyAuth();
  const { token } = pickShopifyToken();

  const r = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  const raw = await r.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }

  if (r.status === 401 || r.status === 403) {
    // Token rotated mid-flight — invalidate cache so next call re-preflights.
    preflightOk = null;
    throw makeAuthError(
      "invalid_token",
      `Shopify Admin-token avvisades (${r.status}). Återanslut Shopify i Lovable.`,
      { status: r.status, body: json ?? raw },
    );
  }
  if (!r.ok || json?.errors) {
    const detail = json?.errors ?? json ?? raw;
    throw new Error(`Shopify API ${r.status}: ${JSON.stringify(detail).slice(0, 500)}`);
  }
  return json.data as T;
}
