## Mål
1. Eliminera intern scroll i editor-iframen så att hela `.editor-root` rapporterar sin sanna höjd via `EDITOR_RESIZE`.
2. Återställ full bredd-layout (nav-rail längst till vänster, preview tar allt övrigt utrymme) — ta bort centreringen som infördes förra varvet.

## Ändringar

### `src/components/editor/EditorShell.tsx`
- **Rot-containern**: ta bort `mx-auto w-full max-w-[1400px]`. Behåll `editor-root flex flex-col`. Detta gör att nav-rail åter ligger längst till vänster och preview-arean fyller hela återstående bredd (viktigt för landskaps-posters).
- **`<aside className="section-panel ...">`**: säkerställ att ingen `overflow-y-auto` finns. (Aktuell kod har det inte — verifiera och håll det så.) Behåll `min-h-0`.
- **Mobil preview-wrapper**: inga `h-[60vh]` / `min-h-[70vh]` / `h-screen` får finnas i trädet. Verifiera att endast naturliga höjder används.

### `src/pages/EditorPage.tsx`
- **Loading-vyn** (`min-h-[400px] flex items-center justify-center`): redan korrekt, lämna orörd.
- **Yttersta `<div className="flex flex-col bg-background">`**: redan utan `min-h-screen`. Lämna orörd.

### `src/components/editor/MapPreview.tsx`
- Lämnas orörd. Den dynamiska höjden via `ResizeObserver` på `.preview-area` fungerar redan utan vh-höjder.

## Varför det löser problemen
- Utan `max-w-[1400px] mx-auto` återställs den tidigare layouten: nav-rail vänsterställd, panel intill, preview fyller resten — landskap blir lika stort som porträtt.
- Inga `overflow-*-auto` eller `*vh`-höjder i editor-trädet innebär att `.editor-root` växer fritt med innehållet. `ResizeObserver` rapporterar då rätt höjd vid varje flikbyte, och Shopify-sidan sätter iframens höjd därefter — ingen intern scroll, inget tomrum.

## Verifiering
- `window.addEventListener('message', e => e.data?.type==='EDITOR_RESIZE' && console.log('H:', e.data.height))` ska logga olika värden vid flikbyte.
- Ingen scrollbar inuti panelen i någon flik.
- Nav-rail visuellt längst till vänster på desktop; preview-arean fyller all återstående bredd.
