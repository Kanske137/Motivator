// Auth guard for tenant-scoped admin edge functions.
//
// Usage inside a Deno.serve handler:
//
//   import { requireInstallation, AuthError, authErrorResponse } from "../_shared/require-installation.ts";
//   ...
//   let ctx;
//   try { ctx = await requireInstallation(req); }
//   catch (e) { if (e instanceof AuthError) return authErrorResponse(e, corsHeaders); throw e; }
//   const { installationId, shop, supabase } = ctx;
//   // every DB write MUST be scoped: .eq("installation_id", installationId)
//
// The returned `supabase` client uses the service_role key (bypasses RLS), so
// the ONLY thing standing between one shop and another's data is that you scope
// every query by `installationId`. Never take a shop/installation id from the
// request body — always from `ctx`.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { SessionTokenError, verifyShopifySessionToken } from "./shopify-session-token.ts";

export interface InstallationContext {
  shop: string;
  installationId: string;
  supabase: SupabaseClient;
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/** Pull the session token from the dedicated header, falling back to Bearer. */
function extractSessionToken(req: Request): string | null {
  const dedicated = req.headers.get("x-shopify-session-token");
  if (dedicated) return dedicated.trim();
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

/**
 * Verify the caller's Shopify session token and resolve the shop to its
 * `shopify_app_installations` row. Throws {@link AuthError} (→ 401/403/500) on
 * any failure. On success returns a service_role client + the tenant id.
 */
export async function requireInstallation(req: Request): Promise<InstallationContext> {
  const clientId = Deno.env.get("SHOPIFY_APP_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("SHOPIFY_APP_CLIENT_SECRET") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !srk) {
    throw new AuthError(500, "config", "Supabase service role saknas i miljön.");
  }

  const token = extractSessionToken(req);

  let shop: string;
  try {
    ({ shop } = await verifyShopifySessionToken(token, clientId, clientSecret));
  } catch (e) {
    if (e instanceof SessionTokenError) {
      // Config problems are ours (500); everything else is an unauthenticated caller (401).
      const status = e.code === "config" ? 500 : 401;
      throw new AuthError(status, e.code, e.message);
    }
    throw e;
  }

  const supabase = createClient(url, srk);
  const { data, error } = await supabase
    .from("shopify_app_installations")
    .select("id")
    .eq("shop_domain", shop)
    .maybeSingle();

  if (error) {
    throw new AuthError(500, "db_error", `Kunde inte slå upp installationen: ${error.message}`);
  }
  if (!data?.id) {
    // Token is valid but this shop has no install row — treat as not-installed.
    throw new AuthError(403, "not_installed", `Ingen aktiv installation för ${shop}.`);
  }

  return { shop, installationId: data.id as string, supabase };
}

/** Render an {@link AuthError} as a JSON Response. */
export function authErrorResponse(e: AuthError, corsHeaders: Record<string, string>): Response {
  // Log the reason server-side; return a terse code to the caller.
  console.warn(`[auth-guard] ${e.status} ${e.code}: ${e.message}`);
  return new Response(
    JSON.stringify({ ok: false, error: e.code, message: e.message }),
    { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
