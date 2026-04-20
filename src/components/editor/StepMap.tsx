import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default-marker (Leaflet behöver explicit ikonpath i Vite)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export function StepMap() {
  const { mapAddress, mapCoords, setMap, clearMap, next, back } = useEditorStore();
  const [query, setQuery] = useState(mapAddress || "");
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    const start: [number, number] = mapCoords ? [mapCoords.lat, mapCoords.lng] : [59.3293, 18.0686];
    const map = L.map(mapRef.current, { zoomControl: false }).setView(start, mapCoords ? 14 : 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    if (mapCoords) {
      markerRef.current = L.marker([mapCoords.lat, mapCoords.lng]).addTo(map);
    }
    leafletRef.current = map;
    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
      );
      const data = await res.json();
      if (!data.length) {
        toast.error("Adressen kunde inte hittas");
        return;
      }
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      setMap(query, { lat, lng });
      const map = leafletRef.current;
      if (map) {
        map.setView([lat, lng], 14);
        if (markerRef.current) markerRef.current.remove();
        markerRef.current = L.marker([lat, lng]).addTo(map);
      }
    } catch (e) {
      console.error(e);
      toast.error("Sökningen misslyckades");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Lägg till en adress eller plats (valfritt). Hoppa över om du bara vill ha din bild.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Adress eller plats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <Button onClick={search} disabled={searching}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div ref={mapRef} className="w-full h-72" />
      </Card>

      {mapAddress && (
        <div className="flex items-center justify-between text-sm bg-muted px-3 py-2 rounded-md">
          <span className="truncate">{mapAddress}</span>
          <Button size="icon" variant="ghost" className="size-7" onClick={() => { clearMap(); setQuery(""); markerRef.current?.remove(); }}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={back}>Tillbaka</Button>
        <Button className="flex-1" onClick={next}>{mapAddress ? "Nästa" : "Hoppa över"}</Button>
      </div>
    </div>
  );
}
