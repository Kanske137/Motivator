## Mål

När en mall har **fler än en `photo`-layer** ska kunden kunna ladda upp **olika bilder per behållare** — och välja form + AI-stil per behållare. Idag delas en enda `photoFile` mellan alla photo-layers, så samma bild dyker upp överallt.

När mallen bara har **en photo-layer** ska beteendet vara oförändrat (ingen flik-rad).

---

## Ny UX i bild-collapsiblet (kundsidan)

- 1 photo-layer → identiskt med idag: PhotoUploadSection + (valbar) form + AI-stil.
- ≥2 photo-layers → en `Tabs`-rad högst upp med en flik per layer:
  - Etikett: `layer.name` om satt, annars `t("layer.imageTab", { n })` ("Foto 1", "Foto 2", …).
  - Per flik: `PhotoUploadSection` (för **denna** layer), formväljare (om upplåst), och `AiStyleSection` (om AI-stilar är aktiverade och bild finns för denna layer).
  - Visuell indikator i fliken om bild är uppladdad (liten prick).

Inga ändringar i admin-editorn, kart-/text-sektionerna, eller i översättningsbeteendet (alla nya strängar via i18n-nycklar i `sv.json` + översatta till övriga språk).

---

## Datamodell (editorStore)

Ersätt globala fält med per-layer maps keyade på `photoLayerId`:

| Idag (globalt)            | Nytt (per layer-id)                     |
| -------------------------- | --------------------------------------- |
| `photoFile: File \| null` | `photoSources: Record<id, { file, previewUrl, hash, originalUrl }>` |
| `photoPreviewUrl`          | (i `photoSources[id].previewUrl`)       |
| `photoHash`                | (i `photoSources[id].hash`)             |
| `originalPhotoUrl`         | (i `photoSources[id].originalUrl`)      |
| `aiPrintFileUrl`           | `photoAiResults: Record<id, string>` (aktiv stil per layer) |
| `designSource: "map"\|"photo"\|"ai"` | Blir **härledd**: om någon photo-layer har källa → "photo"/"ai"; annars "map". Behålls som global för cart/print-payload-bakåtkompatibilitet. |

`aiResultCache` (LRU) byter nyckel från `${photoHash}|${presetId}` till samma — keyas fortfarande på hashen, men hashen är nu per layer. Ingen schemaändring för cachen.

Nya/uppdaterade setters:
- `setPhotoSource(layerId, file, previewUrl)`
- `setPhotoHash(layerId, hash)`
- `setOriginalPhotoUrl(layerId, url)`
- `setAiPrintFileUrl(layerId, url)`
- `clearAiResultOnly(layerId)`
- `resetPhotoLayer(layerId)` (ersätter `resetDesignSource` per-layer; global `resetDesignSource` rensar alla)

Bakåt-kompatibla "legacy"-getters för `photoFile`, `photoPreviewUrl`, `aiPrintFileUrl` behålls och returnerar **första photo-layern** så att äldre konsumenter (cart-payload, mockup, snapshot) fortsätter funka medan vi migrerar dem.

---

## Render-pipeline (per-layer källa)

**`MapPreview.tsx`** — byt `photoOverlayUrl` (global) mot per-layer-uppslag inne i photo-loopen:

```ts
const src = photoAiResults[l.id] ?? photoSources[l.id]?.previewUrl ?? l.defaults.placeholderUrl ?? null;
```

**`template-snapshot.ts`** — `photoOverlayUrl?: string` → ersätts av `photoOverlays?: Record<layerId, string>`. I `photo`-grenen: `const url = input.photoOverlays?.[layer.id] ?? layer.defaults.placeholderUrl;`. Bakåtkompat: om bara `photoOverlayUrl` (legacy) skickas, mappa till alla photo-layers.

**`MockupGallery.tsx`** och **`EditorPage.tsx` (cart payload)** — bygg `photoOverlays`-map från `photoSources` + `photoAiResults` (AI vinner per layer) och skicka in.

---

## Komponentändringar

- **`PhotoUploadSection`** → tar `layerId: string` prop. All läsning/skrivning går via per-layer-setters. Defaultvärde `firstPhotoLayerId` om ingen prop ges (bakåtkompat).
- **`AiStyleSection`** → tar `layerId: string` prop. `photoFile/photoHash/originalPhotoUrl/aiPrintFileUrl` läses/skrivs per layer. Cache-anrop oförändrade (hash är fortfarande nyckel).
- **`ControlPanel.tsx`** (Bild-accordion-sektionen) — om `photoLayers.length > 1`: rendera `Tabs` med en `TabsTrigger` per layer + en `TabsContent` med `PhotoUploadSection`, `PhotoShapeSection` och `AiStyleSection` för aktiv layer-id. Annars samma rendering som idag (med första layer-id som prop).

---

## i18n-nycklar (sv.json + översättningar till en/de/no/da/fi/fr/es/it/nl/pl)

- `layer.imageTab` ("Foto {{n}}") — finns redan i mönstret för `layer.transformationTab`.
- Inga andra nya strängar; befintliga `photo.*` och `shape.*` återanvänds.

---

## Ej i scope

- Ingen ändring av admin-editorn, ingen ändring av Gelato print-pipeline-API:t (utöver att den nu får `photoOverlays`-map istället för en enda URL).
- Ingen ändring av `aiPhoto`-layers (face-swap) — de är redan per-layer.
- Ingen migration av sparat kund-state (state lever bara i sessionen).

---

## Berörda filer

- `src/stores/editorStore.ts` (datamodell + setters + legacy-mirrors)
- `src/components/editor/PhotoUploadSection.tsx` (ta `layerId` prop)
- `src/components/editor/AiStyleSection.tsx` (ta `layerId` prop)
- `src/components/editor/ControlPanel.tsx` (Tabs i Bild-sektionen)
- `src/components/editor/MapPreview.tsx` (per-layer src)
- `src/components/editor/MockupGallery.tsx` (per-layer overlays)
- `src/pages/EditorPage.tsx` (cart-payload bygger `photoOverlays`)
- `src/lib/template-snapshot.ts` (input: `photoOverlays` map)
- `src/i18n/locales/*.json` (verifiera `layer.imageTab` finns på alla språk)
