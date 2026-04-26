
# Vit marginal + linjer — admin-only

Ja, jag förstår precis. Två nya admin-styrda designelement som blir en del av mallen — kunden ser dem men kan aldrig röra dem.

## Vad som finns idag (snabb status)

- `margin` och `line` finns redan som lagertyper i schemat (`template-schema.ts`) och renderas i kund-vyn via `StaticLayers.tsx`. ✅
- `LayerInspector` har **ingen** redigeringspanel för dessa två typer ännu — de kan skapas men inte konfigureras. ❌
- Print-pipelinen (edge function `generate-print-file`) ritar **inte** marginal/linje på den slutliga tryckfilen. ❌
- Modellen för marginaltjocklek är `thicknessMm` (millimeter) — vilket inte ger samma visuella tjocklek på 30×40 vs 50×70. Du vill ha **procent**, så att den skalar symmetriskt med motivet.

## Designbeslut

**Vit marginal** (en per mall, men tekniskt får man lägga flera):
- Tjocklek anges i **% av kortaste sidan** → garanterar identiskt avstånd på alla fyra kanter oavsett aspekt (3:4, 4:3, 1:1).
- Färg: standard `#FFFFFF`, men valbar (du kan vilja ha svart marginal nån gång).
- Position låst till `0,0,100,100` (täcker hela motivet) — användaren behöver bara välja tjocklek + färg.
- Renderas **ovanpå** allt annat innehåll (högst zIndex), så det "klipper" motivet visuellt.

**Linjer** (fri placering):
- Tjocklek i **mm** (behålls — linjer är typiskt tunna detaljer där absolut tjocklek matters).
- Längd + position styrs via vanliga `xPct/yPct/wPct/hPct` — exakt som vilket lager som helst.
- Orientering: horisontell / vertikal.
- Färg: standard `#000000` (ändrar default från nuvarande `#1A1A1A`).

**Kund-låsning**: alla locks (`position`, `size`, `shape`, `content`, `style`, `visibility`) sätts till `true` som default vid skapande. Kund-editorn rör redan inte `margin`/`line` lager — de ritas bara ut. Vi behöver bara säkerställa att admin inte råkar låsa upp dem.

## Implementation (ordning)

### 1. Schema (`src/lib/template-schema.ts`)
- Byt `marginDefaultsSchema.thicknessMm` → `thicknessPct` (number, 0–25).
- Behåll `lineDefaultsSchema.thicknessMm` som det är.
- Lägg till en migrering i `template-migrate.ts` som konverterar gamla `thicknessMm` → `thicknessPct` (anta ~5% som default vid läsning av gamla mallar).

### 2. Factories (`src/lib/layer-utils.ts`)
- Margin-default: `{ thicknessPct: 5, color: "#FFFFFF" }`, alla locks `true`.
- Line-default: ändra färg till `#000000`, alla locks `true`.

### 3. Renderer (`src/components/editor/layers/StaticLayers.tsx`)
- `MarginLayerView`: rita fyra rektanglar (top/right/bottom/left) eller en `box-shadow inset` där tjockleken = `thicknessPct%` av canvas-kortsidan. Detta måste lyftas en nivå upp eftersom komponenten idag bara ser sin egen `inset:0`-box, inte vilken sida som är kortast. Lösning: skicka in `canvasShortSidePx` som prop från `MapPreview` och räkna ut tjockleken där.
- `LineLayerView`: oförändrad logik, men säkerställ att färg appliceras korrekt.

### 4. Inspector (`src/components/admin/LayerInspector.tsx`)
- Lägg till två nya redigeringsblock som visas när `layer.type === "margin"` resp. `"line"`:
  - **Margin**: Slider för `thicknessPct` (0–25%), färgväljare (`<input type="color">`), info-text "Marginalen är låst till motivets kant och rörs inte av kunden."
  - **Line**: Select för orientering (horisontell/vertikal), number-input för `thicknessMm` (0.5–20), färgväljare. Position/storlek redigeras redan via befintliga fält.
- Dölj lock-toggles för dessa två typer (de är alltid låsta för kunden) — eller visa dem som info-tags ("Alltid låst").

### 5. Print-pipeline (`supabase/functions/generate-print-file/index.ts`)
- Lägg till två nya rendering-grenar i layer-loopen:
  - **margin**: rita en ifylld ram i angiven färg, tjocklek = `thicknessPct/100 * min(canvasW, canvasH)`. Ritas **sist** så den ligger överst.
  - **line**: rita en fylld rektangel med beräknade px-mått, tjocklek = `thicknessMm * pxPerMm`.
- Båda måste respektera kanvas-bleed precis som befintliga lager.

### 6. Admin-canvas (`src/components/admin/LayerCanvas.tsx`)
- Visa marginal/linje med samma renderare som kund-vyn (snyggast: importera `MarginLayerView`/`LineLayerView`). Idag visas de bara som en label-platshållare.

## Kund-säkerhet

Inget UI behöver byggas på kundsidan — `ControlPanel` och `MapPreview` itererar redan layers och hoppar över allt utom `map`/`text`/`photo` när det gäller redigeringskontroller. Marginal/linje renderas bara visuellt. Locks är "bälte och hängslen".

## Frågor innan jag kör

1. **Marginal-tjocklek max 25%** — räcker det, eller vill du kunna gå ända till 40% för retro-look-ramar?
2. **Endast en marginal per mall, eller får admin lägga flera** (t.ex. dubbel ram)? Jag föreslår att tillåta flera (enkelt schemamässigt) men inte bygga någon special-UI för det.
3. **Migrering av befintliga marginal-lager**: Finns det idag några sparade marginal-lager i databasen vi behöver konvertera, eller är funktionen oanvänd? (Jag kan kolla med en read-query om du säger till.)
