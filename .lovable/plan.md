## Mål
Låta admin dra runt varje referensbild i sitt lager för att välja vilken del som syns (focal point). Kund ser samma utsnitt som admin valt, både på själva referensbilden och på det face-swappade resultatet (som har samma dimensioner). Inom bildens gränser (samma clamp som dagens pan).

## Ansats
Lägg till `focalX`/`focalY` (procent, -50 till +50, default 0) per item i `referenceImages[]`. Värdena tolkas exakt som dagens `offsetX/offsetY` på `photo`/`aiPhoto`-lager (procent av lagerboxen, 0 = centrerad cover). Ingen ny rendringspipeline behövs — `PhotoLayerView` har redan pan + clamp.

På kundsidan: när det aktiva källbildet i `aiPhoto`-grenen är referensbilden eller swap-resultatet (inte en kund-uppladdad bild), använd den valda referensens `focalX/focalY` istället för layer-värdets offset. Lås drag (samma som idag — `locks.move` styr).

## Filändringar

### 1. `src/lib/template-schema.ts`
- Utöka `referenceImages` item-objektet:
  ```ts
  { id, url, label?, focalX?: number /* -50..50 */, focalY?: number /* -50..50 */ }
  ```
  Defaults 0/0. Bakåtkompatibelt.

### 2. `src/components/admin/LayerInspector.tsx` (`AiPhotoDefaultsSection`)
- Byt ut den statiska `<img object-cover>`-thumben mot en kompakt drag-yta som återanvänder samma cover-pan-matematik som `PhotoLayerView`:
  - Mät containerstorlek + bildens naturalSize.
  - `maxX/maxY` = halv overflow i procent.
  - Pointer drag uppdaterar item-ets `focalX/focalY` (clampat).
- Liten "Återställ"-knapp (sätter focal till 0/0).
- Notis: "Dra för att välja synlig del" om bilden överflödar lagret.
- Skicka uppdaterad lista via `updateDefaults({ referenceImages: nextList, referenceImageUrl: syncLegacy(nextList) })`. Legacy-sync oförändrad (förste itemets URL).

### 3. `src/components/editor/MapPreview.tsx` (`aiPhoto`-grenen, ~rad 473–535)
- Plocka aktiv referens via `aiPhotoSelectedRefUrl[l.id]` (eller `referenceImages[0]`, eller legacy URL).
- Härled `refFocalX/refFocalY`.
- När `src` är referensbilden ELLER swap-resultatet (dvs `aiResultUrl` eller `selectedRefUrl ?? defaults.referenceImageUrl`), skicka `offsetX={refFocalX}` / `offsetY={refFocalY}` till `PhotoLayerView`.
- Behåll `draggable={false}` när drag ska vara låst (oförändrat — dagens beteende styrs redan av `locks.move`/`canPan`).

### 4. `src/components/editor/AiPhotoSection.tsx`
- Inga funktionella ändringar krävs för bilden, men: när kunden växlar referens via "Välj motiv" och `runSwap` kör, lämna swap-anropet exakt som idag. Resultatet får samma dimensioner som referensen → samma focal fungerar.

### 5. Migrering / läs-vägar
- `src/lib/template-migrate.ts`: bakfyll `focalX:0, focalY:0` på äldre items om de saknas (ej kritiskt, schema sätter default).
- Inga edge-function-ändringar; `referenceImageUrl` skickas oförändrad till `replicate-face-swap`.
- Print-pipeline / snapshot oförändrade — face-swap-resultatet renderas redan via samma `aiPhoto`-väg och får focal samma sätt.

## Vad som INTE ändras
- Drag/visibility-låsning för lagret (kund kan fortfarande inte dra själv om locks säger så).
- Cache, swap-flöde, prompt, val av motiv, removeBackground-flödet.
- Andra lagertyper, admin-uppladdningsbucket, alla språkfiler (ny etikett kan läggas på svenska direkt i admin-UI eftersom admin-strängar inte är i18n:ade i dagens kodbas; om så krävs läggs `aiPhoto.adminFocalHint`-nyckeln senare).

## Beskärnings-säkerhet
`PhotoLayerView`s befintliga `Math.max(-maxX, Math.min(maxX, …))` och re-clamp i `useEffect` garanterar att focal aldrig kan dra bilden utanför sina egna kanter — exakt det användaren bad om.
