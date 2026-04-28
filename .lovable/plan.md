## Problem

För `aiPhoto`-lager (särskilt nya "Ta bort bakgrund"-läget) syns inte den genererade bilden i:
- 3D-canvas-förhandsvisningen
- Mockup-galleriet (poster-scener)
- Cart-thumbnail/printfil i vissa fall
- Tom/ful platshållare i poster-preview innan kunden genererat

**Rotorsak**: `MockupGallery.tsx` (som driver både scen-mockups OCH 3D-canvas) skickar inte `aiPhotoResults` till `renderTemplateSnapshot`, och har inte heller `aiPhotoResults` i sin `useEffect`-deps. När kunden klickar "Skapa nu" och `aiPhotoResults` uppdateras → snapshoten ritas aldrig om → mockup + 3D visar fortfarande den tomma bakgrunden.

`MapPreview` (poster-preview) läser visserligen `aiPhotoResults` reaktivt men för `removeBackground`-läget finns ingen `referenceImageUrl` heller, så innan generering är hela ytan tom utan tydlig instruktion.

## Åtgärder

### 1. `src/components/editor/MockupGallery.tsx`
- Hämta `aiPhotoResults` från store.
- Skicka med `aiPhotoResults` i `renderTemplateSnapshot`-anropet.
- Lägg till `aiPhotoResults` i `useEffect`-deps så snapshoten regenereras direkt när AI-bilden blir klar (debouncad 600 ms är OK).

### 2. `src/components/editor/MapPreview.tsx` (poster-preview, kund)
- För `aiPhoto`-lager utan src (varken result eller `referenceImageUrl`): visa en tydlig dashed platshållare med ✨-ikon och text "AI-bild visas här efter Skapa nu" — istället för helt tom yta.
- Behåll befintlig logik när src finns.

### 3. `src/components/admin/LayerCanvas.tsx` & `TemplateThumbnail.tsx`
- För `aiPhoto`-lager med `subjectKind === "removeBackground"`: gör platshållartexten mer beskrivande ("✨ AI-bild (bakgrund tas bort)") så admin förstår att avsaknad av referensbild är förväntat.

### 4. Verifiera printfil/cart-flödet
- `EditorPage.tsx` skickar redan `aiPhotoResults` till `renderTemplateSnapshot`/`getPrintFileUrl`. Inget att ändra här.
- `template-snapshot.ts` läser redan `input.aiPhotoResults?.[layer.id] ?? layer.defaults.referenceImageUrl`. Inget att ändra.
- `print-pipeline.ts` kräver bara photo-layer för `source: "photo" | "ai"`. För `aiPhoto`-only mallar är `designSource === "map"` och kontrollen hoppas korrekt. Inget att ändra.

## Tekniskt

```ts
// MockupGallery.tsx — diff
const {
  // ...
  designSource, photoPreviewUrl, aiPrintFileUrl,
+ aiPhotoResults,
} = useEditorStore();

await renderTemplateSnapshot({
  // ...existing fields
  photoOverlayUrl: /* ... */,
+ aiPhotoResults,
});

useEffect(() => { /* ... */ }, [
  /* ...existing deps */,
  designSource, photoPreviewUrl, aiPrintFileUrl,
+ aiPhotoResults,
]);
```

```tsx
// MapPreview.tsx (aiPhoto-block) — om src är null:
{!src ? (
  <div className="w-full h-full flex flex-col items-center justify-center
                  bg-accent/30 border-2 border-dashed border-primary/40
                  rounded text-center px-2 gap-1">
    <Sparkles className="h-5 w-5 text-primary/70" />
    <span className="text-[10px] text-muted-foreground">
      AI-bild visas här
    </span>
  </div>
) : (
  <PhotoLayerView ... />
)}
```

## Filer som kommer ändras
- `src/components/editor/MockupGallery.tsx` (huvudfix — 3D + scen-mockups)
- `src/components/editor/MapPreview.tsx` (snyggare placeholder pre-generation)
- `src/components/admin/LayerCanvas.tsx` (klarare admin-platshållare för removeBackground)
- `src/components/admin/TemplateThumbnail.tsx` (samma)

Inga schema-, migration- eller edge-function-ändringar behövs.
