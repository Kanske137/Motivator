

## Plan: En enda print-pipeline som klarar kartor, foto OCH AI-bilder upp till 10 MB

### Princip

**Källan bestämmer pipelinen — inte tvärtom.** Vi bygger tre tydliga vägar in, alla med samma utgång (`_print_file_url` på cart). Inga tysta fallbacks, inga server-side text-renderingar, inga Mapbox Static API-anrop.

```text
                       ┌─────────────────────────┐
KARTA-design  ───────► │ Browser snapshot (WebGL)│ ─┐
                       └─────────────────────────┘  │
                       ┌─────────────────────────┐  │   uploadPrintFile()
FOTO-uppladdning ────► │ Pass-through (originalfil) ─┼─► print-files bucket
                       └─────────────────────────┘  │         │
                       ┌─────────────────────────┐  │         ▼
AI-genererad bild ───► │ Pass-through (Replicate URL) ─┘  _print_file_url
                       └─────────────────────────┘             │
                                                                ▼
                                                    Shopify webhook → Gelato
```

### Del A — Karta-vägen (browser-snapshot, GPU-säker)

**`src/lib/editor-snapshot.ts`** — adaptiv upplösning baserat på enhet:

```ts
function pickHiresMaxPx(): number {
  // Heuristik: mobile/svag GPU → 2000, desktop → 3000, hög-DPI desktop → 3600
  const dpr = window.devicePixelRatio || 1;
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  if (isMobile) return 2000;          // ~167 DPI på 30 cm — Gelato-godkänt
  if (dpr >= 2) return 3600;
  return 3000;
}
```

- Försök rendera med vald MAX_PX. **Om Mapbox kastar `WebGL context lost` eller canvas.toDataURL ger tom bild → retry en gång på 70 % av storleken.** Om även retry failar → throw.
- JPEG quality 0.92 (0.95 ger ~30 % större filer utan synlig vinst i print).
- Returnera `{ dataUrl, widthPx, heightPx, sizeBytes }` så vi kan logga i konsol.

### Del B — Foto-uppladdning (pass-through, ingen re-encoding)

**Ny `src/lib/photo-source.ts`**:
- När användare laddar upp foto i editorn (befintlig flow utökas), behåll **originalfilen** som `File`-objekt i editor-store (parallellt med thumbnail som visas i editor).
- Vid "Lägg i varukorg" → om `photoSource` finns: hoppa över snapshot helt, ladda upp originalfilen direkt till `print-files` bucket via `uploadPrintFileBlob(file, designId)`.
- Validering klient-sida: max 10 MB, format JPEG/PNG/WebP, min 1500 px på kortaste sida (annars toast: "Bilden är för liten för print").
- **Editor-preview** använder en nedskalad version (max 1500 px) för att inte slöa ned UI.

### Del C — AI-genererad bild (pass-through från Replicate)

**`supabase/functions/replicate-style/index.ts`** — utöka:
- Ladda ner Replicate-output i edge function, ladda upp direkt till `print-files` bucket (inte bara returnera URL till klient).
- Returnera `{ previewUrl, printFileUrl }` till klienten.
- Editor visar `previewUrl` (Replicate ger redan ~1024–2048 px output, räcker för editor); `printFileUrl` lagras på `editorStore.aiPrintFileUrl`.
- Vid "Lägg i varukorg" → om `aiPrintFileUrl` finns: använd direkt som `_print_file_url`, ingen ny snapshot/upload.

### Del D — Storage bucket: hantera 10 MB-filer

**Migration**:
- Säkerställ `print-files` bucket finns, **public read**, **authenticated write**.
- Sätt `file_size_limit = 15 MB` (10 MB foto + headroom).
- Tillåt MIME types: `image/jpeg, image/png, image/webp`.
- RLS: alla får läsa (Gelato hämtar via URL); skrivning kräver auth.

**Cleanup-trigger** (skjuts upp men nämns i plan): cron-job som rensar print-files äldre än 90 dagar utan match i `gelato_orders`.

### Del E — Editor "Lägg i varukorg"-flöde, hård felhantering

**`src/pages/EditorPage.tsx`**:

```ts
// Pseudokod
const printFileUrl = await getPrintFileUrl({
  source: editorStore.designSource,  // "map" | "photo" | "ai"
  designId,
});
if (!printFileUrl) {
  toast.error("Kunde inte förbereda tryckfil — försök igen");
  return; // ABORT
}
// → endast nu lägg i cart
```

`getPrintFileUrl()` är dispatcher-funktion som väljer pipeline baserat på `designSource`. Inga silent catches.

Konsol-loggar (alltid):
```
[print-pipeline] source=map, hires=3000px, render=1820ms, size=1.4MB
[print-pipeline] uploaded → https://…/print-files/<id>.jpg
```

### Del F — Webhook: läs property, ingen legacy-fallback

**`supabase/functions/shopify-order-webhook/index.ts`**:
- Logga **alla** properties per line item (key + värdes-längd).
- Hämta `_print_file_url` från properties.
- **Om saknas**: spara order som `pending_manual` med error `"missing_print_file_url"`. Skicka **inte** till Gelato. Lägg notis i log för manuell hantering.
- **Ingen fallback till legacy `generate-print-file`**. Den är nu avstängd för normalflöde.

### Del G — Cart-thumbnail visar designens preview

Shopify `/cart/add.js` kan inte sätta line item image. Två komplementära åtgärder:

1. **Tematisk fix (dokumenterad)**: uppdatera `SHOPIFY_SETUP.md` med Liquid-snippet för cart-template som läser `line_item.properties._preview_image`.
2. **Fallback i appens egna CartDrawer (`src/components/CartDrawer.tsx`)**: läs `_preview_image` från attributes och visa istället för `imageUrl` när vi renderar cart i appen själv.

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/lib/editor-snapshot.ts` | Adaptiv MAX_PX, retry-på-mindre-vid-fel, returnera storleksinfo |
| `src/lib/photo-source.ts` (ny) | Hantera foto-upload, validering, original-File-objekt |
| `src/lib/print-pipeline.ts` (ny) | `getPrintFileUrl()` dispatcher för map/photo/ai |
| `src/lib/upload-preview.ts` | `uploadPrintFileBlob()` för rå Blob/File (ej bara dataURL) |
| `src/stores/editorStore.ts` | Fält: `designSource`, `photoFile`, `aiPrintFileUrl` |
| `src/pages/EditorPage.tsx` | Använd `getPrintFileUrl()`, hård fail, ta bort silent catch |
| `src/components/CartDrawer.tsx` | Läs `_preview_image` från attributes |
| `supabase/functions/replicate-style/index.ts` | Ladda upp output till `print-files`, returnera båda URLs |
| `supabase/functions/shopify-order-webhook/index.ts` | Logga properties, `pending_manual` om URL saknas, **ingen legacy fallback** |
| `supabase/migrations/<ts>_print_files_bucket.sql` | Bucket-config: 15 MB limit, MIME-allowlist, RLS |
| `SHOPIFY_SETUP.md` | Steg 6: Liquid-snippet för cart preview |

`supabase/functions/generate-print-file/index.ts` — **avstängd** (vi tar bort den från normalflödet helt; lämnas i repo som kommenterad referens, kan raderas i städ-commit senare).

### Förväntat resultat

| Scenario | Idag | Efter |
|----------|------|-------|
| Karta + svensk text + labels off | ❌ barcode+labels | ✅ pixel-identiskt med editor |
| Foto 8 MB JPEG | ❌ pipelinen går sönder | ✅ original passas igenom till Gelato |
| AI-bild från Replicate | ❌ inte stödd | ✅ direkt URL från Replicate → Gelato |
| Mobile (svag GPU) 30 cm karta | ❌ kan krascha tyst | ✅ adaptiv 2000 px + retry |
| `_print_file_url` saknas i webhook | ❌ tyst legacy-fallback med trasig output | ✅ `pending_manual` + larm |
| Cart-thumbnail | ❌ produktbild | ✅ designens preview (i app + Shopify-tema) |

### Verifiering

1. **Karta**: cirkel + labels OFF + svensk text → konsol visar `[print-pipeline] source=map`. Print-URL = editor-bild.
2. **Foto**: ladda upp 7 MB JPEG → konsol `source=photo, passthrough, 7.2MB`. Print-URL = exakt originalfilen.
3. **AI**: applicera stil → konsol `source=ai`. Replicate-output finns i `print-files` bucket.
4. **Mobil-test** (Lovable preview i mobile-läge): rendering klarar 30×40 poster utan krasch.
5. **Webhook-logg**: `using client print file <url>`. Om manuellt manipulerad cart utan URL → `pending_manual`, ingen Gelato-skick.

### Vad vi medvetet INTE bygger nu

- **Cleanup-cron för gamla print-files** — bucket växer max ~50 GB/år vid 5000 orders, läggs till om ekonomiskt motiverat.
- **PDF-output istället för JPEG** — Gelato rekommenderar JPEG/PNG för foton, PDF endast för vector. Ej relevant för våra produkter.

