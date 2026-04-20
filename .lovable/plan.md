
## Mockups: exakt felorsak och fix

Detta ska gå. Felet är nu exakt lokaliserat:

- `productUid` resolvas korrekt
- `generate-print-file` fungerar korrekt
- `gelato-mockup` når rätt Gelato-host
- men Gelato returnerar `400 BAD_REQUEST` eftersom requesten saknar obligatoriskt fält: `mockupSceneId`

Loggarna visar tydligt:
```text
"There are errors in submitted data"
reference: "mockupSceneId"
"This value should not be blank."
```

Det som visas längst ner idag är därför inte riktiga Gelato-mockups, utan samma tryckfil som återanvänds i alla rutor som fallback. Därför ser man bara delar av editorn/postern.

## Vad som ska byggas

### 1. Ge varje mockup-ruta ett riktigt Gelato-scene-id
Skapa en lokal mapping för mockup-miljöer per produkttyp, t.ex.:

- posters:
  - Vardagsrum
  - Sovrum
  - Kontor
  - På vägg
- canvas:
  - Vardagsrum
  - Sovrum
  - Sidovy
  - Närbild

Varje label kopplas till ett faktiskt `mockupSceneId` som Gelato accepterar.

Föreslagen ny hjälparfil:
- `src/lib/gelato-scenes.ts`

Den ska exportera något i stil med:
- scenlista per `productType`
- label
- `mockupSceneId`

## 2. Uppdatera `MockupGallery` så varje kort anropar Gelato med sin egen scen
Idag anropas mockup-funktionen en gång och övriga rutor fylls med `printUrl`.

Det ska ändras till:
- en lista av mockup-slots byggs från scene-mappingen
- varje slot anropar `gelato-mockup` med:
  - `productUid`
  - `imageUrl`
  - `mockupSceneId`
- varje kort får egen loading/error/status

Resultat:
- riktiga miljöbilder när scen finns
- tydlig fallback per kort om just den scenen misslyckas
- inga fler “fejk-mockups” som bara visar printfilen utan förklaring

## 3. Uppdatera edge function `gelato-mockup`
`supabase/functions/gelato-mockup/index.ts` ska:
- kräva `mockupSceneId` i body
- validera att `productUid`, `imageUrl` och `mockupSceneId` finns
- skicka body till Gelato som inkluderar `mockupSceneId`
- behålla polling och fallback
- logga scen-id tillsammans med host/status så vi ser exakt vilken scen som fungerar eller fallerar

Målet är att requesten blir semantiskt korrekt för Gelatos mockup-API, inte bara nätverksmässigt korrekt.

## 4. Gör fallback-läget ärligt i UI
När Gelato inte returnerar en mockup ska UI inte låtsas att det är en mockup.

`MockupGallery.tsx` ska därför:
- visa badge som tydligt säger att bilden är “Tryckfil” eller “Preview”
- visa feltext från backend på första raden när scenen inte gick att generera
- bara kalla något “mockup” när det faktiskt kommer från Gelato

Det gör att felsökning blir tydlig även framåt.

## 5. Ramtjocklek: justera till Gelato-nivå, inte hårdkodade 2 cm
Nuvarande logik skalar faktiskt med storlek, men baseras på:
- `FRAME_WIDTH_CM = 2`

Det stämmer dåligt mot Gelato-data för inramade posters. I UID:erna syns:
- `frp_w12xt22-mm`

Det tyder på en synlig frontbredd runt 12 mm, inte 20 mm.

Ändring:
- ersätt den hårdkodade konstanten med en produktbaserad fysisk profil
- posters med ram använder ca `1.2 cm` som standard
- canvas fortsätter utan poster-ram
- beräkningen i `MapPreview.tsx` behålls, men drivs av rätt fysisk bredd

Om vi vill göra det ännu bättre senare kan ramprofilen läsas från produktconfig, men nu räcker det att matcha Gelato bättre.

## 6. Bakgrundsfärg: redan på plats
Det här är redan implementerat i koden:
- state finns i `editorStore`
- swatches + color picker finns i `ControlPanel`
- `MapPreview` applicerar `posterBgColor` på posterns bakgrund
- standard är beige (`#EFE7D6`)

Det behöver alltså inte byggas om, bara behållas när mockupfixen implementeras.

## Filer som ska ändras
- `supabase/functions/gelato-mockup/index.ts`
- `src/components/editor/MockupGallery.tsx`
- `src/pages/EditorPage.tsx`
- ny fil: `src/lib/gelato-scenes.ts`

## Förväntat resultat efter implementation
- första riktiga Gelato-mockups börjar visas istället för editor/print-crops
- varje miljöruta representerar en faktisk Gelato-scen
- fallback visas bara när en specifik scen misslyckas
- ramens visuella tjocklek känns rimlig i förhållande till liten/stor poster
- bakgrundsfärgsval fortsätter fungera som nu

## Teknisk not
Den tidigare host-fixen var nödvändig, men inte tillräcklig. Den riktiga blockeraren nu är att mockup-requesten saknar `mockupSceneId`. Det är därför mockups fortfarande inte visas trots att UID och printfil fungerar.
