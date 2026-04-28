## Bekräftat: swap-riktningen är fel

Du har rätt. Modellen behöll adminens ansikte och tog kundens kostym/bakgrund — tvärtom mot vad vi vill.

## Varför

Vi skickar in bilderna i rätt ordning (`input_image_1` = adminens scen, `input_image_2` = kundens foto), men min senaste prompt sa bara *"Replace the dog's face with the new face provided"* utan att peka ut vilken bild som är "den nya". Modellen gissade åt fel håll och behandlade `input_image_2` som scenen i stället.

Adminens egen sparade prompt har samma problem — den säger *"Replace only the dog's face with the uploaded dog's face"* utan att referera till någondera input. Modellen vet då inte vilken som är "the uploaded one".

## Fixen

Skriv om default-prompten så den explicit pekar ut input-namnen som modellen själv förstår:

```
Take the dog's face from input_image_2 and place it onto the dog in input_image_1.
Keep input_image_1's costume, pose, lighting and background exactly the same.
The final dog must have the face from input_image_2, not from input_image_1.
```

Den dubbla bekräftelsen i sista meningen ("must have the face from input_image_2, not from input_image_1") är medvetet redundant — Kontext-modeller följer den typen av entydiga instruktioner mycket bättre.

Adminens egen sparade prompt respekteras fortfarande som huvudinstruktion. Vi appendar bara collage-skyddet som tidigare. (På sikt bör vi även uppdatera adminens default-prompt-mall till samma `input_image_1/2`-stil — det gör jag i samma svep i admin-UI:t.)

## Filer som ändras

- `supabase/functions/replicate-face-swap/index.ts` — bara prompt-byggandet (rad 81–94).
- `src/components/admin/LayerInspector.tsx` (eller motsvarande där adminens swapPrompt placeholder/default sätts) — uppdatera placeholder-texten så admin guidas att skriva prompts som refererar till `input_image_1` / `input_image_2`. Bara hjälptext, ingen logikändring.

Jag deployar funktionen efteråt så du kan testa direkt.
