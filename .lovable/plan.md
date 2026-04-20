

## Plan: Snapshot ska rendera identiskt med editorn

### Grundorsak

`editor-snapshot.ts` skiljer sig från `MapPreview` på tre punkter som tillsammans ger förvrängd form, fel kartinnehåll och för stor text i förhandsvisningen:

1. **Mapbox renderas i fel container-form**
   Editorn lägger kartan i en 1:1 wrapper när formen är `square`/`circle`. Snapshoten renderar alltid Mapbox i hela poster-rektangeln (t.ex. 720×1008 stående) och ritar sedan in den portrait-canvas i en kvadratisk clip. Resultat: kartinnehållet squishas vertikalt → cirkeln ser stretchad ut, kvadraten visar fel utsnitt.

2. **Texten är ~30% för stor och felplacerad**
   Snapshoten använder `w * 0.04` med `+ fontSize * 0.85` Y-offset. Editorn använder Tailwinds `text-sm md:text-base lg:text-lg` (~2.8% av previewbredden) centrerad via `translate(-50%,-50%)`.

3. **Ingen letter-spacing/leading-paritet**
   Editorn har `tracking-wide` (~0.05em) och `leading-tight` (~1.15). Snapshoten kör 1.2 utan tracking.

### Lösning

**`src/lib/editor-snapshot.ts`:**

- **Map-container per form:**
  - `rect` → Mapbox renderas i `w × h` (oförändrat).
  - `square`/`circle` → Mapbox renderas i `sq × sq` där `sq = min(w, h)`. Inget squishas eftersom källcanvasen redan är kvadratisk.
- **Kompositering:**
  - `rect` → `drawImage(map, 0, 0, w, h)`.
  - `square`/`circle` → `drawImage(map, (w-sq)/2, (h-sq)/2, sq, sq)`. Cirkel-clip blir sann cirkel runt sant kvadratiskt innehåll.
- **Text:**
  - `fontSize = round(w * 0.028)`
  - `lineHeight = round(fontSize * 1.15)`
  - `ctx.textBaseline = "middle"`, centrera blocket kring `h * yFrac` (ta bort `+ fontSize * 0.85`).
  - `ctx.font = '500 ${fontSize}px ${textFont}'` (matchar `font-medium`).
  - Approximera `tracking-wide` genom att rita tecken för tecken med `~fontSize*0.05` extra spacing per tecken (eller acceptera utan om visuellt OK; testa först utan).

### Filer som ändras
- `src/lib/editor-snapshot.ts` — map-container per form, ren centrering, ny font-skala/baseline.

### Förväntat resultat
- Cirkel = sann cirkel, inget vertikalt squish.
- Kvadrat = sann kvadrat med rätt kartutsnitt.
- Text matchar editorns storlek och position.
- Canvas 3D ärver fixarna automatiskt eftersom den använder samma snapshot.

