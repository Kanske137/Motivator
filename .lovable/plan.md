

# Mapiful-revamp: form-bug, etiketter, mockups och styling

## 1. Kartform påverkar HELA editorns aspekt — fix
**Problem:** Idag tvingas hela `frameStyle.aspectRatio` till `1` när man väljer kvadrat/cirkel. Det betyder att hela posterramen (inkl. text-zoner) blir kvadratisk — det är fel.

**Fix i `MapPreview.tsx`:**
- Yttre `frameStyle` använder ALLTID poster-aspekt från `size + orientation` (aldrig påverkad av `mapShape`).
- Layer för kartan (idag `absolute inset-0`) får istället en INRE wrapper som styrs av `mapShape`:
  - `rect` → fyller hela ytan (inset-0)
  - `square` → centrerad `aspect-square` med `max-w/max-h: 100%` så den krymps in
  - `circle` → samma som square + `border-radius: 9999px`
- Mapbox-containern ligger inuti den wrappern och fyller den.
- Texterna placeras fortfarande mot ytter-framen (poster-koordinater), inte mot map-shapen.

## 2. "Visa områdesnamn" fungerar inte
**Problem:** `applyLabelVisibility` körs på `style.load`, men efter en `setStyle` kan effekten också köra innan `isStyleLoaded()`. Och vid manuell toggle kan stilen vara mitt i en byte.

**Fix:**
- Wrappa `applyLabelVisibility` att vänta på `map.isStyleLoaded()`; om inte, registrera engångs-`idle`/`styledata`-listener.
- Effekten `[showLabels]` använder den safe-versionen.
- I `style.load`-handlern, läs alltid senaste `showLabels` från store och applicera.
- Logga en gång i konsolen hur många symbol-layers som hittades så vi kan verifiera.

## 3. Förhandsgranskning visar fortfarande inga Gelato mockups
**Nuläge:** `MockupGallery` skapar bara textade placeholders — anropar aldrig edge-funktionen.

**Fix (MVP, riktiga Gelato-mockups):**
- I `MockupGallery`: när `config + size + variant` finns, beräkna `productUid` via `config.gelato_sku_map[size][variant]`.
- Behöver en `imageUrl` som tryckfil. Två steg:
  1. Anropa befintlig edge-funktion `generate-print-file` med aktuell `mapStyleId`, `mapCenter`, `mapZoom`, `size`, `orientation`, `text`, `textFont` → får tillbaka en publik bild-URL (Mapbox Static Images-rendering, redan implementerat enligt projektets edge functions).
  2. Skicka `{productUid, imageUrl}` till `gelato-mockup` edge-funktionen.
- `gelato-mockup` returnerar antingen `mockupUrl` eller `fallback:true`. Vid fallback visas tryckfilen direkt som thumbnail (så användaren ser något verkligt och inte text).
- Debounce på 600 ms så vi inte ramlar igenom rate limits vid varje pan/zoom; regenerera när `mapCenter/mapZoom/mapStyleId/size/variant/orientation/text` ändras.
- Visar 4–6 thumbnails i scrollbar rad. Loading-state per thumbnail.
- Robust felhantering: vid fel, fall tillbaka till tryckfil-thumbnail med liten "Förhandsgranskning"-etikett.

> Notera: Detta kräver att `generate-print-file` returnerar en publikt nåbar URL (Supabase Storage). Om den i nuläget bara returnerar bytes/base64 lägger jag in en upload till Storage-bucket `print-files` (offentlig) och returnerar dess URL.

## 4. Mapiful-styling (på riktigt denna gång)
Mer trogen Mapifuls visuella språk:

**Färgsystem (`src/index.css`):**
- `--background`: varm benvit `#F4EFE6` (HSL `36 30% 93%`)
- `--paper` (preview-yta): något mörkare beige `#EDE5D6` (HSL `36 30% 88%`)
- `--card` på panelen: ren vit `#FFFFFF`
- `--primary`: djup grafit-svart `#1A1A1A` (HSL `0 0% 10%`)
- `--accent`: mjuk sand `#E8DFCC`
- `--border`: subtil `#E5DED0`
- `--radius`: `1rem` (mer rundat överallt)

**Komponentstil:**
- Sektioner i kontrollpanelen: ta bort accordion-divider-linjer, gör varje sektion till ett "kort" med vit bakgrund, mjuk skugga och `rounded-2xl`. Mellanrum mellan kort: `space-y-3`.
- Accordion-trigger: större (`h-14`), versaler/letter-spacing borttagen, semibold, chevron till vänster (Mapiful-stil) — dock praktiskt med chevron till höger; vi behåller höger men mer subtil.
- Stil-thumbnails: `rounded-xl`, tunnare ring vid val (2px svart), subtil hover-lift.
- Form-knapparna (rect/square/circle): större ikoner (h-7), `aspect-square`, vald = svart fyllning vit ikon.
- Frame-thumbnails: `rounded-2xl`, vald = 2px svart ring + liten checkmark badge i hörnet.
- Storlek-dropdown: `h-12 rounded-full` med stor textsymbol.
- Sökfält: `h-12 rounded-full` med ikonen vänster, mjuk inner-shadow.
- CTA "Lägg i varukorg": `rounded-full`, full bredd, svart bakgrund, vit text, `h-14`, prisen visas större till höger.
- Produkt-tabs (Poster/Canvas): byts till en pill-toggle (segmented control), inte två separata knappar.
- Typsnitt: lägg till en serif-font (Cormorant Garamond / Playfair Display via Google Fonts) för rubriker och produkt-titeln i toppen — det är centralt i Mapifuls look. Sans-serif (Inter) för kontroller och brödtext.

**Preview-yta:**
- Bakgrund `bg-[hsl(var(--paper))]` med subtilt papper-grain (CSS radial gradient overlay, mycket lågt opacity).
- Posterns drop-shadow: större och mjukare (`shadow-[0_30px_60px_-20px_rgba(0,0,0,0.25)]`).

## 5. Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/editor/MapPreview.tsx` | Frikoppla `mapShape` från ytter-frame; inre wrapper för kvadrat/cirkel; safe label-visibility |
| `src/components/editor/MockupGallery.tsx` | Anropa `generate-print-file` + `gelato-mockup`; debounce; fallback till tryckfil |
| `supabase/functions/generate-print-file/index.ts` | Säkerställ publik URL-retur (Storage upload om saknas) |
| `src/components/editor/ControlPanel.tsx` | Kort-baserade sektioner, segmented-style toggles, Mapiful-spacing |
| `src/components/editor/FormatSection.tsx` | Pill-toggle produkt, större knappar, pill-dropdown |
| `src/components/editor/FrameOption.tsx` | `rounded-2xl`, vald-checkmark, mjukare skugga |
| `src/pages/EditorPage.tsx` | Större serif-titel, ny CTA-stil med pris höger, paper-bakgrund med grain |
| `src/index.css` | Nytt varmt färgsystem, större radius, serif font import |
| `tailwind.config.ts` | Lägg till `serif` font-family |
| `index.html` | Google Fonts: Cormorant Garamond + Inter |

## 6. Implementationsordning
1. **Form-bugg** (kritisk): frikoppla mapShape från frame-aspekt.
2. **Labels-toggle**: safe-apply mot `isStyleLoaded`.
3. **Mockup-pipeline**: print-file → gelato-mockup edge function, fallback till tryckfil.
4. **Mapiful-styling**: färger, fonter, kort, pills, CTA.

## 7. Inte med (bekräftat senare)
- Admin-config-sidan (gör vi när 1–4 är klara).
- Flera stylade textrader.
- 3D-canvas-rotering.

