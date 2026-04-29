## Mål

Slå ihop kundeditorns två accordion-flikar **"Plats"** och **"Kartstil"** till en enda flik som heter **"Karta"**. Innehållet inom fliken visar först **plats**-sektionen (sök/vald plats) och därefter **kartstil**-sektionen (stilväljare, etiketter, zoom etc.) — i den ordningen.

När mallen har **flera kartlager** ska fliken "Karta" innehålla **underflikar** ("Karta 1", "Karta 2", …) där bara en underflik kan vara öppen åt gången. Varje underflik visar exakt samma layout (Plats-block överst, Kartstil-block under) fast för det specifika lagret.

## Beteende

- **Ett kartlager**: ingen underflik-rad visas — bara plats-blocket följt av kartstil-blocket direkt.
- **Flera kartlager**: en `Tabs`-rad högst upp inuti accordion-innehållet med en knapp per karta. Standardvald = första kartan. Endast en synlig åt gången. Lagernamnet (eller "Karta N") används som etikett, precis som idag.
- Förhandsvisningen påverkas inte; bara sidopanelens UI omorganiseras.
- Ingen logik i `editorStore`, `template-schema` eller snapshot-koden ändras.

## Tekniska detaljer

**Fil som ändras:** `src/components/editor/ControlPanel.tsx`

1. Ta bort de två separata `AccordionItem`-blocken med `value="plats"` och `value="kartstil"` (rad ~200–235).
2. Lägg till ett nytt `AccordionItem value="karta"` med rubrik **"Karta"** som standardöppen (`defaultValue="karta"` i `<Accordion>`).
3. Inuti `AccordionContent`:
   - Om `editableMaps.length === 1`: rendera `<PlaceLayerSection layer=... heading={null} />` följt av `<MapStyleLayerSection layer=... heading={null} />` för det lagret. Inga rubriker — accordion-titeln räcker.
   - Om `editableMaps.length > 1`: rendera en `<Tabs>` med `TabsList`/`TabsTrigger` (en per karta, etikett = `layer.name || "Karta N"`). Under flikraden visas plats- + kartstil-blocken för **endast** den valda kartan (lokal `useState` för aktiv karta, default = första lagrets id). Detta uppfyller kravet "endast en underflik öppen åt gången" utan att vi behöver `TabsContent` per lager — vi villkorsrenderar valt lager.
4. `PlaceLayerSection` och `MapStyleLayerSection` behåller nuvarande signatur. När de renderas inuti underflikarna skickar vi `heading={null}` eftersom underflik-namnet redan identifierar kartan.
5. Importera `Tabs`, `TabsList`, `TabsTrigger` från `@/components/ui/tabs` (samma mönster som `DesignerPage`).

## Edge cases

- Om ett kartlager läggs till/tas bort dynamiskt och nuvarande aktiva underflik försvinner: en liten `useEffect` återställer aktivt id till första tillgängliga karta.
- Default-värdet för accordion ändras från `"plats"` → `"karta"` så fliken är öppen vid sidladdning, exakt som idag.

## Filer som ändras

- `src/components/editor/ControlPanel.tsx` (enda filen)
