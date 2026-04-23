// Client helper that calls the `gelato-mockups` edge function.
// Returns an array of { id, label, url } or null if Gelato is unavailable
// (in which case the caller should fall back to local composite mockups).
import { supabase } from "@/integrations/supabase/client";

export interface GelatoMockup {
  id: string;
  label: string;
  url: string;
}

export async function fetchGelatoMockups(args: {
  productUid: string;
  printFileUrl: string;
}): Promise<GelatoMockup[] | null> {
  try {
    const { data, error } = await supabase.functions.invoke("gelato-mockups", {
      body: {
        productUid: args.productUid,
        printFileUrl: args.printFileUrl,
      },
    });
    if (error) {
      console.warn("[gelato-mockups] invoke error:", error.message);
      return null;
    }
    if (!data?.ok || !Array.isArray(data.urls) || data.urls.length === 0) {
      console.warn("[gelato-mockups] empty / not-ok:", data?.error ?? data);
      return null;
    }
    return data.urls as GelatoMockup[];
  } catch (e) {
    console.warn("[gelato-mockups] threw:", e);
    return null;
  }
}
