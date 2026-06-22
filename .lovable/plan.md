## Problem

Mobil-drawern öppnas alltid ~85% av synliga ytan, oavsett hur lite innehåll fliken har. Resultat: stora tomma områden under det faktiska innehållet, och man måste ändå scrolla i vissa flikar.

Orsak i `EditorShell.tsx`:
- Inre scrollcontainern har `flex-1` ⇒ tar all kvarvarande höjd upp till `maxHeight`
- `maxHeight` är hårdkodad till `visibleHeight * 0.85`
- Det finns ingen "shrink-to-content"-logik

## Lösning (rekommenderad): Innehållsdriven höjd + snap points

Vauls inbyggda `snapPoints` är state-of-the-art för mobila bottom sheets (Apple Maps, Spotify, Notion m.fl. använder samma mönster). Drawer öppnas på "lagom" höjd och kan dras upp till full höjd om kunden vill.

### Ändringar i `src/components/editor/EditorShell.tsx`

1. **Ta bort `flex-1` och `min-h-0`** från inre scroll-divern. Behåll `overflow-y-auto` + `overscrollBehavior: contain` — då växer drawern bara till innehållets höjd, upp till `maxHeight`.

2. **Lägg till snap points** på `Drawer`:
   ```tsx
   const [snap, setSnap] = useState<number | string | null>("content");
   <Drawer
     open={...}
     snapPoints={["content", 0.95]}
     activeSnapPoint={snap}
     setActiveSnapPoint={setSnap}
   >
   ```
   - Första snap = `"content"` → exakt innehållets höjd (Vaul mäter automatiskt)
   - Andra snap = `0.95` → nästan full höjd (för långa flikar som "Text"/"Lager")
   - Användaren kan dra handtaget uppåt för att expandera

3. **Återställ snap** till `"content"` varje gång drawern öppnas, så varje flikbyte startar kompakt:
   ```tsx
   useEffect(() => { if (mobileOpen) setSnap("content"); }, [mobileOpen, activeId]);
   ```

4. **Behåll ankringen** till `visibleTop`/`visibleHeight` från `useParentViewport` så drawern fortsatt placeras inom mobilens synliga del av iframen. `maxHeight` blir taket för snap `0.95`.

5. **Inget annat ändras** — `Drawer`/`DrawerContent` (vaul) stödjer redan snap points; ingen ny dependency, inga ändringar i Shopify-snippet, ingen ändring i desktop-layout, ingen ändring i affärslogik.

### Resultat
- Korta flikar (t.ex. "Format", "Stil") → drawer = exakt innehållshöjd, ingen tom yta.
- Långa flikar → drawer öppnas på innehållshöjd (eller `maxHeight`-tak) och kan dras upp till 95% med ett enda drag i handtaget.
- Drawerns scrollyta fungerar fortsatt oberoende av iframens scroll (`overscroll-behavior: contain`).

## Alternativ (om du föredrar enklare)

**A. Alltid full höjd:** Sätt `top = visibleTop + 40`, `height = visibleHeight - 40`. Enkelt, men korta flikar får ändå tom yta längst ner.

**B. Endast innehållsdriven (utan snap):** Bara steg 1 ovan. Inga snap points, ingen drag-att-expandera — drawer = innehållshöjd upp till 85%-taket. Enklare, men långa flikar kräver intern scroll direkt.

Min rekommendation är huvudplanen (snap points) — det är mönstret moderna native-appar använder och löser båda fallen på en gång.