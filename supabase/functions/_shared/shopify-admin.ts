// Shared Shopify Admin auth + GraphQL helper for edge functions.
//
// Token resolution order (deterministic, with logging of source name only,
// never the value):
//   1. shopify_app_installations DB row for the active shop  (Dev Dashboard OAuth install)
//   2. SHOPIFY_ONLINE_ACCESS_TOKEN:user:<uid>                (Lovable Shopify integration)
//   3. SHOPIFY_ADMIN_ACCESS_TOKEN                            (manually-provisioned admin token)
//   4. SHOPIFY_ACCESS_TOKEN                                  (legacy fallback)
//
// On the first call per cold start, we run a tiny `{ shop { name } }` query to
// verify auth. The result is cached in-memory so subsequent calls are cheap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

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
    ?? "wdxugd-yq.myshopify.com";
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

interface TokenPick {
  token: string;
  source: string;
}

let dbTokenCache: { token: string; source: string; ts: number } | null = null;
const DB_TOKEN_TTL_MS = 5 * 60 * 1000;

async function tryDbToken(domain: string): Promise<TokenPick | null> {
  if (dbTokenCache && Date.now() - dbTokenCache.ts < DB_TOKEN_TTL_MS) {
    return { token: dbTokenCache.token, source: dbTokenCache.source };
  }
  const url = Deno.env.get("SUPABASE_URL");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !srk) return null;

  try {
    const supabase = createClient(url, srk);
    const { data, error } = await supabase
      .from("shopify_app_installations")
      .select("access_token")
      .eq("shop_domain", domain)
      .maybeSingle();
    if (error || !data?.access_token) return null;
    const source = `shopify_app_installations:${domain}`;
    dbTokenCache = { token: data.access_token, source, ts: Date.now() };
    return { token: data.access_token, source };
  } catch (e) {
    console.warn("[shopify-auth] db token lookup failed", e);
    return null;
  }
}

function pickEnvToken(): TokenPick | null {
  // 2. Online token from the Lovable Shopify integration.
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (k.startsWith("SHOPIFY_ONLINE_ACCESS_TOKEN") && v) {
      return { token: v, source: k };
    }
  }
  // 3. Manually-provisioned admin token.
  const admin = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN");
  if (admin) return { token: admin, source: "SHOPIFY_ADMIN_ACCESS_TOKEN" };
  // 4. Legacy fallback.
  const legacy = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (legacy) return { token: legacy, source: "SHOPIFY_ACCESS_TOKEN" };
  return null;
}

export async function pickShopifyToken(): Promise<TokenPick> {
  const domain = getShopifyDomain();
  // 1. DB-stored token from Dev Dashboard OAuth install.
  const dbTok = await tryDbToken(domain);
  if (dbTok) return dbTok;

  const envTok = pickEnvToken();
  if (envTok) return envTok;

  throw makeAuthError(
    "no_token",
    "Ingen Shopify Admin-token hittades. Installera Shopify-appen via 'Installera Shopify-app' i admin, " +
      "eller lägg till SHOPIFY_ADMIN_ACCESS_TOKEN.",
  );
}

let preflightOk: { source: string; domain: string } | null = null;

export async function ensureShopifyAuth(): Promise<{ source: string; domain: string }> {
  if (preflightOk) return preflightOk;
  const { token, source } = await pickShopifyToken();
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
  const { token } = await pickShopifyToken();

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

// ---------------------------------------------------------------------------
// Multi-tenant: a Shopify Admin GraphQL client bound to ONE shop + token.
// No shared module state → safe under concurrent requests from different shops.
// Prefer this in tenant-scoped functions (derive shop+token from the session
// token via requireInstallation). The globals above stay for the single-tenant
// Gelato/order webhooks that resolve a token from env.
// ---------------------------------------------------------------------------
export type ShopifyAdminClient = <T>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

export function makeShopifyAdmin(shop: string, token: string): ShopifyAdminClient {
  const domain = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return async function boundAdmin<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
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
      throw makeAuthError(
        "invalid_token",
        `Shopify Admin-token avvisades (${r.status}) för ${domain}.`,
        { status: r.status, body: json ?? raw, domain },
      );
    }
    if (!r.ok || json?.errors) {
      const detail = json?.errors ?? json ?? raw;
      throw new Error(`Shopify API ${r.status}: ${JSON.stringify(detail).slice(0, 500)}`);
    }
    return json.data as T;
  };
}
