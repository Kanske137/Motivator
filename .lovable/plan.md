

## Mellansteg: Kundredigering av fotolager — form + pan-inom-ram

Två tillägg till foto-flödet på kundsidan, speglar hur kartlagren redan fungerar.

---

### 1. Form-väljare under "Ladda upp bild"

I `ControlPanel.tsx`-sektionen "Bild", direkt under `<PhotoUploadSection />`:

- För varje `photo`-lager där `locks.shape === false`: visa en horisontell rad med fyra form-knappar (Rektangel / Cirkel / Hjärta / Stjärna), exakt samma visuella mönster som kartstil-knapparna i kartstil-fliken (ikon + label + aktiv border).
- Vid klick: skriv `layerValues[layerId].shape = "rect"|"circle"|"heart"|"star"` via `setLayerValue(layerId, { shape })`.
- Effektiv form vid render: `layerValues[id]?.shape ?? layer.defaults.shape` (samma resolve-mönster som kartlagren).
- Om mallen har flera fotolager med olåst form: visa en liten lager-namn-rubrik per lager (analog med multi-map-flödet i Plats-fliken).
- Om alla foto-lager har `locks.shape === true`: dölj hela form-sektionen.

### 2. Pan-inom-ram på fotolager

Idag ritas fotot med `object-fit: cover` utan offset → kunden kan inte välja vilken del som visas när bilden är beskuren av formen.

**State i `editorStore.ts`:**
- Utöka `LayerValue`-typen med `photoOffsetX?: number` och `photoOffsetY?: number` (procent-offset, default 0).
- Befintliga `setLayerValue`-helpern täcker write-pathen — ingen ny action behövs.

**Render i `MapPreview.tsx` (foto-grenen):**
- Byt ut det enkla `<img className="object-cover">` mot en wrapper med `overflow: hidden` + clip-path (form), och en inre `<img>` med:
  ```
  style={{
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `translate(${offsetX}%, ${offsetY}%)`,
    transform-origin: "center",
  }}
  ```
- Lägg på pointer-handlers (mousedown/move/up + touchstart/move/end) som beräknar delta i procent av lager-bredden/höjden och skriver `setLayerValue(layerId, { photoOffsetX, photoOffsetY })`. Clamp till `[-50, 50]` så bilden alltid täcker formen.
- `cursor: grab` / `grabbing` när drag pågår. Touch-action `none` under drag för att inte krocka med scroll.

**Render i snapshot-pipelinen (`template-snapshot.ts`, `drawPhotoLayer`):**
- Innan ritning: räkna offset-px från `photoOffsetX/Y` (procent av lager-bredd/höjd).
- Translate canvas-context med dessa innan `drawImage` så cart-thumbnail och tryckfilen visar exakt samma utsnitt som editorn.

**Reset:**
- När kunden laddar upp ett nytt foto eller tar bort fotot: nollställ `photoOffsetX/Y` på alla foto-lager (i `setPhotoSource` / `resetDesignSource`).

---

### Filer

| Fil | Ändring |
|---|---|
| `src/components/editor/ControlPanel.tsx` | Form-knapprad per foto-lager under `PhotoUploadSection` |
| `src/stores/editorStore.ts` | `photoOffsetX/Y` i `LayerValue`; nollställ vid byte/borttag av foto |
| `src/components/editor/MapPreview.tsx` | Drag-handlers + transform på `<img>` i foto-grenen |
| `src/lib/template-snapshot.ts` | Applicera offset i `drawPhotoLayer` |

### Verifiering

1. Mall med ett fotolager (form olåst) → "Bild"-fliken visar fyra form-knappar under uppladdaren. Aktiv form har border-ring.
2. Klick på "Hjärta" → fotot clippas till hjärtform i editorn omedelbart, kartlager opåverkade.
3. Drag på fotot inuti formen → utsnittet panar; släpp → utsnittet kvarstår.
4. Klick "Lägg i varukorg" → cart-thumbnail visar samma utsnitt som i editorn.
5. Tryckfilen som genereras till Gelato har samma utsnitt.
6. Mall där `locks.shape = true`: form-knapparna döljs, pan funkar fortfarande.
7. Ladda upp nytt foto → offset nollställs så det nya fotot startar centrerat.

