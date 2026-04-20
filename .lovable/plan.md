

## Plan: Pixelidentisk preview + Three.js 3D-canvas

### Problem
1. **Mockup speglar inte editor exakt**: Mapbox Static API kan inte stänga av etiketter via parameter (vi skickar bara `showLabels` men använder inte den i URL:en — vi måste byta style-id). Områdesnamn (text) och bakgrundsfärg uppdaterar dock korrekt — felet är att previewens *form* (square/circle clipping) appliceras på `drawW`-rektangeln (inte på poster-rectangeln) → ger fel layout när poster är portrait och form är square.
2. **Textstorlek**: Edge function använder `min(w,h) * 0.045` med fixed line-height. Editorn använder `text-sm md:text-base lg:text-lg` som blir mycket mindre relativt poster-bredden. Resultat: text ser ~2× större ut i mockupen.
3. **Canvas-mockups är fejk-3D**: Nuvarande `mockup-composite.ts` försöker fejka wrap med 2D-skew + sampling av yttre 3% pixlar i en mockup-miljö. Det blir aldrig övertygande.

### Lösning

**1. Fixa mapShape-clipping i print-fil**
Klippa kartan korrekt: square/circle ska clippa till en kvadrat som hugger den kortare poster-sidan, centrerad i poster-rektangeln — inte mot `drawW × drawH`. Skicka `showLabels=false` genom att byta till en no-labels variant av style (t.ex. `light-v11` → använd Mapbox styles utan labels via `setLayoutProperty` är inte möjligt i Static API; istället: använd parametern `&logo=false&attribution=false` och för "no labels" generera SVG som maskar etiketter — eller enklast: byt till alternativ tom style när `showLabels=false`. Konkret: använd Mapbox Static Tiles utan labels via tileset `mapbox.satellite`/etc, eller acceptera Static API-begränsning och dokumentera). Praktisk lösning: tillhandahålla en parallell "clean"-style-id mappning (`light-v11` → custom style utan labels) — eller rendera en vit overlay på ytterkanten. **Beslut**: Vi gör en enkel mapping: när `showLabels=false`, lägg till `&setfilter=...` är ej möjligt → istället döljer vi etiketter genom att overlaya samma `posterBgColor` med låg opacitet enligt en heuristik. **Bättre**: Skapa custom Mapbox styles utan symbols och mappa client-side, men det kräver Mapbox-konto. **Praktiskt**: dokumentera begränsningen och prioritera resten.

**2. Matcha textstorlek med editor**
Editor renderar text vid ~`16-18px` på en preview ~400px bred = ~4% av bredden. Edge function använder 4.5%. Justera till **3.5%** + lägre font-weight + samma `letter-spacing: 0.05em` och placera vid `y = 88%` av höjden (matchar `top: ~85%` i editor-layout). Använd faktisk layout-y från `currentLayout()` istället för hårdkodat `0.86`.

**3. Ersätt canvas-mockups helt med Three.js 3D-render**
Slopa `mockup-composite.ts` för canvas. Bygg ny komponent `Canvas3DPreview.tsx`:

- **Three.js scen** med en `BoxGeometry` där:
  - Front-face = print-bilden (texture)
  - 4 sido-faces = de yttersta 3% av print-bilden samplade via UV-mapping (riktig wrap-simulering, inte fejk skew)
  - Djup styrs av `canvasDepthCm` (2 eller 4cm → proportionell mot bredd)
- **Miljö**: enkel ljus vägg-bakgrund (CSS gradient) + soft shadow under canvas
- **Interaktion**: OrbitControls med begränsad rotation (±25° yaw, ±10° pitch), auto-rotate på idle
- **Lightbox**: samma 3D-scen i större format med fri rotation
- 4 förinställda kameravinklar = 4 "scener" (front, vänster-diagonal, höger-diagonal, närbild) — men alla är samma 3D-objekt, bara olika kameraposition. Snabbt, sant 3D, ingen mockup-bild behövs.

Poster behåller nuvarande mockup-flöde (det fungerar bra i miljöbilder).

### Arkitektur
```
MockupGallery
├── if product_type === "poster" → nuvarande compositeMockup() i scen
└── if product_type === "canvas" → <Canvas3DPreview /> (Three.js, 4 vinklar)
```

### Filer som ändras
- `supabase/functions/generate-print-file/index.ts` — fixa shape-clipping mot poster-rect, justera font-size till 3.5%, använd layout-y från frontend (skicka med i body)
- `src/components/editor/MockupGallery.tsx` — splitta render: poster vs canvas
- `src/components/editor/Canvas3DPreview.tsx` — **NY**: Three.js-scen, 4 förinställda vinklar, lightbox med OrbitControls
- `package.json` — lägg till `three` + `@react-three/fiber` + `@react-three/drei`

### Förväntat resultat
- Text i mockup matchar editorns proportioner (inte längre ~2× för stor)
- Mapshape (square/circle) klipper korrekt även när poster är rektangulär
- Canvas visar **äkta 3D** med riktig wrap, fri rotation i lightbox, ingen "platt poster med skugg-strip"

