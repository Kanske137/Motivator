

## Plan: Skalbar print-fil-pipeline för stora bilder (upp till 10 MB)

### Problemet du pekar på

Resvg-WASM i edge function kraschar redan på 4.6 MP Mapbox-tile (437 KB källa). Med framtida foto/AI-bilder på 10 MB / 20+ MP är pipelinen helt körd. Vi måste byta arkitektur **innan** bild-stödet byggs, inte efter.

Rotorsaken är inte filstorleken i bytes — det är **pixelantalet resvg måste rastrera** + att hela operationen sker i en CPU-begränsad edge function (~3s budget, ingen SIMD).

### Ny arkitektur: "Pass-through när möjligt, komponera när nödvändigt"

Insikt: I 80% av fallen behöver vi inte rastrera om källbilden alls. Vi behöver bara:
1. Lägga text-overlay (litet område)
2. Eventuellt clippa till cirkel/kvadrat (mask)
3. Skicka URL till Gelato

Gelato accepterar PNG/JPEG print-filer direkt. Vi behöver inte bygga en ny pixelmatris — vi kan **leverera källbilden + en separat overlay**, eller komponera smartare.

### Tre-lagers strategi

**Lager 1 — Pass-through (0 CPU, gratis)**
När: `kind:"image"` + `mapShape="rect"` + ingen text
→ Använd källbildens URL direkt som print-fil. Ingen rastrering. Hanterar 10 MB / 50 MP utan problem.

**Lager 2 — Lättviktskomposition (låg CPU)**
När: text behövs OCH/ELLER shape-clip behövs
→ Byt från resvg-WASM till **`@napi-rs/canvas` via Deno** ELLER **ImageScript** (ren TS, snabb, ingen WASM-rastrerings-overhead).
→ ImageScript kan ladda en JPEG/PNG som buffer, rita text + mask ovanpå, exportera. CPU-tid skalar med **overlay-area**, inte hela bilden.
→ För 20 MP-bild med 5% text-area = ~1 MP faktisk rastreringskostnad, oavsett källans storlek.

**Lager 3 — Async background job (för värsta fallet)**
När: extremt stora bilder (>30 MP) eller komplexa kompositioner som ändå tippar CPU
→ Edge function returnerar omedelbart `status:"processing"`, lägger jobb på en `print_jobs`-tabell
→ Andra edge function (eller pg_cron) plockar upp och bearbetar med längre timeout via Supabase background tasks (`EdgeRuntime.waitUntil`)
→ När klart: uppdatera `gelato_orders.print_file_url` + skicka till Gelato

### Konkret implementering — fas 1 (nu, för stabil map-pipeline)

Innan vi bygger bild-stödet: **byt rastrerings-bibliotek** för att få headroom även för kartor med cirkel-clip.

**Byt resvg-WASM → ImageScript** i `generate-print-file`:
- ImageScript är pure-TS, har inbyggd PNG/JPEG decode/encode, text rendering, mask, composite
- ~3-5× snabbare än resvg-WASM på samma operation eftersom den inte måste först parsa SVG
- Direkt buffer-manipulation: `image.composite(overlay, x, y)` istället för SVG→raster

Pipeline blir:
1. Fetch Mapbox-tile som PNG-buffer → `Image.decode(buf)`
2. Om shape ≠ rect: skapa mask-image, `image.mask(maskImage)`
3. Om text: `image.drawText(font, text, x, y, color)`
4. `image.encode()` → PNG-buffer → upload

Inga SVG, ingen pixel-upscaling, CPU-tid ~500ms istället för 2600ms.

### Konkret implementering — fas 2 (när bild-stöd byggs)

När `kind:"image"` läggs till:

**Klient-sida (editor) — komprimera FÖRE upload:**
- Foto-upload genom `<input type=file>` → använd Canvas API i browsern för att resampla till **max 3000 px längsta sida + JPEG quality 0.9**
- 3000 px på 30 cm = 254 DPI = print-kvalitet
- Resulterar i ~1.5–3 MB filer istället för 10 MB
- Ladda upp till ny `artwork-sources` storage bucket
- Skicka URL i cart properties

**Server-sida — pass-through eller ImageScript:**
- Om rect + ingen text: pass-through (Lager 1)
- Annars: ImageScript-komposition (Lager 2)
- Om bild >5000 px och komplex komposition: background job (Lager 3, framtida)

### Vad ändras i denna PR

**Filer (fas 1 — nu):**
1. **`supabase/functions/generate-print-file/index.ts`** — byt ut resvg-WASM mot **ImageScript** (`https://deno.land/x/[email protected]`):
   - Decode källa direkt till `Image`-buffer (ingen SVG-mellanlanding)
   - Implementera shape-clip via `Image.mask()` med genererad cirkel/kvadrat-mask
   - Implementera text via `Image.renderText()` med inbyggd font (Inter ttf laddas en gång)
   - Encode → PNG buffer → upload som idag
   - Behåll `Artwork`-input-kontraktet (map/image agnostisk)
   - Lägg till pass-through-gren: om `kind:"image"` + rect + ingen text → fetch source, upload utan modifiering, returnera URL

2. **`src/pages/EditorPage.tsx`** — ingen ändring nu (bild-upload kommer i fas 2)

3. **`supabase/functions/shopify-order-webhook/index.ts`** — ingen ändring (`artwork`-objektet skickas redan korrekt)

**Filer (fas 2 — separat task när bild-funktionen byggs):**
- Editor: bild-upload med klient-sida resize + komprimering
- Ny `artwork-sources` storage bucket + RLS
- Eventuellt `print_jobs`-tabell för Lager 3 om vi ser att det behövs

### Förväntat resultat efter fas 1

| Scenario | Idag | Efter |
|----------|------|-------|
| Map rect, text | ✅ 1.5s | ✅ 0.4s |
| Map cirkel, text | ❌ timeout | ✅ 0.6s |
| Map cirkel, ingen text | ❌ timeout | ✅ 0.5s |
| Image 5 MB rect, ingen text (framtid) | n/a | ✅ <0.1s (pass-through) |
| Image 10 MB cirkel + text (framtid) | n/a | ✅ ~1.5s (ImageScript) |

### Verifiering

1. Du lägger ny testorder med **cirkel + labels off + text**
2. `gelato_orders` → `submitted` på första försöket
3. Print-fil visar cirkulär karta med vit bg + text-rad
4. Edge function-logg visar render-tid <1s

### Begränsningar / framtida

- ImageScript saknar custom font loading lika smidigt som SVG — vi kommer behöva embedda Inter.ttf (eller liknande) som binär i edge function. Hanterbart, ~150 KB extra deploy-storlek.
- Pass-through-grenen kräver att Gelato accepterar exakt formatet på källbilden (PNG/JPEG/dim). Verifieras vid fas 2.
- Lager 3 (async jobs) byggs först när vi ser konkret behov — börjar inte över-engineera.

