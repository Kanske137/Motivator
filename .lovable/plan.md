

## Plan: Generalisera print-fil-pipeline för bilder + sänk CPU-belastning

### Bakgrund
PNG-rastreringen i `generate-print-file` timeoutar (`WORKER_RESOURCE_LIMIT`) på 8.8 MP. Samtidigt kommer editorn snart stödja foton + AI-modifierade bilder som motiv — inte bara kartor. Vi behöver en pipeline som hanterar båda utan att rastrera om hela canvasen.

### Designprincip: "Compose, don't rasterize"

Istället för att låta resvg rastrera en SVG som upscalar källbilden → låt **källbilden själv vara final-pixlarna**. Resvg används endast för text-overlay + clipping mask. Detta funkar identiskt för kartor och foton.

### Arkitektur (ny `generate-print-file`)

Edge function tar emot ett **generiskt motiv-objekt** istället för bara map-params:

```ts
type Artwork =
  | { kind: "map"; styleId: string; center: [number,number]; zoom: number; showLabels?: boolean }
  | { kind: "image"; sourceUrl: string }  // foton, AI-genererade bilder, uploads
```

Pipeline (samma för båda):
1. **Hämta källbild** som hög-DPI PNG
   - `map`: Mapbox Static API @2x (max 1280×1280 native ≈ 2560×2560 px)
   - `image`: fetch från `sourceUrl` (Supabase storage / AI-output URL)
2. **Bestäm canvas-storlek** = källbildens faktiska pixelmått (ingen upscaling)
3. **Bygg liten SVG** med: bg-rect, `<image href={dataUrl}>` 1:1, clip-mask, text-overlay
4. **Resvg rastrerar** → CPU-tid proportionell mot text-area, inte canvas-area
5. **Upload PNG** till `print-files` bucket, returnera URL + faktiska px-mått

### Vad detta löser

- **CPU-problemet**: resvg jobbar på ~2.2 MP istället för 8.8 MP, ingen scaling-matematik
- **Bild-stödet**: Samma kodväg — bara byt källa. Foto/AI-bild blir en `kind:"image"` istället för Mapbox-fetch
- **Print-kvalitet**: Mapbox @2x ger ~2560 px på längsta sidan = ~215 DPI på 30 cm-sida (godkänt för Gelato). AI-bilder från Replicate/Nano-banana är typiskt 1024–2048 px → samma nivå.

### Ingen ändring i editor/frontend

- `EditorPage.tsx`, `MapPreview`, `ControlPanel`, store — orörda
- `shopify-order-webhook` skickar idag bara map-params; vi gör payload **bakåtkompatibel**: om `artwork`-fältet saknas tolkas legacy `styleId/center/zoom` som `kind:"map"`
- När bild-funktionen läggs till i editorn senare, postar webhook bara `{ kind:"image", sourceUrl }` istället — noll ändringar i pipeline

### Upload-flöde för bilder (förberedelse, ej implementeras nu)

För framtida bild-stöd behövs en `artwork-sources` storage bucket där editorn laddar upp foton/AI-resultat. Webhook får sedan en signed URL i `_artwork_url` cart-property. **Detta byggs i nästa steg** när själva bild-uppladdningen i editorn implementeras — nu bara förbereder vi att pipelinen accepterar det.

### Filer som ändras nu

- `supabase/functions/generate-print-file/index.ts`
  - Refaktorera till `Artwork`-baserad input (bakåtkompatibel)
  - Byt SVG-rendering: använd källbildens native pixlar som canvas-storlek
  - Cap: 2560 px längsta sida (matchar Mapbox @2x max)
  - Lägg till `pngData.byteLength` + estimerad render-tid i loggar

- `supabase/functions/shopify-order-webhook/index.ts`
  - Skicka `{ artwork: { kind: "map", ... } }` i payload till `generate-print-file` (förbereder för `kind:"image"` senare)
  - Inga ändringar i SKU-resolver, inget annat rörs

### Verifiering

1. Du lägger ny testorder via Bogus Gateway
2. `gelato_orders` → status `submitted`, `gelato_order_id` finns
3. Print-fil i `print-files` bucket öppnas i browser → karta + text syns korrekt
4. Gelato dashboard visar ordern

### Senare (separat task, ej nu)

- Image-upload UI i editor (foto + AI-stilar)
- `artwork-sources` storage bucket + RLS
- Editor postar `_artwork_url` istället för map-params för bild-motiv

