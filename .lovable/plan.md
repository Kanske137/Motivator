## Rotorsak

Editorn på Shopify-produkten "Kungligt parporträtt — er som kung och drottning" visar innehåll för "Karttavla med egen plats". Det är inte den här mallen som är trasig — det är resolvern.

Verifierat:

- Shopify-produktens handle är `kungligt-parportratt` (Shopify auto-deriverar handle från titeln när produkten skapas; "familjemotiv" finns bara kvar som tagg).
- DB-raden i `product_configs` har `shopify_handle = kungligt-familjemotiv` och `template_slug = kungligt-familjemotiv`.
- Theme-snippeten injicerar `?handle={{ product.handle }}` → `?handle=kungligt-parportratt`.
- `EditorPage` (rad 201) gör `resolveConfigForHandle(configs, "kungligt-parportratt") ?? configs[0]`. Ingen config matchar, så fallbacken `configs[0]` = **karttavla** (äldsta `created_at` i tabellen) renderas tyst.

Detta är en silent-failure som drabbar varje produkt där Shopify-handle och DB-handle har glidit isär (t.ex. när titel byts manuellt i Shopify Admin efter sync).

## Åtgärder

### 1. Akut datafix för den aktuella produkten

Uppdatera DB-raden så `shopify_handle`/`template_slug` matchar det faktiska Shopify-handle. Implementeras som data-migration (UPDATE) eftersom det inte ändrar schema:

```sql
UPDATE public.product_configs
SET shopify_handle = 'kungligt-parportratt',
    template_slug  = 'kungligt-parportratt'
WHERE id = 'fa72157d-894e-416f-b330-0057c37571e2';
```

Detta gör att kunder på Shopify-produkten direkt får rätt mall (kungligt parporträtt med multi-face) istället för karttavla.

### 2. Ta bort silent-fallback i `EditorPage.tsx`

Ändra rad 201 från `resolveConfigForHandle(...) ?? configs[0]` till att, om ingen träff finns, sätta `config = null` och rendera ett tydligt "Mallen kunde inte hittas"-meddelande (i18n-nyckel) istället för att visa fel mall. Förhindrar att framtida handle-glidningar visar fel motiv för kunden.

### 3. Robustare koppling Shopify ↔ DB (rekommenderad uppföljning)

Lägg till en `template_slug`-metafält som sätts av `shopify-sync-template` på Shopify-produkten (`namespace: custom`, `key: template_slug`, värde: `cfg.template_slug`). Uppdatera theme-snippeten i `SHOPIFY_SETUP.md` så den föredrar `{{ product.metafields.custom.template_slug }}` framför `{{ product.handle }}` när iframe-URL byggs:

```liquid
?handle={{ product.metafields.custom.template_slug | default: product.handle }}
```

Då blir kopplingen oberoende av om någon byter titel/handle i Shopify Admin. Befintliga produkter får metafältet automatiskt vid nästa sync.

### 4. Admin-varning (valfritt)

I `/admin/configs`-listan, läs `shopify_sync_state.last_synced_payload.product.handle` och visa en varning om `shopify_handle` skiljer sig från det faktiska Shopify-handlet — så vi fångar glidningar innan kunderna ser dem.

## Vad jag INTE rör

- Mallinnehåll (template-JSON) för kungligt-familjemotiv eller karttavla.
- Sync-pipeline utöver det nya metafältet i steg 3.
- Resolver-logik för konsoliderade mallar (`expandConsolidatedConfig`, `deriveTemplateSlug`) — den fungerar korrekt så länge handlena matchar.

## Verifiering

1. Efter steg 1: öppna `https://wdxugd-yq.myshopify.com/products/kungligt-parportratt` → editorn ska visa multi-face uppladdning för "Kung" + "Drottning", inte kartval.
2. Efter steg 2: ladda `/editor?handle=existerar-inte` → tydligt felmeddelande, ingen karttavla-fallback.
3. Efter steg 3: kör sync på `kungligt-parportratt` → bekräfta metafält i Shopify Admin → uppdatera theme-snippet → iframe pekar fortfarande rätt även om handle byts framöver.
