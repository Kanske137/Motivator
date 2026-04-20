
## Bekräftad rotorsak

Ja — det ska gå, men det som blockerar nu är inte längre host eller `productUid`.

Det exakta felet i loggarna är nu:

```text
"living-room" is not a valid UUID
"bedroom" is not a valid UUID
"office" is not a valid UUID
"wall" is not a valid UUID
reference: "mockupSceneId"
```

Det betyder att Gelato inte vill ha scen-namn som `"living-room"` eller `"wall"`, utan ett riktigt `mockupSceneId` i UUID-format. Den nuvarande filen `src/lib/gelato-scenes.ts` innehåller alltså platshållare, inte riktiga Gelato-scener. Därför faller varje request tillbaka till tryckfilen, och det är därför ni ser delar av editorn/postern längst ner.

Det finns också en separat testdetalj: preview-routen är `/`, som redirectar till `/editor?...`, inte `/index`. 404:an i browser-testet var alltså från fel route, inte från mockup-felet.

## Vad som ska byggas nu

### 1. Sluta använda gissade scene-id:n
Byt strategi i `src/lib/gelato-scenes.ts`:

- ta bort de hårdkodade värdena som `"living-room"`, `"bedroom"`, `"office"`, `"wall"`
- ersätt dem med en struktur som bara använder riktiga UUID:n
- gör mappingen produktbaserad, eftersom giltiga scener sannolikt skiljer sig mellan posters och canvas, och ibland även per `productUid`

Exempel på ny struktur:
- `productType`
- `label`
- `mockupSceneId` (UUID)
- ev. `productUid`-specifik override om vissa produkter har egna scenlistor

### 2. Lägg till ett discovery-spår för riktiga Gelato-scener
Det viktiga nästa steget är att faktiskt hämta eller verifiera vilka scener Gelato accepterar för en given produkt.

Implementera en temporär backend-funktion, t.ex.:
- `supabase/functions/gelato-list-mockup-scenes/index.ts`

Den ska:
- ta emot `productUid`
- anropa relevant Gelato-endpoint för att läsa metadata/templates/mockup-config för produkten
- logga och returnera alla tillgängliga mockup-scener med riktiga UUID:n och gärna label/namn om Gelato skickar dem
- om Gelato inte exponerar detta direkt, prova närliggande produkt/template-endpoints och returnera rådata för analys

Målet här är inte UI först, utan att få fram den verkliga scenkatalogen för era produkt-UID:n.

### 3. Bygg in ett säkert fallback-läge om scenlista saknas
Uppdatera `MockupGallery.tsx` så att den inte längre antar att det alltid finns mockup-scener.

Ny logik:
- om inga verifierade scene UUID:er finns för aktuell produkt:
  - visa tydligt statusmeddelande, t.ex. “Mockup-scener ej konfigurerade för denna produkt ännu”
  - visa tryckfil som fallback, men kalla den uttryckligen “Tryckfil”, inte mockup
- om scene UUID:er finns:
  - kör en request per scen som idag
  - visa bara “riktig mockup” när Gelato faktiskt returnerar en mockup-URL

### 4. Gör `gelato-mockup` mer diagnostisk
Uppdatera `supabase/functions/gelato-mockup/index.ts` så att felsökningen blir definitiv:

- validera att `mockupSceneId` ser ut som UUID innan requesten skickas
- returnera tydligt fel om scen-id inte är UUID-format
- logga:
  - `productUid`
  - `mockupSceneId`
  - host
  - statuskod
  - första `details[0]` från Gelato
- behåll fallback-svar till klienten så UI inte kraschar

Detta gör att nästa fel, om något återstår, blir mycket snabbare att isolera.

### 5. Lägg in verifierade scene UUID:er i en riktig källa
När discovery-funktionen har returnerat de riktiga scenerna:

- fyll `src/lib/gelato-scenes.ts` med de riktiga UUID-värdena
eller
- lagra dem i backend-konfiguration om ni vill kunna uppdatera utan kodändring

Rekommenderat nu:
- börja med kodbaserad mapping för att få det stabilt snabbt
- flytta till admin/backend senare om ni vill kunna underhålla scenlistan enklare

### 6. Verifiera i rätt route
Efter ändringen ska verifiering ske på:
- `/`
eller direkt:
- `/editor?handle=personlig-karta-poster`

Inte `/index`.

## Filer som ska ändras

- `src/lib/gelato-scenes.ts`
- `src/components/editor/MockupGallery.tsx`
- `supabase/functions/gelato-mockup/index.ts`
- ny temporär funktion: `supabase/functions/gelato-list-mockup-scenes/index.ts`

## Förväntat resultat efter fixen

- mockup-anropen slutar falla på `"not a valid UUID"`
- ni använder riktiga Gelato-scener i stället för gissade namn
- mockup-rutorna visar riktiga miljöbilder när UUID:erna väl är korrekta
- om en produkt saknar scen-data visas ett ärligt fallback-läge i UI i stället för att det ser trasigt eller missvisande ut

## Teknisk slutsats

Det nuvarande problemet är alltså inte att mockups “inte stöds”, utan att systemet skickar fel sorts identifierare. Gelato accepterar inte mänskliga scen-namn här, utan riktiga UUID-baserade `mockupSceneId`. Nästa implementation måste därför fokusera på att upptäcka och spara de riktiga scene UUID:erna, inte på fler UI- eller host-ändringar.
