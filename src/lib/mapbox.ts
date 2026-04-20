import { supabase } from "@/integrations/supabase/client";

let cachedToken: string | null = null;

export async function getMapboxToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const { data, error } = await supabase.functions.invoke("get-mapbox-token");
  if (error || !data?.token) {
    console.error("Failed to fetch Mapbox token", error);
    return "";
  }
  cachedToken = data.token as string;
  return cachedToken;
}

export interface GeocodeResult {
  place_name: string;
  center: [number, number]; // [lng, lat]
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const token = await getMapboxToken();
  if (!token || !query.trim()) return [];
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query
  )}.json?access_token=${token}&limit=5&language=sv`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? []).map((f: any) => ({
    place_name: f.place_name,
    center: f.center,
  }));
}

export function styleUrl(styleId: string): string {
  return `mapbox://styles/mapbox/${styleId}`;
}
