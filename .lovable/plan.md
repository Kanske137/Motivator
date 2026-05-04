# Fix: bulkCreate avbryts av befintliga varianter — hängarna skapas aldrig

## Vad loggarna avslöjade

```
ERROR shopify-sync-template error: generic bulkCreate userErrors:
variants.0 The variant '13x18 / Ingen' already exists. Please change at least one option value.
```

Min förra fix lyckades — `plan()` inkluderar nu hängarna och `syncProductOptions()` lägger till "Hängare …"-värden på Shopifys "Ram"-option. **Men hela `productVariantsBulkCreate`-anropet abortar atomärt** så fort en variant kolliderar med en redan befintlig kombination. När 13×18/Ingen kraschar skapas varken hängarna eller någon annan variant. Inga fel når DB:n så det ser ut som om hängarna bara "saknas".

Rotorsaken: existerande variant matchas inte av `optionKeyFromSelected()`-jämförelsen i splitten `toCreate` vs `toUpdate`. Antingen för att:
- Shopify returnerar ett aningen annorlunda värde (case/whitespace, t.ex. "13x18 cm" vs "13x18"), eller
- den finns på produkten men hamnade i tidigare misslyckade syncs i ett annat option-format.

Resultatet blir att den hamnar felaktigt i `toCreate` → kollision → hela bulkCreate kraschar → 0 nya varianter.

## Lösning (tre defensiva förbättringar i `shopify-sync-template/index.ts`)

### 1. Normalisera nyckeln i `optionKeyFromSelected()`
Lower-case + trim + ta bort eventuellt trailande " cm" så att Shopifys variant-värde alltid mappas till samma nyckel som vår plan använder. Använd samma normalisering på vår sida när vi bygger `desiredKeys`/`existingByKey`.

### 2. Bygg en extra "alla befintliga kombinationer"-set baserad på rå value-jämförelse
Som extra säkerhetsnät: bygg `existingComboSet` genom att joina ALLA `selectedOptions.value` (oavsett option-namn) i normaliserad form. Innan vi pushar något till `toCreate`, kontrollera att kombon inte redan finns. Om den finns men saknas i `existingByKey`, försök hitta den manuellt via lös matchning och flytta till `toUpdate` istället.

### 3. Logga splitten för felsökning
Skriv `console.log` med antalet befintliga varianter, antalet `toCreate`, `toUpdate`, `toDelete` samt nycklarna i `toCreate` innan vi anropar Shopify. Då ser vi direkt nästa gång om filtreringen verkligen utesluter hängarna eller inte.

### 4. Höj variant-paginering från 100 → 250
Defensivt: även om vi nu är under 100, kommer vi snart över när nya storlekar/ramar läggs till. Sätt `variants(first: 250)` i `GET_PRODUCT_BY_HANDLE`. Shopify tillåter max 250 per page; för fler hade vi behövt cursor-paginering, men 250 räcker länge.

## Filer som ändras
- `supabase/functions/shopify-sync-template/index.ts`
  - `normalizeOptionValue()` ny helper.
  - `optionKeyFromSelected()` använder normalisering.
  - I update-grenen: bygg `existingComboSet` och filtrera `toCreate` defensivt; logga splitten.
  - `GET_PRODUCT_BY_HANDLE`: `variants(first: 250)`.

## Verifiering
1. Synka "X - poster" igen.
2. I edge-loggen ska vi se rader som `[sync] poster existing=N toCreate=M toUpdate=K`. För "X - poster" ska `toCreate` innehålla exakt de fyra hängar-värdena för 21×30 → 70×100 (totalt 20 nya varianter), inte "13x18/Ingen".
3. I Shopify Admin: "Ram"-option får 9 värden, produkten får ~46 varianter (5 ramar i 13×18 + 9 ramar × 5 större storlekar = 5 + 45).
4. I editorn: "Hängare Ek 30×40" ska kunna läggas i varukorg (variant-resolvern matchar nu).
