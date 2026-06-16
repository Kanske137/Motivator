Ta bort "AI-bild" som valbar lagertyp i Skapa själv. Kunden kan inte styra AI-prompten, så detta lager ska aldrig kunna läggas till av kund.

## Ändringar

**`src/components/editor/LayersSection.tsx`**
- Ta bort `"aiPhoto"` ur `ADD_ORDER` så det inte visas i "Lägg till lager"-sheeten.
- Ta bort `aiPhoto`-raden ur `TYPE_META`.
- Justera `FreeformLayerType` (eller smal-typa lokalt) så TS godtar borttagningen.

**`src/lib/freeform-layers.ts`**
- Ta bort `"aiPhoto"` ur unionen `FreeformLayerType` och `case "aiPhoto"` ur `createFreeformLayer`. AI-fotolager kan fortfarande finnas i admin-mallar (template-schema är orört) — det är bara kund-skapandet som tas bort.

Inget annat påverkas: admin-låsta AI-lager i befintliga mallar fungerar precis som idag, i18n-nyckeln `layers.addAiPhoto` lämnas kvar (kostar inget) men referens borttas.

## Filer
- `src/components/editor/LayersSection.tsx`
- `src/lib/freeform-layers.ts`
