## Mål
Byta AI-modell **endast** för `runRemoveBackground` i `supabase/functions/replicate-face-swap/index.ts` från `google/gemini-3.1-flash-image-preview` (preview, instabil) → `google/gemini-2.5-flash-image` (Nano Banana 1, stabil). Human face-swap och pet ska fortsätta köra på 3.1.

## Bakgrund
Edge-loggar visar att de flesta 400-fel (`Provider returned error` / `provider_unavailable`) kommer från preview-modellens instabilitet. Akvarell lyckas oftare för att dess prompt är mer positiv. Lösningen är inte fler retries — det är att lyfta bort `removeBackground` från preview-modellen.

## Ändringar (en fil)

`supabase/functions/replicate-face-swap/index.ts`:

1. **Lägg till en andra modell-konstant** vid sidan av `ANIMAL_MODEL` (rad 52):
   ```ts
   const ANIMAL_MODEL = "google/gemini-3.1-flash-image-preview"; // human + pet
   const REMOVEBG_MODEL = "google/gemini-2.5-flash-image";        // stabil Nano Banana 1
   ```

2. **Använd `REMOVEBG_MODEL` i `runRemoveBackground`** — på raden där modellnamnet skickas in i gateway-anropet (rad ~256 där `model: ANIMAL_MODEL` byggs in i request-body:n). Det görs via en parameter eller en lokal variabel beroende på hur `callAiGateway` är strukturerad; om hjälparen tar modellen som argument räcker det att skicka in `REMOVEBG_MODEL` från `runRemoveBackground`.

3. **Uppdatera `modelUsed` i start-loggen** (rad 650) så loggraden säger sanning per route:
   ```ts
   const modelUsed = subjectKind === "removeBackground" ? REMOVEBG_MODEL : ANIMAL_MODEL;
   ```

4. **Uppdatera kommentarsblocken** överst (rad 9, 15–16, 49) så det framgår att removeBackground går på 2.5-flash-image medan human/pet ligger kvar på 3.1.

## Det som INTE rör sig
- `runHumanSwap` och `runPetSwap` — fortsätter på `ANIMAL_MODEL` (3.1).
- Replicate `cdingram/face-swap`-konstanterna (död kod, men ingår inte i denna ändring).
- Prompt-text, request-body shape (`messages` + `modalities: ["image","text"]` är identiskt mellan 2.5 och 3.1), retry-logik, klientkod, schema, cache-nycklar.

## Risk
Mycket låg. Body-shapen är gemensam för Nano Banana 1 och 2. Kvalitetsmässigt är 2.5-flash-image väl beprövad; trade-off är att den är marginellt mindre "smart" på komplexa stil-prompts än preview-modellen — men för removeBackground (bakgrund bort + ytstil på subjektet) är det inget problem.

## Verifiering efter deploy
1. Skapa bilposter i varje stil (Linjeart, Skiss, Olja, Vintage poster, Akvarell).
2. Hämta edge-loggar — bekräfta att `[face-swap] start … model=google/gemini-2.5-flash-image` skrivs för `route=remove-bg-nano-banana`, medan ev. human/pet-anrop fortfarande loggar `gemini-3.1-flash-image-preview`.
3. Bekräfta att 400 `upstream_error`-frekvensen sjunker markant.

## Filer som påverkas
- `supabase/functions/replicate-face-swap/index.ts` (en fil, ~5 raders effektiv ändring + kommentarsuppdatering)
