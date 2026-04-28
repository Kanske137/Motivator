Jag kan bekräfta vad som hände i senaste körningen:

- Funktionen skickade rätt två bilder till modellen:
  - `input_image_1` = admin/referensbilden, alltså scenen som ska behållas.
  - `input_image_2` = kundens uppladdade hundbild, alltså ansiktet som ska användas.
- Funktionen sparade och visar modellens returnerade bild, inte en gammal lokal bild.
- Resultatet blev ändå fel: modellen genererade en side-by-side-/jämförelsebild i stället för en faktisk swap.

Problemet är alltså inte primärt att vi visar fel URL eller att bilderna skickas bakvänt. Problemet är modellvalet.

## Varför blir det side-by-side?

Nuvarande modell är `flux-kontext-apps/multi-image-kontext-max`. Den är en generell multi-image editing-modell: den försöker tolka två bilder + prompt och skapa en ny komposition. Trots att prompten säger “do not return collage / side by side” kan modellen välja att visuellt sammanställa båda inputbilderna, särskilt när uppgiften är svår: hundansikte från en uppladdad bild till en stiliserad/referensbaserad hundscen.

Det här är typiskt för generativa multi-image-modeller. De kan vara bra på kreativa bildkombinationer, men de har ingen hård garanti att bara byta ansikte. Därför har vi sett tre olika felsätt:

1. Referensbilden nästan oförändrad.
2. Fel riktning på swap.
3. Side-by-side av båda bilderna.

Det pekar starkt på att modellen inte är rätt verktyg för den här produktfunktionen.

## Rekommenderad korrigering

Byt `replicate-face-swap` från generell Kontext-modell till en riktig face-swap-modell med tydliga fält för källa och mål.

För hund/katt/person bör vi köra:

```text
Target image: referensbilden/scenen där ansiktet ska hamna
Source image: kundens uppladdade ansiktsbild
Output: target image med source face inblandat
```

Jag föreslår i första hand att vi testar en dedikerad face-swap-modell med API-fält som `target_image`/`source_image` eller `input_image`/`swap_image`, t.ex. `catio-apps/cog-faceswap-catio` som har:

```text
target_image = referensbild
source_image = uppladdad kundbild
```

Den är mer passande än en promptstyrd multi-image-modell eftersom modellen inte ska “komponera två bilder”; den ska applicera ett source face på en target image.

Som alternativ/fallback för mänskliga ansikten kan vi använda enklare modeller som `codeplugtech/face-swap` eller `cdingram/face-swap`, men de är mer fokuserade på människor och kan vara sämre för hund/katt.

## Plan för implementation

1. Uppdatera `supabase/functions/replicate-face-swap/index.ts`
   - Byt modellflödet från `flux-kontext-apps/multi-image-kontext-max` till en dedikerad face-swap-modell.
   - Mappa bilderna explicit:
     - `target_image` = `referenceImageUrl`
     - `source_image` = `faceImageUrl`
   - Behåll samma svar till frontend: `printFileUrl`, `replicateOutputUrl`, `usedReferenceImageUrl`, `usedFaceImageUrl`.

2. Lägg till validering av modelloutput
   - Om modellen returnerar en bild med uppenbart fel format, t.ex. dubbelt så bred side-by-side-bild, ska funktionen inte visa den som lyckad.
   - Då ska kunden få ett tydligt felmeddelande i stället för att en felaktig bild hamnar i editorn.
   - Om tekniskt möjligt kontrollerar vi bilddimensioner innan den sparas till `print-files`.

3. Förbättra fallback och loggning
   - Logga vilken modell som användes och vilka inputfält som skickades.
   - Om modellen inte hittar ansikte eller misslyckas ska vi returnera ett vänligt fel: “Prova en tydligare bild framifrån”.
   - Ta bort beroendet av prompt för själva swap-riktningen; prompten kan finnas kvar som metadata/styrning men ska inte bära huvudlogiken.

4. Invalidera cache igen
   - Uppdatera face-swap-cache-versionen till nästa version så tidigare felaktiga resultat aldrig återanvänds.
   - “Skapa igen” fortsätter att bypassa cache.

5. Test efter ändring
   - Kör med samma hundbild/referens igen.
   - Kontrollera i loggarna att ny modell används.
   - Bekräfta att den visade bilden är den sparade modelloutputen och inte referensbilden eller en side-by-side-komposition.

## Förväntad effekt

Detta bör lösa grundproblemet genom att använda rätt typ av modell. En dedikerad face-swap-modell är betydligt mindre benägen att skapa side-by-side/collage, eftersom den har strukturerad input för “source face” och “target image” i stället för att försöka tolka två bilder kreativt via prompt.

Det kan fortfarande finnas begränsningar med djuransikten: vissa face-swap-modeller är tränade mest på mänskliga ansikten. Därför behöver vi behandla första bytet som ett modelltest. Om `catio-apps/cog-faceswap-catio` inte ger bra hundresultat är nästa steg att välja en mer specialiserad pet/animal-workflow eller byta produktmetod från “face swap” till “AI pet portrait generation” med referensbild, men just nu är det mest rationella att först lämna multi-image Kontext-flödet.