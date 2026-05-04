# Posterhängare — fyra fixar

## 1. Visa hängarval även för 13×18 (disabled)

Idag filtrerar `gelato-catalog.ts` bort hängar-varianter för 13×18 eftersom Gelato saknar UID. Vi ska istället alltid visa de fyra hängar-rutorna i `FormatSection`, men gråa ut dem på storlekar som saknar UID och visa en kort förklaring.

**Var:**
- `src/lib/gelato-catalog.ts` — sluta filtrera bort hängare för 13×18; markera dem som `available: false` istället (eller lägg till motsvarande flagga i variant-objektet).
- `src/components/editor/FormatSection.tsx` — när variant har `available === false`:
  - skicka `disabled` till `FrameOption`
  - visa text "Ej tillgänglig för denna storlek" istället för pris
- `src/components/editor/FrameOption.tsx` — ta emot `disabled`, sätt `pointer-events:none`, `opacity:0.45`, ingen ring/hover, och ingen `onClick`-utförande.
- Om aktuell vald variant blir otillgänglig efter storleksbyte: auto-välj första tillgängliga (gör i `editorStore` eller `FormatSection` via en effect).

## 2. Hängaren ska INTE täcka motivets topp/botten

Idag ligger `HangerOverlay` inuti motiv-rutan (`inset:0`) och ritar listerna med `top:0`/`bottom:0` ovanpå tryckytan → täcker motivet. Hängarens trälist ska sitta UTANFÖR posterns kant (uppe ovanför topp, nere under botten), precis som `mockup-composite.ts` gör (`overhang` utanför `posterW/H`).

**Var:** `src/components/editor/MapPreview.tsx` → `HangerOverlay`
- Behåll absolute-wrappern men skapa två separata lister positionerade `top: -slatH` och `bottom: -slatH` (utanför motivet).
- `MapPreview` måste tillåta att overlayn ritar utanför ramen: vrappern som håller `HangerOverlay` får `overflow: visible` (idag är wrappern redan `inset:0` med `overflow: visible`, men ramens stacking + `border` kan klippa — säkerställ att hängar-elementen ligger som syskon till `frameRef`-innehållet, INTE inuti border-boxen). Enklast: rendera `HangerOverlay` utanpå border via en wrapper-div runt `frameRef` (samma w/h, men med `overflow:visible`), eller ge `frameRef` en yttre container som hänger ut.

## 3. Hängarens tjocklek ska skalas mot storlek (live editor)

Gelato ger oss listbredd via UID (`229-mm`, `310-mm`, `410-mm`, `510-mm`, `710-mm`, `1010-mm`) och fast tjocklek `w14×t20-mm` (14 mm fram, 20 mm djup). I praktiken är listens fysiska höjd ~14 mm oberoende av posterstorlek — så på en 70×100 ska den se betydligt smalare ut (relativt sett) än på en 21×30.

**Var:** `src/components/editor/MapPreview.tsx` → `HangerOverlay`
- Ändra signatur: `HangerOverlay({ color, sizeCm, orientation })`.
- Räkna ut listhöjd i procent av motivets höjd:
  `slatPct = (1.4 / motifHeightCm) * 100` (1.4 cm = 14 mm).
- Använd `slatPct` istället för dagens fasta `3.2%`.
- Skala även snörets båghöjd, listens overhang och skuggor mot `slatPct` så att proportionerna stämmer.

## 4. Hängare i mockup-preview ser oproportionerligt smala ut

`mockup-composite.ts` använder `slatH = max(3, (0.6 / referenceWidthCm) * area.w)` → 0.6 cm är fel referens (verklig list är 1.4 cm). Det förklarar varför listerna ser för smala ut.

**Var:** `src/lib/mockup-composite.ts`
- Byt `0.6` → `1.4` i `slatH`-formeln.
- Justera `cordRise` till t.ex. `max(slatH * 1.4, (1.6 / scene.referenceWidthCm) * area.w)` så bågen håller proportion.
- Verifiera att `overhang` (just nu `slatH * 0.25`) ser bra ut visuellt — annars höj till `slatH * 0.4`.

## Test efter implementation

1. Öppna live-editor 13×18 → hängar-rutorna syns men är gråa, ej klickbara, text "Ej tillgänglig för denna storlek".
2. Välj 21×30 + Hängare Ek → listen ligger UTANFÖR motivets topp och botten, motivet syns helt.
3. Växla 21×30 → 70×100 → listens relativa tjocklek minskar tydligt.
4. Mockup-galleriet (vardagsrum/sovrum/kontor/vägg) → hängar-listen ser tjockare och mer trovärdig ut.

## Out of scope
- Inga ändringar i pricing/SKU-map (den är redan klar).
- Inga ändringar för canvas/aluminium/akryl.
