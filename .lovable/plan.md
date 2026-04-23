

## Mellansteg: Separera fotolager från kartlager + dölj flikar baserat på faktiska lager

### Problemet idag

1. När kunden laddar upp ett foto i "Bild"-fliken renderas det **inom kartlagrens form** (cirkel/hjärta/stjärna) via `photoOverlayUrl` i `MapPreview`. Detta kapar kartans visningsyta och blandar samman foto-flödet med det redan färdiga kart-flödet.
2. "Bild"-fliken visas så fort mallen har minst ett **kart**-lager — inte när det finns ett dedikerat fotolager.
3. AI-stilar har en egen accordion-sektion istället för att smältas in under "Bild" när foto är uppladdat.
4. "Plats"/"Kartstil"/"Text"-flikarna visas alltid om motsvarande lager-typ finns — det är redan rätt logik, men vi formaliserar regeln.

### Lösning — i ett svep

Inför en ny lager-typ **`photo`** som admin kan lägga till (knapp uppe till höger i designytan, bredvid "Lägg till karta" och "Lägg till text"). Foto-uppladdning på kundsidan blir då bunden till det lagret och rör aldrig kartlagren.

---

### 1. Schema: ny `photo`-layer-typ

`src/lib/template-schema.ts`:
- Ny `photoDefaultsSchema`:
  ```
  { shape: z.enum(["rect","circle","heart","star"]), fit: imageFitSchema (cover|contain), placeholderUrl?: string }
  ```
- Ny `photoLayerSchema = layerBase.extend({ type: "photo", defaults: photoDefaultsSchema })`.
- Lägg till i `layerSchema` discriminated union.
- `LayerType` får `"photo"` automatiskt.

### 2. Layer factory + admin-UI

`src/lib/layer-utils.ts`:
- `createLayer("photo", existing)` → 60×60% i mitten, default `shape: "rect"`, `fit: "cover"`, `name: "Foto N"`, `locks: defaultLocks({ content: false, shape: false })`.

`src/pages/admin/DesignerPage.tsx`:
- Ny knapp **"Lägg till bild"** med `Image`-ikon (lucide) i tool-paletten, anropar `addLayer("photo")`.

`src/components/admin/LayerList.tsx`:
- `typeLabel.photo = "Bild"`.

`src/components/admin/LayerInspector.tsx`:
- Ny inspector-sektion för foto-lagret: form-väljare (Rektangel/Cirkel/Hjärta/Stjärna), fit (cover/contain), valfri placeholder-bild-URL (för admin-preview när inget kund-foto finns).

### 3. Render foto-lager i admin- & kund-canvas

**Admin** (`src/components/admin/LayerCanvas.tsx` + `MapLayerPreview` finns redan, vi behöver foto-preview):
- I `renderLayerContent`: ny `case "photo"` som visar `placeholderUrl` (eller en streckad ruta med "📷 Bildplats") clippad enligt `defaults.shape`.

**Kund** (`src/components/editor/MapPreview.tsx`):
- I layer-loopen: ny `if (l.type === "photo")` gren.
- Hämtar `photoOverlayUrl` från store (samma `photoPreviewUrl`/`aiPrintFileUrl`-logik som idag, men **bara** för foto-lager).
- Renderar `<img>` clippad till lagrets form. Om inget foto finns: visar streckad placeholder med ikon + "Ladda upp en bild".
- **Tar bort** `photoOverlayUrl`-grenen från `case "map"` så kartlager återigen alltid renderar Mapbox (eller AI-stilad **karta** i framtiden, men aldrig fotot).

### 4. Snapshot-pipeline

`src/lib/template-snapshot.ts`:
- Ny `case "photo"` i layer-rendreringen: rita fotot (eller AI-resultatet) clippad till formen via Path2D (samma `clipForShape`-mönster som map). Om inget foto: hoppa över (lämna tom yta).
- Tar bort fallback i `case "map"` som idag ritar foto i kartans form.

`src/lib/print-pipeline.ts`:
- Foto/AI-källa kräver nu att mallen har minst ett `photo`-lager. Om inte: kasta tydligt fel "Mallen saknar bildplats — be admin lägga till ett bildlager."

### 5. ControlPanel: dölj flikar baserat på lager

`src/components/editor/ControlPanel.tsx`:
- Ny härledning: `photoLayers = layers.filter(l => l.type === "photo")`.
- `showImageSection = photoLayers.length > 0` (tidigare `mapLayers.length > 0`).
- "Plats"-fliken: oförändrad (`editableMaps.length > 0`).
- "Kartstil"-fliken: oförändrad (`editableMaps.length > 0`).
- "Text"-fliken: oförändrad (`editableTexts.length > 0`).
- "Format"-fliken: alltid synlig.

### 6. Slå ihop AI-stilar med Bild-fliken

`src/components/editor/ControlPanel.tsx`:
- Ta bort separat `<AccordionItem value="ai-stil">`.
- Inuti "Bild"-sektionens `<AccordionContent>`:
  ```
  <PhotoUploadSection />
  {photoFile && aiStyles.length > 0 && (
    <div className="mt-4 pt-4 border-t">
      <Label>AI-stil</Label>
      <AiStyleSection presets={aiStyles} />
    </div>
  )}
  ```
- AI-grid syns alltså **endast** när foto är uppladdat — exakt vad du efterfrågade.

### 7. Migration för befintliga mallar

`src/lib/template-migrate.ts`:
- Ingen tvångsmigrering — befintliga publicerade mallar (Personlig karta poster/canvas) saknar foto-lager och kommer helt enkelt inte visa "Bild"-fliken på kundsidan. Det är korrekt beteende: foto-flödet kräver att admin aktivt lägger till ett bildlager. Ingen visuell regression på kart-only-mallar.
- Befintliga `image`-lager (om några) påverkas inte — de är en annan typ (statisk admin-bild).

---

### Filer

| Fil | Ändring |
|---|---|
| `src/lib/template-schema.ts` | `photoLayerSchema` + union-tillägg |
| `src/lib/layer-utils.ts` | `createLayer("photo", …)` factory |
| `src/pages/admin/DesignerPage.tsx` | "Lägg till bild"-knapp |
| `src/components/admin/LayerList.tsx` | `typeLabel.photo = "Bild"` |
| `src/components/admin/LayerInspector.tsx` | Foto-inspector (form/fit/placeholder) |
| `src/components/admin/LayerCanvas.tsx` | Foto-preview i admin-canvas |
| `src/components/editor/MapPreview.tsx` | Render `photo`-lager; ta bort foto från `map`-grenen |
| `src/components/editor/ControlPanel.tsx` | Visa Bild-fliken bara vid `photo`-lager; AI inuti Bild-fliken |
| `src/lib/template-snapshot.ts` | `case "photo"` i snapshot; bort foto från `map` |
| `src/lib/print-pipeline.ts` | Felmeddelande om foto-källa utan foto-lager |

### Verifiering

1. Admin: ny "Lägg till bild"-knapp lägger till en bildplats — separata kartlager påverkas inte.
2. Mall med karta + bildlager + text på kundsidan: alla tre flikar visas. Kart-only-mall: bara Plats/Kartstil/Text.
3. Kund laddar upp foto → fotot hamnar i bildlagret, kartorna kvarstår orörda.
4. AI-stil-grid syns först efter att foto laddats upp, inuti "Bild"-fliken.
5. Befintliga single-map-mallar utan bildlager fungerar exakt som tidigare — ingen "Bild"-flik visas.
6. Tryckfilen för photo/AI-källa renderar fotot i bildlagrets form (inte kartans).

### Direkt efter detta

Tillbaka till **Fas 2**: Steg 3 (Gelato Mockup API), Steg 4 (3D-polish), Steg 6 (admin order-status).

