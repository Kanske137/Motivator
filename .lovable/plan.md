Jag kan bekräfta två viktiga saker från loggarna:

- En ny bild skickades och sparades: `print-files/swap-58169e30-33e2-42f6-b0fc-17748ce74879.jpg`.
- Det är den URL:en som funktionen returnerade som färdig bild.

Men jag ser också varför det fortfarande blir fel i upplevelsen: den sparade genererade bilden är mycket nära referensbilden och verkar inte ha gjort en verklig face swap. Dessutom finns en lokal cache i webbläsaren som kan återanvända ett tidigare felaktigt resultat för samma uppladdade bild + referens, så “Skapa igen” kan visa samma felaktiga bild utan att faktiskt generera om.

Plan för korrigering:

1. Tvinga “Skapa igen” att verkligen skapa om
   - Ändra kundflödet så knappen “Skapa igen” inte hämtar från lokal face-swap-cache.
   - Cache får bara användas för första snabbvisning om det redan finns ett resultat, men när användaren aktivt trycker “Skapa igen” ska den alltid anropa AI-funktionen igen.
   - Alternativt ta bort cache för face swap helt tills vi vet att kvaliteten är stabil.

2. Lägg till cache-version så gamla felaktiga resultat ignoreras
   - Uppdatera cache-nyckeln från v1 till v2.
   - Inkludera prompt/version i cache-nyckeln så gamla resultat från tidigare felaktiga promptar aldrig återanvänds.

3. Gör backend-loggarna tydligare
   - Logga vilken bild som är scene/reference och vilken som är kundens face image.
   - Logga slutlig prompt i förkortad form och modellens output-URL.
   - Detta gör att vi kan bekräfta efter nästa test om rätt bild skickades och exakt vilken bild som visas.

4. Stärk prompten igen, men utan att skapa förvirring
   - Justera prompten till mer “edit reference scene only”-språk:
     - input_image_1 = final canvas / scene / body that must remain
     - input_image_2 = identity/face donor only
     - do not recreate input_image_1 unchanged
     - change the face/identity visibly enough to match input_image_2
   - Behåll instruktionen om en enda slutbild, ingen collage.

5. Visa tydligare i UI vilken bild som används
   - Efter generering kan komponenten visa “Genererad bild används” och gärna intern debug-info i console med result URL.
   - För användaren ska preview alltid använda `aiPhotoResults[layer.id]` först, annars referensbilden. Den prioriteten finns redan, men vi gör det lättare att felsöka om resultatet saknas eller är cache:at.

Tekniska filer som ändras:

- `src/components/editor/AiPhotoSection.tsx`
  - Bypass/invalidera cache vid “Skapa igen”.
  - Lägg till bättre client-loggning för reference, uploaded face och result URL.

- `src/lib/face-swap-cache.ts`
  - Uppdatera cache-version och/eller cache-nyckel så gamla felaktiga resultat inte kan återanvändas.

- `supabase/functions/replicate-face-swap/index.ts`
  - Förbättra prompt och loggning.
  - Returnera eventuellt extra debugfält som `usedReferenceImageUrl`, `usedFaceImageUrl`, `replicateOutputUrl` i JSON-svaret.

Efter ändringen bör nästa test visa om problemet är:

```text
A) cache/UI visar gammal referenslik bild
eller
B) AI-modellen returnerar faktiskt nästan oförändrad referensbild
```

Om B kvarstår efter detta behöver vi byta strategi/model för hund/katt-swap, men först behöver vi rensa cache och få säkra loggar så vi inte felsöker ett gammalt resultat.