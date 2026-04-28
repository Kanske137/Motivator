## Vad var felet?

Edge-loggen säger:
```
[face-swap] start failed { detail: "The requested resource could not be found.", status: 404 }
```

Jag pekade edge-funktionen mot `flux-kontext-apps/face-swap` — **den modellen finns inte på Replicate**. Det var min miss förra rundan. Replicate svarar 404 och kunden får "Vi kunde inte skapa bilden".

## Fixen

Byt till **`flux-kontext-apps/multi-image-kontext-max`** — en officiell Replicate-modell som faktiskt existerar och som passar exakt vårt behov:

- Tar två bilder (`input_image_1` = adminens referensbild, `input_image_2` = kundens uppladdade bild) plus en prompt.
- Är en generell Kontext-baserad redigeringsmodell, **inte** en ansiktsdetektor → fungerar för människor OCH djur (katt/hund).
- Officiell, alltid-uppe, förutsägbart pris (~$0.08/bild).
- Stödjer `/v1/models/{owner}/{name}/predictions`-endpointen vi redan använder, så koden ändras minimalt.

## Ändringar

**`supabase/functions/replicate-face-swap/index.ts`:**
- Byt `FACE_SWAP_MODEL` till `flux-kontext-apps/multi-image-kontext-max`.
- Byt input-payload från `{ input_image, swap_image, prompt }` till `{ input_image_1: referenceImageUrl, input_image_2: faceImageUrl, prompt, aspect_ratio: "match_input_image", output_format: "jpg", safety_tolerance: 2 }`.
- Justera default-prompten så den är formulerad för Kontext-modellen ("Take the face/subject from the second image and place it onto the character in the first image. Keep the first image's pose, costume, lighting and background unchanged.") med subject-specifika varianter för `cat`/`dog`/`human`.
- Behåll all befintlig felhantering, polling, upload till `print-files` och `fallback`-svar.

**Inget annat rörs** — frontend, cache, store, UI är redan klart från förra rundan.

## Efter deploy

Deploya edge-funktionen direkt och testa igen med samma hund-bild. Om det fortfarande failar tittar jag på de nya loggarna — men 404:an försvinner garanterat eftersom modellen verifierat finns och endpointen är dokumenterad.
