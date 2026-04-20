
Mockup-felet är nu identifierat:

## Rotorsak
`generate-print-file` fungerar redan korrekt, men `MockupGallery` får aldrig fram något `productUid`.

Det syns på två ställen:
- klientloggarna visar upprepade gånger `productUid: undefined`
- databasen visar att `product_configs.gelato_sku_map` är tom för både poster och canvas

Samtidigt finns en komplett lokal mapping i `src/lib/gelato-sku-map.json`, men den används inte alls av nuvarande kod.

## Vad som ska byggas
1. Koppla mockup-flödet till en riktig resolver för Gelato-productUid
2. Använd den lokala mapping-filen som fallback när databasen saknar mapping
3. Normalisera skillnaden mellan dagens två format:
   - databasformat: `gelato_sku_map[size][variant]`
   - lokal fil: `gelato-sku-map.json` med nycklar som `posters -> "30x40|Valnöt" -> portrait`
4. Göra `MockupGallery` tydlig när riktig mockup saknas, så användaren ser skillnaden mellan:
   - riktig Gelato-mockup
   - vanlig tryckfil-preview

## Konkret implementation
### 1. Ny resolver för productUid
Skapa en liten hjälpfunktion i frontend, t.ex. i `src/lib/gelato.ts`, som:
- tar `productType`, `size`, `variant`, `orientation`, `config.gelato_sku_map`
- försöker hitta UID i denna ordning:
  1. befintlig DB-mapping i `config.gelato_sku_map[size][variant]`
  2. lokal fallback i `src/lib/gelato-sku-map.json` via nyckeln `${size}|${variant}`
  3. om variant saknas: första match för samma size + orientation
- returnerar både `productUid` och `source` (`db`, `local-fallback`, `missing`)

### 2. Uppdatera `MockupGallery.tsx`
Byt nuvarande direkta lookup mot resolvern och:
- logga vilken källa som användes
- bara visa “Förhandsgranskning” när riktig mockup inte gick att få fram
- visa tydligt felmeddelande om mapping saknas helt
- behåll print-file som fallback, men markera den visuellt som fallback så det inte ser ut som att mockupen “bara är editorn”

### 3. Minska falska omrenderingar
Nu triggas många print-genereringar när kartan flyttas. Lägg till:
- request-id eller abort-guard så gamla svar inte skriver över nya
- lite striktare debounce för mockupgenereringen
- optional: kör bara mockup när användaren stannat på platsen en kort stund

### 4. Behåll edge functions nästan oförändrade
Det ser inte ut som att felet ligger i backend-funktionerna:
- `generate-print-file` returnerar publik URL korrekt
- inga bevis finns för att `gelato-mockup` ens anropas i de misslyckade fallen

Därför behövs främst frontend-fix, inte större backend-omskrivning.

## Filer att ändra
- `src/components/editor/MockupGallery.tsx`
- `src/lib/gelato-sku-map.json` (endast om någon mapping behöver kompletteras)
- ny hjälparfil, t.ex. `src/lib/gelato.ts`

## Förväntat resultat
Efter ändringen:
- mockup-anropet får ett riktigt `productUid`
- första thumbnailen visar riktig Gelato-mockup när mapping finns
- övriga thumbnails kan fortsätta visa print-preview
- om mapping saknas helt visas ett tydligt fallback-läge istället för att det ser ut som att inget händer

## Teknisk not
Den viktigaste upptäckten är alltså inte Mapbox eller printfilen, utan att produktkonfigurationerna i databasen saknar all Gelato-mapping. Koden behöver därför antingen:
- fylla databasen med mapping senare i adminflödet
eller
- redan nu använda den lokala JSON-mappingen som operativ fallback

Det snabbaste och säkraste nu är att använda den lokala mapping-filen direkt som fallback.
