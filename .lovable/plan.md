## Plan

1. **Ta bort den fasta desktop-höjden**
   - Ändra `EditorShell.tsx` så `.editor-body` inte längre har `h-[720px]`, `xl:h-[820px]`, `h-full` eller annan fast höjd.
   - Sätt desktop-raden till `items-start` i stället för `items-stretch`, så kolumnerna inte sträcks till samma höjd.

2. **Ta bort intern scroll från section-panelen**
   - Ta bort `overflow-y-auto`, `h-full` och höjdbegränsningar från `.section-panel`.
   - Panelen får bli så hög som sitt innehåll kräver; iframe-höjden ska i stället växa via `EDITOR_RESIZE`.
   - Lämna mobilens Drawer-scroll orörd, eftersom den är en overlay/bottom-sheet och inte desktopens iframe-layout.

3. **Gör preview-ytan naturligt innehållsdriven**
   - Ta bort `h-full` från `.preview-area` på desktop.
   - Behåll flex-centrering runt själva postern, men utan att preview-kolumnen sträcks av den långa panelen.
   - Justera `MapPreview.tsx` bort från desktop-container-antagandet `DESKTOP_MAX_H = 720`, eftersom containern inte längre ska ha fast höjd.

4. **Gör höjdrapporteringen robust och alltid aktiv**
   - Flytta bort lazy import-mönstret i `EditorPage.tsx` och importera `postEditorResize` direkt, så rapporteringen inte kan fördröjas/tystna via async import.
   - Installera `ResizeObserver` efter render med dubbel `requestAnimationFrame`, så `.editor-root` faktiskt finns när observern kopplas.
   - Låt observern lyssna på `.editor-root`, och rapportera även vid mount och debounced `window.resize`.
   - Behåll jitter-skyddet i `postEditorResize()` (`>1px` skillnad krävs), men säkerställ att den kan anropas vid varje höjdändring.

5. **Behåll manuell rapportering vid flikbyte**
   - `EditorShell.tsx` behåller en dubbel-RAF-effekt på `activeId`, så varje flikbyte explicit triggar `postEditorResize()` efter att flikens innehåll renderats.
   - `ResizeObserver` blir huvudskyddet för asynkrona höjdändringar, men flik-effekten ger tydlig deterministisk signal.

6. **Verifiering**
   - Sök igenom editorträdet efter `100vh`, `100dvh`, `h-screen`, `min-h-screen`, `h-dvh`, samt kvarvarande felaktig desktop-scroll/fasta höjdklasser i `EditorShell.tsx`.
   - Kontrollera att `.section-panel` inte längre har intern scroll och att `.editor-body` använder `items-start`.
   - Kontrollera att `ResizeObserver` kopplas efter att `.editor-root` finns och att `postEditorResize()` fortfarande mäter `.editor-root.getBoundingClientRect().height`.

## Teknisk målbild

```text
.editor-root        flex column; ingen height/max-height/overflow
  .editor-body      desktop: flex row; align-items:flex-start; naturlig höjd
    .nav-rail       naturlig höjd
    .section-panel  ingen intern scroll; växer med innehåll
    .preview-area   naturlig höjd; centrerar poster utan att sträckas
  .sticky-cta       shrink-0; inte fixed
```

Shopify-temat ändras inte.