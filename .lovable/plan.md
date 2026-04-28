
# Plan: AI-cache + Historik för stilar

## Mål
När en kund applicerar en AI-stil på sin uppladdade bild ska resultatet cachas. Om kunden byter stil och sedan återgår till en redan provad stil → ingen ny Replicate-körning, bilden visas direkt. Helt transparent för kunden, ingen begränsning av användning. Plus: synlig historik med tidigare resultat så det är lätt att jämföra och hoppa tillbaka.

## Hur cachen fungerar (konceptuellt)

Nyckeln är **(uppladdad bild, stil-preset)**. Samma bild + samma stil = samma resultat → återanvänd.

- Kunden laddar upp Bild A → vi laddar upp den till `cart-previews` en gång och får `originalPhotoUrl` (görs redan idag).
- Vi använder `originalPhotoUrl` (eller en hash av den) tillsammans med `preset.id` som cachenyckel.
- Första gången stil "Akvarell" appliceras → Replicate-anrop → resultatet sparas i cachen under nyckeln `A|akvarell` och i `aiPrintFileUrl`.
- Kunden byter till "Oljemålning" → nytt anrop, sparas under `A|oljemalning`.
- Kunden klickar "Akvarell" igen → cache-hit, vi sätter `aiPrintFileUrl` direkt från minnet, **inget Replicate-anrop**, omedelbar visning.
- Kunden laddar upp Bild B → cachen för Bild A behålls i minnet under sessionen men används inte (annan nyckel). Om kunden går tillbaka till Bild A under samma session → cache fortfarande giltig.

Cachen lever i `editorStore` (per session). Eftersom AI-resultaten redan är publika URL:er i `print-files`-bucketen i Lovable Cloud så är "cachen" bara en in-memory map `{ [photoUrl|presetId]: printFileUrl }`. URL:erna i sig är redan permanent lagrade i bucket — vi slipper bara att be Replicate generera dem på nytt.

### Bonus: persistera över sidladdning (valfritt, men billigt)
Vi kan spegla cachen i `localStorage` så att om kunden råkar ladda om sidan med samma bild (jämförelse via filnamn + storlek + originalPhotoUrl) får de fortfarande träffar. Begränsas till t.ex. de 20 senaste posterna för att inte växa obegränsat.

## Historik-UI

I `AiStyleSection` lägger vi till en sektion **"Dina provade stilar"** (visas bara när det finns minst 1 cachat resultat för aktuell bild):

- En horisontell rad med små thumbnails (samma 3-kolumns-grid som presets, eller separat horisontell scroll).
- Varje thumbnail = den faktiska AI-bilden (vi har URL:en).
- Klick → sätter `aiPrintFileUrl` direkt (inget anrop).
- Aktiv stil markeras med ring.
- Liten "✕" på varje för att ta bort från historiken om kunden vill rensa.

Detta gör det också enkelt att **jämföra** stilar utan att vänta — något användare uppskattar mycket.

## Fördelar
- **Kostnad**: ~70-90% färre Replicate-anrop vid normal "prova-runt"-användning.
- **Hastighet**: Återbesök på en stil = omedelbar (vs ~15-30 sek väntan).
- **UX**: Historiken låter kunder jämföra och bestämma sig snabbare.
- **Inga begränsningar**: Kunder kan fortfarande prova hur många stilar som helst.

## Tekniska detaljer

### `editorStore.ts`
Lägg till:
```ts
aiResultCache: Record<string, { url: string; presetId: string; presetLabel: string; thumbnailUrl?: string; timestamp: number }>;
addAiResultToCache: (photoKey: string, presetId: string, presetLabel: string, url: string, thumbnailUrl?: string) => void;
getCachedAiResult: (photoKey: string, presetId: string) => string | null;
listAiResultsForPhoto: (photoKey: string) => Array<{ presetId: string; presetLabel: string; url: string; thumbnailUrl?: string }>;
clearAiResult: (photoKey: string, presetId: string) => void;
```

Cache-nyckel: `${photoKey}|${presetId}` där `photoKey = originalPhotoUrl` (stabil sträng).

När `setPhotoSource` rensar (ny uppladdning) → behåll `aiResultCache` (kan vara värdefull om kunden återanvänder samma bild senare i sessionen). Vi kan inte med säkerhet säga om det är "samma bild", så vi nyckar på URL:en — och om bilden är ny laddas den upp till en ny URL → naturlig invalidering.

### `AiStyleSection.tsx`
- Före Replicate-anropet: `const cached = getCachedAiResult(photoKey, preset.id); if (cached) { setAiPrintFileUrl(cached); toast.success(...); return; }`
- Efter lyckat anrop: `addAiResultToCache(photoKey, preset.id, preset.label, printFileUrl)`.
- Markera aktiv preset (om `aiPrintFileUrl === cached[presetId]`).
- Ny sektion `Dina provade stilar` ovanför undo-knappen, dold om tom.

### Persistens (valfri, rekommenderas)
Liten wrapper `aiCacheStorage.ts`:
- Läs/skriv till `localStorage` under nyckel `lovable.ai-cache.v1`.
- Cap på 20 senaste; LRU-eviction.
- Hydrera i `editorStore` vid init.
- Om en cachad URL returnerar 404 (bucket städad) → ta bort från cache och gör ett nytt anrop.

### Inga ändringar krävs i
- `replicate-style` edge-funktionen (den är redan korrekt: laddar upp till `print-files` och returnerar permanent URL).
- Print-pipelinen (`getPrintFileUrl`) — den får fortfarande `aiPrintFileUrl` precis som idag.
- Cart/checkout — `_print_file_url` är fortfarande den AI-genererade URL:en oavsett om den kom från cache eller ny körning.

## Filer som påverkas
- `src/stores/editorStore.ts` — lägg till cache-state + selektorer.
- `src/components/editor/AiStyleSection.tsx` — cache-check före anrop, historik-UI, aktiv-markering.
- `src/lib/ai-cache-storage.ts` *(ny)* — localStorage-persistens (om vi gör steg 2).

## Föreslagen leveransordning
1. **Steg 1 (in-memory cache + historik-UI)** — Löser 95% av problemet, snabb implementation.
2. **Steg 2 (localStorage-persistens)** — Lägg till efter att steg 1 verifierats, så vi även täcker sidladdningar.

Säg till om du vill köra båda stegen direkt eller bara steg 1 först.
