

## Mellansteg: Koppla in template-snapshot i preview, cart & print

### Problemet

Mockup-galleri, cart-thumbnail och Gelato-tryckfilen renderas fortfarande med gamla `renderArtworkSnapshot` som bara känner till **en** karta och **en** text via globala fält. Resultat på multi-lager-mallar:
- Bara första kartan visas, övriga försvinner.
- Bara första texten skrivs ut, andra texten saknas.
- Linjer, marginaler, bilder — ritas inte alls.
- Stjärna/hjärta-form klippes inte (legacy-renderaren har bara cirkel + död `square`/`rect`-kod).
- Cart-preview & print-filen lider av exakt samma fel.

`renderTemplateSnapshot` finns redan färdig i `src/lib/template-snapshot.ts` men är inte inkopplad någonstans.

### Lösning

Riv ut `renderArtworkSnapshot`-anropen från preview/cart/print-flödena och ersätt med `renderTemplateSnapshot` som tar `template` + `layerValues` direkt från store.

#### 1. `MockupGallery.tsx`
- Byt import från `editor-snapshot` → `template-snapshot`.
- Hämta `template` och `layerValues` ur `useEditorStore`.
- Anropa `renderTemplateSnapshot({ template, orientation, size, layerValues, livePosterBgColor: posterBgColor, wrapCm, bleedCm, ... })`.
- Behåll legacy `live*`-fälten i kallet (fyll med globala speglar) som backup för mallar utan layerValues.
- useEffect-deps: byt globala kart/text-fält mot `layerValues`-referensen + `template?.id`.

#### 2. `EditorPage.tsx` (cart-thumbnail)
- Samma byte: `renderArtworkSnapshot` → `renderTemplateSnapshot`.
- Bygg `baseTemplateInput` från `template` + `layerValues`.
- Behåll frame/canvasWrap-overlay-logiken — flytta in den i en liten lokal helper `applyFrameOverlay(dataUrl, opts)` (eller lägg som optional `frameColor`/`frameWidthCm`/`canvasWrap` i `TemplateSnapshotInput` och rita i `renderTemplateSnapshot` efter alla lager). Enklare alternativ: efter snapshot, dra bilden till en ny canvas + rita ramen där (samma kod som nu i `editor-snapshot.ts`).

#### 3. `print-pipeline.ts` (Gelato print-fil)
- `PrintPipelineArgs.mapInput` byts till `templateInput: TemplateSnapshotInput`.
- Ny `renderHiresTemplateSnapshotSafe(input)` i `template-snapshot.ts` (kopia av befintliga retry-loop, anropar `renderTemplateSnapshot` med `hires:true` + `maxPxOverride`).
- `getPrintFileUrl` source="map" → kalla nya safe-funktionen.

#### 4. `editor-snapshot.ts` — städning
- Markera `renderArtworkSnapshot` som deprecated (behåll filen tills inga referenser kvar) eller ta bort om inget kvar refererar.
- Tar bort död `square`-branch (vi hade redan sagt att rect/square inte finns).

#### 5. `editorStore.ts` — exponera vad pipelinen behöver
- Verifiera att `template` och `layerValues` redan returneras (det gör de). Lägg eventuellt en getter `templateSnapshotInput()` som bygger ihop allt som `MockupGallery`/`EditorPage` annars duplicerar.

#### 6. `LayerInspector.tsx` ref-warning fix (bonus, syns i konsolen)
Console varnar `Function components cannot be given refs` på `Field`-komponenten i `LayerInspector`. Wrappa `Field` i `React.forwardRef` så Radix `<Select>`/`<Input>` slipper varningen.

### Filer

| Fil | Ändring |
|---|---|
| `src/components/editor/MockupGallery.tsx` | Använd `renderTemplateSnapshot` + `layerValues` |
| `src/pages/EditorPage.tsx` | Cart-thumbnail via `renderTemplateSnapshot` |
| `src/lib/print-pipeline.ts` | Print-fil via ny `renderHiresTemplateSnapshotSafe` |
| `src/lib/template-snapshot.ts` | Ny `renderHiresTemplateSnapshotSafe` + valfri `frameColor`/`canvasWrap`-overlay |
| `src/lib/editor-snapshot.ts` | Deprecation-kommentar + ta bort death-code för `square` |
| `src/components/admin/LayerInspector.tsx` | `Field` i `forwardRef` (fixar React-warning) |

### Verifiering

1. Mall med 2 kartor + 2 texter: mockup-galleriet (poster) och 3D-canvas-preview visar BÅDA kartorna och BÅDA texterna i rätt position och form (cirkel/hjärta/stjärna).
2. Linjer + marginaler från mall syns i preview-bilden.
3. "Lägg i varukorg" → cart-thumbnail visar exakt samma layout som editorn.
4. Tryckfilen (uppladdad till `print-files`-bucket) öppnas i full upplösning och innehåller alla lager — kontrollera via Network-loggen efter add-to-cart.
5. Befintlig single-layer-poster fungerar oförändrat (ingen visuell regression).
6. React-warningen om `forwardRef` försvinner från konsolen.

### Direkt efter detta

Nu är vi äntligen redo för **Fas 2**: AI-stilar, riktiga Gelato-mockup-API-thumbnails istället för lokala composites, polish av 3D canvas-preview, och Shopify-cart-flödet end-to-end.

