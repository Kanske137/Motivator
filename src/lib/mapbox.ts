import { supabase } from "@/integrations/supabase/client";
import { mapStyleUrl } from "@/lib/map-style-catalog";

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
  city?: string;
  country?: string;
}

function extractCityCountry(f: any): { city?: string; country?: string } {
  const ctx: any[] = f.context ?? [];
  const country = ctx.find((c) => c.id?.startsWith("country"))?.text;
  const place = ctx.find((c) => c.id?.startsWith("place"))?.text;
  const city =
    f.place_type?.includes("place") || f.place_type?.includes("locality")
      ? f.text
      : place ?? f.text;
  return { city, country };
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const token = await getMapboxToken();
  if (!token || !query.trim()) return [];
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query
  )}.json?access_token=${token}&limit=4&language=sv`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? []).map((f: any) => {
    const { city, country } = extractCityCountry(f);
    return {
      place_name: f.place_name,
      center: f.center,
      city,
      country,
    };
  });
}

export async function reverseGeocode(
  lng: number,
  lat: number
): Promise<GeocodeResult | null> {
  const token = await getMapboxToken();
  if (!token) return null;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1&language=sv&types=place,locality,neighborhood,address,region,country`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) return null;
  const { city, country } = extractCityCountry(f);
  return {
    place_name: f.place_name,
    center: f.center,
    city,
    country,
  };
}

export function styleUrl(styleId: string): string {
  return mapStyleUrl(styleId);
}
