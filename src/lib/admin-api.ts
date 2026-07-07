// Client for the tenant-scoped admin edge function (`admin-templates`).
//
// Every admin write that RLS now denies from the browser goes through here:
// we attach a Shopify App Bridge session token, the edge function verifies it,
// derives the merchant's installation_id, and writes with service_role scoped
// to that tenant.

import { supabase } from "@/integrations/supabase/client";
import { getAdminSessionToken } from "./shopify-app-bridge";

export class AdminApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
  }
}

interface AdminResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  [k: string]: unknown;
}

/** Call an `admin-templates` action. Throws {@link AdminApiError} on failure. */
export async function invokeAdmin<T = AdminResponse>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const token = await getAdminSessionToken();
  const { data, error } = await supabase.functions.invoke("admin-templates", {
    body: { action, ...payload },
    headers: { "X-Shopify-Session-Token": token },
  });

  if (error) {
    // FunctionsHttpError carries the non-2xx body in `context`; try to read it.
    let detail = error.message ?? "Anropet till admin-templates misslyckades";
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const body = (await ctx.clone().json()) as AdminResponse;
        detail = body.message ?? body.error ?? detail;
        throw new AdminApiError(detail, body.error);
      } catch (e) {
        if (e instanceof AdminApiError) throw e;
      }
    }
    throw new AdminApiError(detail);
  }

  const res = (data ?? {}) as AdminResponse;
  if (res.ok !== true) {
    throw new AdminApiError(res.message ?? res.error ?? "Okänt fel", res.error);
  }
  return res as T;
}
