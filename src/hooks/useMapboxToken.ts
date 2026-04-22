// React Query hook that fetches the public Mapbox token via the
// `get-mapbox-token` edge function once per session and caches it.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMapboxToken() {
  return useQuery({
    queryKey: ["mapbox-token"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-mapbox-token", {});
      if (error) throw error;
      return (data as { token?: string })?.token ?? "";
    },
    staleTime: 1000 * 60 * 60, // 1h
    gcTime: 1000 * 60 * 60,
  });
}
