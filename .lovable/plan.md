## Mål

1. Lägg de 6 uppladdade bilderna som standard-thumbnails för AI-stilarna (Akvarell, Skiss, Olja, Pop-art, Linjekonst, Vintage).
2. Byt namn: **Linjeart → Linjekonst** och **Vintage poster → Vintage**.
3. Gäller både nya mallar (defaults) och alla befintliga mallar i databasen.

## Steg

### 1. Ladda upp thumbnails till Supabase Storage
Använd den befintliga publika bucketen `ai-references` (samma som AI-bilder redan ligger i). Lägger filerna under `style-thumbnails/{id}.png`:

| id | fil | publik URL |
|---|---|---|
| watercolor | Akvarell.png | …/ai-references/style-thumbnails/watercolor.png |
| sketch | Skiss.png | …/ai-references/style-thumbnails/sketch.png |
| oil | Olja.png | …/ai-references/style-thumbnails/oil.png |
| pop-art | Pop-art.png | …/ai-references/style-thumbnails/pop-art.png |
| lineart | Linjekonst.png | …/ai-references/style-thumbnails/lineart.png |
| vintage-poster | Vintage.png | …/ai-references/style-thumbnails/vintage-poster.png |

(Schemat `aiStylePresetSchema.thumbnailUrl = z.string().url()` kräver absolut URL — Storage public URL fungerar; Lovable Assets `/__l5e/...` gör inte det.)

### 2. `src/lib/ai-style-defaults.ts`
- Lägg till `thumbnailUrl` på alla 6 presets (URL:erna ovan).
- `lineart.label`: "Linjeart" → **"Linjekonst"**.
- `vintage-poster.label`: "Vintage poster" → **"Vintage"**.
- (Behåller id:n oförändrade så cache + Shopify-historik fortsätter matcha.)

### 3. `src/lib/pricing.ts`
- Rad 68: `label: "Vintage poster"` → **"Vintage"** (för konsekvens; samma id `vintage-poster`).

### 4. SQL-migration — uppdatera alla befintliga mallar
För varje rad i `product_configs` där `template->'productOptions'->'aiStyles'` är en array, mappa över arrayen och:
- sätt `thumbnailUrl` per `id` (de 6 URL:erna ovan),
- ersätt label `"Linjeart"` med `"Linjekonst"` (id `lineart`),
- ersätt label `"Vintage poster"` med `"Vintage"` (id `vintage-poster`).

Implementeras som `jsonb_set` + `jsonb_agg` över aiStyles-arrayen, idempotent (kan köras igen utan effekt).

### 5. i18n
Inga träffar på "Linjeart"/"Vintage poster" i `src/i18n/locales/*` — labels lagras som data i template/defaults, inte som översättningsnycklar. Inget att ändra där.

### Inte berört
- AiStyleSection-UI (läser redan `p.thumbnailUrl`).
- Admin-ProductOptionsSection (visar redan thumbnail när den finns).
- Prompts, id:n, cache-nycklar (`photoHash::presetId`), Shopify-sync-flöden.
- Replicate-edge-functionen.

## Verifiering
- Öppna en mall i editorn → AI-stilar visar de nya thumbnails och nya namn.
- Öppna admin → ProductOptions visar samma thumbnails som defaults.
- Skapa ny mall → seed kör DEFAULT_AI_STYLES med nya namn + thumbnails.
