

## Tre ändringar — reviderad plan

### 1. Sömlöst byte mellan Poster och Canvas (utan att förlora design)

**Krav:** Alla designval (kartposition, zoom, stil, text, font, bakgrund, form, labels) ska bevaras 1:1 vid byte. Ingen ny UI-kontroll får läggas till och inget får flytta runt.

**Lösning — byt produkt-typ via befintliga Format-sektionen:**

Idag finns redan en produktväljare i `FormatSection` (via `onProductChange`). Vi gör inga nya kontroller — vi gör bara så att:

- `editorStore.setConfig()` slutar nollställa map-state. Den ska bara röra fält som är *produkt-specifika* (sizes/variants som inte längre finns) — aldrig `mapCenter`, `mapZoom`, `mapStyleId`, `text`, `textFont`, `textVisible`, `posterBgColor`, `mapShape`, `showLabels`, `placeName`, `orientation`.
- När man byter till en produkt vars `map_styles` inte innehåller nuvarande `mapStyleId` → fall tillbaka till första tillgängliga stil, men behåll allt annat.
- När `size`/`variant` inte finns i nya produkten → välj första giltiga kombo (precis som idag), men karta + text rörs inte.
- `EditorPage.onProductChange` uppdaterar `?handle=` (redan gjort) — inga UI-ändringar.

**Resultat:** Kunden kan i Format-sektionen växla mellan poster och canvas (båda finns redan i `configs`-listan från `loadAllConfigs`) och behåller sin design intakt.

**Shopify-snippet:** uppdateras så `ADD_TO_CART`-meddelandets `d.handle` används mot rätt produkt oavsett vilken produktsida snippet:en sitter på. Färdig kod levereras.

### 2. Verifiera att print-fil genereras korrekt

Inga kodändringar förrän vi sett resultatet. Jag kör:

- `supabase--curl_edge_functions` mot `generate-print-file` med realistisk payload (Stockholm, A3, Vit ram + en canvas-variant separat)
- Kontrollerar returnerad URL i `print-files`-bucket: korrekt fysisk storlek, DPI och bleed (canvas wrap kräver extra marginal)
- Läser `shopify-order-webhook`-loggar för senaste försök
- Rapporterar resultat. Fixar i `generate-print-file` om något fattas (vanligast: bleed för canvas, label-rendering, font-embedding)

### 3. Exakt editor-bild som produktbild i Shopify-kundvagnen

**Flöde:**

1. Vid klick på "Lägg i varukorg":
   - Utöka `editor-snapshot.ts` så den renderar hela kompositionen inklusive ram (poster) eller canvas-wrap (3D-look platt-projicerad) — samma vy som preview
   - Komprimera till PNG ~max 400 kB
   - Ladda upp till ny publik bucket `cart-previews` (filnamn `{design_id}.png`)
   - Skicka publika URL:en som `_preview_image` i `ADD_TO_CART`-properties
2. Shopify-sidan:
   - Uppdaterad `personlig-karta-editor`-snippet skickar `_preview_image` som line-item-property
   - Ny snippet `cart-preview-override` som inkluderas i cart-templaten byter ut `<img>` för rader som har `properties._preview_image` mot kundens unika bild

**Du får färdig kod till båda Shopify-snippets + exakt instruktion var `cart-preview-override` ska klistras in.**

### Tekniska detaljer

**Filer som ändras (i nästnästa steg, default mode):**
- `src/stores/editorStore.ts` — `setConfig` bevarar allt design-state, fallback bara för ogiltiga val
- `src/lib/editor-snapshot.ts` — utöka med ram/canvas-wrap-rendering
- Ny: `src/lib/upload-preview.ts` — komprimera + ladda upp PNG
- `src/pages/EditorPage.tsx` — anropa snapshot+upload före `postMessage`/`addItem`, skicka `_preview_image`

**Ny Supabase-resurs:**
- Storage bucket `cart-previews` (publik, 5MB-cap, image/png)

**Inga UI-ändringar i `ControlPanel.tsx`** — produktbyte sker via befintlig `FormatSection`.

### Ordning

1. Verifiera `generate-print-file` (curl + logs, rapport till dig)
2. Patcha `editorStore.setConfig` så design bevaras vid produktbyte
3. Skapa `cart-previews`-bucket + utöka snapshot + upload-helper + skicka `_preview_image`
4. Leverera färdiga Shopify-snippets

