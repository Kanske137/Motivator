

## Plan: Använd browser-snapshot för print-fil (single source of truth)

### Problemet i en mening

Vi har **två olika renderings-pipelines** för samma artwork:
1. **Browser** (`renderArtworkSnapshot`) — Mapbox GL JS, perfekta labels, perfekt text, perfekta former. Används för thumbnails.
2. **Edge function** (`generate-print-file`) — Mapbox Static API + ImageScript, **kan inte stänga av labels** (Static API saknar URL-parameter), **kan inte rendera text korrekt** (ImageScript v1.2.17 + fontsource TTF → "no glyph"-rektanglar).

Detta är roten till båda problemen i din senaste testorder. Att fortsätta lappa edge-pipelinen leder till en lång svans av småfix utan slut. Vi måste konsolidera till **en pipeline**.

### Lösning: Print-fil = uppskalad browser-snapshot

**Insikt**: `renderArtworkSnapshot()` producerar redan exakt samma bild som editorn visar. Den skalas idag till max 1800 px (för thumbnails). Genom att höja upplösningen till **print-kvalitet (~3000–3600 px på längsta sidan = 250+ DPI för upp till 30 cm)** och låta browsern rendera och ladda upp resultatet, försvinner alla server-side-problem.

Tradeoff: Browsern gör tyngre arbete vid "Lägg i varukorgen", men:
- Det är en engångskostnad per design (~3–5 sekunder)
- Mapbox GL JS är hårdvaruaccelererad (WebGL), så det skalar bra
- Användaren får omedelbar visuell feedback istället för att vänta på edge function efter checkout
- Edge function blir trivial: "ta emot URL → skicka till Gelato"

### Konkret arkitektur

```text
EDITOR
  ↓
[Lägg i varukorg]
  ↓
renderArtworkSnapshot(input, { hires: true })
  → returnerar JPEG dataURL @ ~3000px längsta sida
  ↓
uploadCartPreview(dataURL, designId)        ← thumbnail @ 800px
uploadPrintFile(hiResDataURL, designId)     ← NEW: print @ 3000px
  ↓
cart properties:
  _print_file_url: <bucket-url till print-jpeg>
  _preview_url: <thumbnail-url>
  ↓
[Checkout → Shopify webhook]
  ↓
shopify-order-webhook → Gelato (skickar _print_file_url direkt)
```

`generate-print-file` edge function behövs **inte längre** för det normala flödet.

### Filer som ändras

**1. `src/lib/editor-snapshot.ts`** — lägg till `hires`-läge
- Ny optional input-parameter `hires?: boolean`
- När `hires: true`: höj `MAX_PX` från 1800 → 3600, höj `PX_PER_CM` från 24 → 32
- 30 cm × 32 = 960 px/sida → uppskalat med Mapbox @2x = ~3500 px för stor poster
- Returnera JPEG quality 0.95 istället för 0.92
- Ingen annan logik ändras → garanterad pixel-paritet med thumbnail

**2. `src/lib/upload-preview.ts`** — lägg till `uploadPrintFile()`
- Kopia av `uploadCartPreview()` men:
  - Inget komprimerings-steg (browsern har redan rätt upplösning)
  - Bucket: ny `print-files` (eller återanvänd existerande)
  - Ingen skalning
- Returnerar public URL

**3. `src/pages/EditorPage.tsx`** (eller där "Lägg i varukorg" hanteras)
- Anropa `renderArtworkSnapshot(input, { hires: true })` parallellt med thumbnail-snapshot
- Ladda upp via `uploadPrintFile`
- Lägg till `_print_file_url` i cart properties (redan etablerat mönster för `_preview_url`)

**4. `supabase/functions/shopify-order-webhook/index.ts`** — använd cart-property direkt
- Om line item har `_print_file_url` → skicka URL direkt till Gelato, **hoppa över** `generate-print-file`-anropet
- Behåll fallback-grenen (anropa edge function) för bakåtkompatibilitet med ev. existerande carts utan print-URL

**5. `supabase/functions/generate-print-file/index.ts`** — lämnas orörd som fallback
- Används inte i normalflödet längre, men finns kvar om något skulle gå fel klient-sida
- Kan rensas bort i framtida task

### Storage bucket

Behöver skapa eller återanvända en publik bucket för print-filer:
- Återanvänd existerande `print-files` bucket (skapas redan av nuvarande edge function)
- Public read, authenticated write
- Cleanup-policy senare (t.ex. radera filer äldre än 90 dagar utan order)

### Förväntat resultat

| Aspekt | Idag | Efter |
|--------|------|-------|
| Labels off | ❌ syns ändå | ✅ exakt som editor |
| Text rendering | ❌ "streckkod" | ✅ riktig font, ÅÄÖ funkar |
| Cirkel/kvadrat | ✅ funkar | ✅ funkar (oförändrad) |
| Tid för cart-add | ~1s | ~3–5s (acceptabelt) |
| Edge function-tid | ~2s + fail risk | hoppas över i 99% av fall |
| Pixel-paritet preview ↔ print | ❌ olika pipelines | ✅ samma kod |
| Framtida foto/AI-bilder | osäkert | trivialt — samma snapshot |

### Begränsningar / framtida

- **Mobile performance**: 3600px Mapbox-render använder ~50 MB GPU-minne kortvarigt. Testar på iPhone SE-klass under verifiering. Kan behöva sänkas till 2800 px om problem.
- **Print-DPI vs storlek**: 3000 px på 30 cm = 254 DPI (Gelato kräver ≥150 DPI, rekommenderar 300). Räcker för posters upp till ~50 cm. Större format kräver `MAX_PX = 4500` — bedöms vid behov.
- **Edge function `generate-print-file` blir vilande**: lämnas i koden för fallback, ingen löpande underhållskostnad.

### Verifiering

1. Lägg ny order: cirkel-form + labels OFF + text "STOCKHOLM\nSverige\n…"
2. Inspektera `_print_file_url` i Shopify cart → ska visa identisk artwork som editorn
3. `gelato_orders` → `submitted` på första försöket
4. Gelato dashboard visar ordern, print-fil är ~3000 px, text är skarp och utan "streckkod"

