## Vad hände egentligen?

Jag tittade på den faktiska bilden som modellen returnerade. Den är **1568×672 pixlar** — alltså två bilder bredvid varandra (ett före/efter-collage). Vad du såg i editorn var troligen vänster halva av collaget inzoomat i din crop-ruta. Ingen riktig swap presenterades — modellen gjorde tekniskt en swap men packade ihop båda bilderna i ett collage.

Du kan se hela bilden här: [swap-result-debug.jpg](sandbox:/mnt/documents/swap-result-debug.jpg)

## Varför blev det collage?

Vår prompt sa bokstavligen *"Take the dog's face from the second image and place it onto the dog in the first image"*. Modellen tolkade "first image" / "second image" som visuella instruktioner och bestämde sig för att visa båda bilderna sida vid sida. Det officiella exemplet i Replicates dokumentation använder en mycket enklare prompt — *"Put the woman into a white t-shirt with the text on it"* — och returnerar en ren single-image output.

## Fixen

Ändra prompten i edge-funktionen så modellen tvingas returnera **en enda redigerad bild**:

1. Skriv om default-prompten utan att referera till "first image" / "second image". Istället: `"Replace the dog's face with the new face provided. Keep the original costume, pose, lighting and background exactly the same."`
2. Lägg till en hård efter-instruktion (oavsett om admin har skrivit en egen prompt eller inte): `"Output a single edited image only — do not return a collage, do not show the input images side by side, do not include any reference panels."`
3. Adminens egen prompt från configs respekteras fortfarande som huvudinstruktion — vi appendar bara collage-skyddet.

Inget annat behöver ändras (frontend, cache, store, UI är redan klart).

## Filer som ändras

- `supabase/functions/replicate-face-swap/index.ts` — bara prompt-byggandet (rad 81–90).

## Efter deploy

Jag deployar funktionen direkt och du kan testa skapa igen med samma hund-bild. Om den fortfarande gör collage faller vi tillbaka på plan B: kapa höger halva av output-bilden i edge-funktionen innan vi laddar upp den.
