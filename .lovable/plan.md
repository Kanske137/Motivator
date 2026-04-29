# Plan: Canvas-design med wrap-zoner och separat layout

## Vad som ska byggas

### 1. Separat layout för canvas i template-schemat
Idag har `Template` ett `defaultLayout` (portrait + landscape) som delas mellan poster och canvas (samma sibling-mall propageras). Vi inför ett valfritt fält `canvasLayout` som speglar `defaultLayout` men är helt fristående. Poster fortsätter använda `defaultLayout` som idag.

### 2. Designyta i admin med wrap-zoner (endast för canvas)
När admin redigerar en canvas-produkt visualiseras designytan på samma sätt som kundeditorn:

```text
┌─────────────────────────────┐  ← hela editor-canvasen (front + 2× wrap)
│         WRAP (top)          │
│   ┌─────────────────────┐   │
│   │                     │   │
│   │       FRONT-zon     │   │  ← markerad med streckad ram + label
│   │   (synlig framsida) │   │
│   │                     │   │
│   └─────────────────────┘   │
│         WRAP (bottom)       │
└─────────────────────────────┘
```

Lager kan placeras var som helst i hela ytan (även ut i wrap-zonerna). Front-zonen markeras tydligt så admin ser var den synliga ytan slutar.

### 3. Procentuell auto-skalning vid djupändring
Lager-koordinater i canvasLayout lagras (precis som idag) i procent av HELA editor-ytan (front + wrap × 2). När admin byter djup i `productOptions.canvas` (t.ex. 2 cm → 4 cm) ändras editor-ytans aspect, men eftersom alla lager redan är i `%` av denna yta så förblir de relativt korrekt placerade automatiskt — exakt det beteende du beskrev (1 cm täckning på 2 cm djup = 50 % av wrap-bandet, blir 2 cm av 4 cm efter ändring).

För att detta ska gälla även i kundeditorn: kundeditorn använder redan samma %-system så samma layout fungerar 1:1.

## Tekniska detaljer

### Schema-ändringar (`src/lib/template-schema.ts`)
- Lägg till valfritt `canvasLayout: { portrait, landscape }` med samma form som `defaultLayout`.
- Lägg till `canvasDesignDepthCm` i `productOptions.canvas` (default = första värdet i `allowedDepths`, fallback 2). Anger vilket djup admin DESIGNAR mot. Lager-procenten är relativ till editor-ytan vid detta djup, vilket kunder sedan automatiskt skalas mot oavsett valt slutdjup.

### Migrering (`src/lib/template-migrate.ts`)
- Om `canvasLayout` saknas på en mall som har `productOptions.canvas.enabled = true` → seed:a den genom att djup-kopiera `defaultLayout` (admin får samma start som idag, kan därefter ändra fritt).

### Designsida (`src/pages/admin/DesignerPage.tsx`)
- Avgör `isCanvasProduct = config.product_type === "canvas"`.
- För canvas: läs/skriv `canvasLayout[orientation]` istället för `defaultLayout[orientation]`. För poster: oförändrat.
- Vid sibling-propagering: synka `canvasLayout` separat så poster-syskon inte skriver över det och vice versa.
- Lägg en liten infobar ovanför `LayerCanvas` som visar t.ex. "Canvas-design · djup 2 cm · grå zon = wrap" när canvas.

### LayerCanvas (`src/components/admin/LayerCanvas.tsx`)
- Ny prop `wrapInsetPct?: { x: number; y: number }` (0 för poster, beräknat för canvas).
- När `wrapInsetPct` är satt:
  - Aspect-ratio på editor-ytan beräknas från `(frontW + 2·wrap) × (frontH + 2·wrap)` istället för rena front-aspekten.
  - Rendera en streckad rektangel som markerar front-zonen (samma stil som kundeditorn) med liten label "Synlig framsida".
  - Rendera ljust skuggade band runt fronten för att tydligt visa wrap.
  - Snap-grid + alignment-guides justeras så centrum-snap fortfarande gäller hela ytan (önskat — admin vill ofta centrera mot hela canvas).

### Renderingsspeglar
- `MapPreview` i kundeditorn behöver ingen ändring — den hämtar redan `wrapCm` och behandlar layers som %-av-hela-ytan.
- `EditorPage`: när templaten har `canvasLayout`, läs lager från det istället för `defaultLayout` när `isCanvas`. Annars fall tillbaka till `defaultLayout` (bakåtkompatibelt).
- Snapshot/print-pipeline: ändra ingenting, samma %-koordinatsystem hela vägen.

### Sibling-spridning vid spara
- Poster-syskon: spara endast `defaultLayout` + delade fält (productOptions.aiStyles, mapStyles, allowedFonts). Behåll syskonets eget `canvasLayout` om det finns.
- Canvas-syskon: motsvarande omvänt.
- Båda behåller sin egen `productOptions.poster`/`canvas` (som idag).

## Vad som INTE ändras
- Kundeditorns rendering, AI-flöde, print-fil-generering, Shopify-sync.
- Poster-flödet i admin är oförändrat — ingen wrap-zon, inga nya kontroller.
- Default-djup för canvas i kundeditorn (`wrapCm: 2`) — bytet av valt djup i kundeditorn använder fortfarande %-skalning.

## Filer som rörs
- `src/lib/template-schema.ts` — nya fält
- `src/lib/template-migrate.ts` — seeda canvasLayout
- `src/pages/admin/DesignerPage.tsx` — välj rätt layout, sibling-logik
- `src/components/admin/LayerCanvas.tsx` — wrap-zon + front-markering
- `src/pages/EditorPage.tsx` — välj canvasLayout när tillgängligt
- (ev.) `src/lib/editor-snapshot.ts` / `template-snapshot.ts` om de läser `defaultLayout` direkt — kontrolleras vid implementation
