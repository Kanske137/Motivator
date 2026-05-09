# 3 justeringar i admin / sync

## 1. Falsk varning "saknar Gelato-SKU" på postermallar

I `src/components/admin/ProductOptionsSection.tsx` (rad 157–189) listas alla `size × variant`-kombinationer där `hasGelatoSku()` returnerar false. Hängare finns i Gelato för `21x30`, `30x40`, `40x50`, `50x70`, `70x100` — men inte för `13x18`. Eftersom `getEffectiveSizes()` ändå tar med Hängare-varianter på `13x18` (som "ej tillgänglig"-greyed-out i kundvyn) flaggas de felaktigt här som "saknar SKU".

**Fix:** I `missingSkus`-uträkningen, hoppa över kombinationer som vi medvetet visar som otillgängliga — dvs. poster + variantnamn som matchar `^Hängare/i` på storlekar där Gelato saknar SKU. Dessa är inte ett synk-problem; sync hoppar redan över dem korrekt och kunden ser dem som greyed-out. Banner ska bara visas för faktiska, oväntade luckor (t.ex. om admin lägger till en helt ny storlek).

## 2. Namnbyte: Aluminium → Metallposter, Akryl → Plexiglas

Interna ID:n (`aluminum`, `acrylic`, filsuffix `-aluminum`/`-acrylic`, Gelato-SKU-nycklar, pricing-tabeller) **behålls oförändrade** — endast visningsnamn ändras.

**Filer:**
- `src/i18n/locales/sv.json` — `productKind.aluminum` = "Metallposter", `productKind.acrylic` = "Plexiglas"
- Översätt till alla 10 övriga locales (`en/de/no/da/fi/fr/es/it/nl/pl`):
  - Metallposter → en: "Metal poster", de: "Metallposter", no/da: "Metallplakat"/"Metalplakat", fi: "Metallijuliste", fr: "Poster métal", es: "Póster metálico", it: "Poster in metallo", nl: "Metalen poster", pl: "Plakat metalowy"
  - Plexiglas → en: "Plexiglass", de: "Plexiglas", no/da: "Plexiglass"/"Plexiglas", fi: "Pleksilasi", fr: "Plexiglas", es: "Metacrilato", it: "Plexiglas", nl: "Plexiglas", pl: "Pleksi"
- `src/components/admin/CreateTemplateDialog.tsx` (rad 39–40): byt hårdkodade `label`/`titleSuffix` "Aluminium"/"Akryl" till `t("productKind.aluminum")` / `t("productKind.acrylic")` (titleSuffix = " - " + översatt namn).
- `src/components/admin/ProductOptionsSection.tsx` (rad 274, 302): byt `<Label>Aluminium</Label>` / `<Label>Akryl</Label>` mot t-nycklar.
- Kommentarer i koden lämnas (utvecklarspråk).

## 3. Shopify-produktkategori hamnar på fågelmat

`supabase/functions/shopify-sync-template/index.ts` rad 273–278 sätter:
```
poster/aluminum/acrylic: gid://shopify/TaxonomyCategory/ap-2-1-3
canvas:                  gid://shopify/TaxonomyCategory/ap-2-1-1
```
Prefixet `ap-` tillhör **Animals & Pet Supplies** i Shopifys Standard Product Taxonomy — därför hamnar produkterna under fågelmat / fågelbursartiklar. Korrekt gren är **Home & Garden > Decor > Artwork**, prefix `ho-`.

**Fix:** Byt `DEFAULT_CATEGORY_GID` till rätt taxonomi-GID:er:
- Posters → `gid://shopify/TaxonomyCategory/ho-1-2-2-13` ("Posters")
- Canvas / Metallposter / Plexiglas (alla väggkonst) → `gid://shopify/TaxonomyCategory/ho-1-2-2` ("Artwork") eller specifik underkategori "Decorative Paintings" (`ho-1-2-2-4`).

Innan migrering verifierar jag exakta GID via Shopify-taxonomins offentliga JSON (`https://shopify.github.io/product-taxonomy/`) så vi sätter rätt id för varje kind. Befintliga produkter som redan synkats måste resyncas en gång (admin-knappen "Synka mall" räcker) för att kategorin ska uppdateras.

## Tekniska detaljer
- Inga DB-migreringar, inga schemaändringar.
- Edge-funktion uppdateras + auto-deployas.
- Inga ändringar i Gelato-SKU-mappar eller pricing.
- Inga UI-strängar utöver i18n; banner-strängen i ProductOptionsSection är redan på svenska och flyttar inte till i18n här (separat städ-jobb).
