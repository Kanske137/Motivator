// React Query hook over the imported provider catalog (`product_bases`).
// Catalog data changes only when `pod-catalog-import` re-runs, so cache hard.
import { useQuery } from "@tanstack/react-query";
import { fetchProductBases } from "@/lib/pod/bases";

export function useProductBases(provider = "gelato") {
  return useQuery({
    queryKey: ["product-bases", provider],
    queryFn: () => fetchProductBases(provider),
    staleTime: 1000 * 60 * 60, // 1h — refreshed by re-import, not by the client
    gcTime: 1000 * 60 * 60,
  });
}
