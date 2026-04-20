

# Mockups, dynamisk ramtjocklek och bakgrundsfärg

## 1. Mockups visas inte – diagnos och fix

**Sannolika orsaker (i prioritetsordning):**
1. `config.gelato_sku_map` är troligen tom i databasen → `productUid` blir `undefined` → vi går till fallback-grenen och visar bara tryckfilen (som nu visas tom om `print` också misslyckas).
2. `generate-print-file` returnerar 500 om bucket `print-files` är public men upload misslyckas (t.ex. duplicate path), eller om Mapbox static returnerar fel storlek. Inga error-loggar har triggats nyligen — funktionen anropas alltså antingen inte alls, eller anropas men misslyckas tyst i klienten.
3. Klienten loggar `console.warn("[MockupGallery] failed", e)` men felet ignoreras visuellt — användaren ser bara tom panel.

**Fix:**
- **`MockupGallery.tsx`**:
  - Lägg till tydlig felvisning per thumbnail (röd badge + felmeddelande) istället för tomma rutor.
  - Visa alltid 4 thumbnails: 1 = riktig mockup om möjligt, 3 = tryckfilen som "Förhandsgranskning".
  - Logga hela `printRes` och `mockupRes` i console för debug (response, error, status).
  - Trigga generering även om `variant` saknas (använd `Object.values(skuMap[size] ?? {})[0]` som fallback).
  - Visa loading-skeleton i varje thumbnail-ruta (inte bara en spinner överst) så det ser ut som att något händer.
- **`generate-print-file/index.ts`**:
  - Returnera mer detaljerade fel (status + Mapbox-svar) i console.error så loggarna säger något.
  - Om Storage-upload returnerar duplicate, försök med ny UUID en gång till.
  - Stoppa max-höjd/bredd vid 1280 (gratis Mapbox-tier) — redan gjort, behåll men logga `w x h` och slut-URL.
- **Edge function check**: deploya `gelato-mockup` och `generate-print-file` på nytt så vi får färska loggar nästa gång galleriet körs.

## 2. Dynamisk ramtjocklek (fysiskt korrekt)

**Problem:** Idag är `border: 16px solid …` hårdkodat — samma px oavsett 30x40 cm eller 70x100 cm.

**Fix (Gelato-konsekvent):**
Gelato-ramar är ~20 mm breda (deras "Standard frame" är ~2 cm). Tjockleken ska alltså vara konstant i mm/cm, men på skärmen är previewns bredd skalad mot postern. Vi använder en **relativ ratio** baserad på posterns kortsida:
- Frame-bredd i cm = `2.0 cm` (standard) — `2.5 cm` för canvas-djup om vi vill matcha senare.
- Som andel av kortsidan: `2 / min(w_cm, h_cm)` → t.ex.
  - 21x30 → 2/21 ≈ 9.5% av bredden
  - 30x40 → 2/30 ≈ 6.7%
  - 50x70 → 2/50 ≈ 4.0%
  - 70x100 → 2/70 ≈ 2.9%
- Implementeras genom att skicka in `borderWidthPct` (number) till `MapPreview` istället för hela `borderCss`-strängen, och sätta `border-width: calc(X% * shortSide)` via `padding`-trick eller direkt på preview-framen som `border: Npx solid color` där `Npx` räknas ut runtime via `ResizeObserver` på framen (`shortSidePx * pct`).

**Filer:**
- `src/pages/EditorPage.tsx`: byt `FRAME_BORDER_CSS` till `FRAME_COLORS` (bara färgen) + `FRAME_WIDTH_CM = 2`.
- `src/components/editor/MapPreview.tsx`: ta in `frameColor` och `frameWidthCm`, beräkna pixlar dynamiskt med `ResizeObserver` på framen mot `size`-cm, sätt `borderWidth` inline. För `Ingen ram` → `0`.

## 3. Bakgrundsfärg på postern (väljs i Kartstil-fliken)

**Default:** beige `#EFE7D6` (samma ton som vår paper-bakgrund men något mörkare så det syns mot panelen).

**Implementation:**
- **Store (`editorStore.ts`)**: lägg till `posterBgColor: string` med default `#EFE7D6` + `setPosterBgColor`.
- **`ControlPanel.tsx`** (Kartstil-fliken, under "Form"): lägg till sektion "Bakgrundsfärg" med ~8 förvalda swatch-cirklar (beige, vit, off-white, ljusgrå, sand, ljusgrön, ljusblå, svart) + en `<input type="color">` för custom. Cirklar = 32px med vald-ring.
- **`MapPreview.tsx`**:
  - Sätt `frameStyle.background = posterBgColor`.
  - Bakgrunden syns runt kartan när `mapShape` är `square`/`circle` (där den finns space) och under text-zoner.
  - Map-containern ligger fortfarande ovanpå.

**Affärsregel:** spara `posterBgColor` i cart-properties (`_bg_color`) för Gelato-ordern.

## 4. Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/stores/editorStore.ts` | `posterBgColor` + setter |
| `src/components/editor/ControlPanel.tsx` | Bakgrundsfärg-sektion i Kartstil med swatches + custom |
| `src/components/editor/MapPreview.tsx` | Dynamisk ramtjocklek via ResizeObserver, applicera `posterBgColor` på framen |
| `src/pages/EditorPage.tsx` | `FRAME_COLORS` map + `FRAME_WIDTH_CM`; skicka color/width-cm till MapPreview; lägg `_bg_color` i properties |
| `src/components/editor/MockupGallery.tsx` | Bättre fel/loading-UI per thumbnail, fler logs, fallback-tryckfil i alla 4 rutor om mockup misslyckas |
| `supabase/functions/generate-print-file/index.ts` | Mer detaljerade error-logs, retry på upload-collision |
| `supabase/functions/gelato-mockup/index.ts` | Detaljerade console-logs (request body, taskId, polling-status) för diagnos |

## 5. Implementationsordning

1. Mockup-pipeline: bättre logging i båda edge functions + redeploy + tydlig fel-UI i `MockupGallery`. Verifiera i logs att `productUid` faktiskt är mappad. Om inte, använd första värde i `gelato_sku_map[size]` som fallback.
2. Dynamisk ramtjocklek (ResizeObserver-baserad).
3. Bakgrundsfärg (store + swatches + applicering).

## 6. Inte med (kommer senare som du sa)

- Drag-och-släpp-config för placeholder-positioner och låsning per-fält.
- Flera oberoende textrader.
- 3D-canvas-rotation.

