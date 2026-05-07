## Mål
Lägg till en "Radera mall"-funktion på respektive mallsida (`/admin/designer/:id`) som:
1. Visar en bekräftelsedialog där användaren måste skriva exakt `RADERA` för att aktivera knappen.
2. Tar bort produkten i den kopplade Shopify-butiken.
3. Raderar mallen lokalt (`product_configs` + `shopify_sync_state`).
4. Skickar tillbaka användaren till admin-listan.

## Ändringar

**1. Ny edge-funktion `shopify-delete-template`**
- Tar `{ product_config_id }` i body.
- Hämtar `shopify_sync_state.shopify_product_id` för mallen.
- Hämtar shop-domän + Admin-token från `shopify_app_installations` (samma mönster som `shopify-sync-template`).
- Anropar Shopify Admin GraphQL `productDelete` om ett `shopify_product_id` finns. Saknas det, hoppa Shopify-steget men fortsätt.
- Behöver ny migration för att tillåta `DELETE` på `product_configs` och `shopify_sync_state` (idag blockerat av RLS) — körs som service role från edge-funktionen så det räcker att lägga till en `DELETE`-policy eller använda service role-klienten direkt (jag väljer service role för att undvika öppen DELETE-policy).
- Returnerar `{ ok, shopifyDeleted, configDeleted }`.

**2. UI på `src/pages/admin/DesignerPage.tsx`**
- Ny "Radera mall"-knapp (destructive variant) i header/footer-området bredvid Spara/Publicera.
- Öppnar `AlertDialog` med:
  - Tydlig varning på svenska: "Detta raderar mallen och tar bort produkten från Shopify. Det går inte att ångra."
  - Visar `title` och `shopify_handle` så man ser vad som raderas.
  - Inputfält där användaren måste skriva `RADERA` (case-sensitive). Bekräfta-knappen är `disabled` tills texten matchar exakt.
- Vid bekräftelse: anropar nya edge-funktionen, visar `sonner` toast (success/error), navigerar till `/admin` (eller motsvarande mall-listsida) vid lyckad radering.
- All ny text går via `useTranslation()` + nycklar i `src/i18n/locales/sv.json` och översätts till `en/de/no/da/fi/fr/es/it/nl/pl` enligt projektregeln.

**3. i18n-nycklar (svenska källa)**
- `admin.delete.button` "Radera mall"
- `admin.delete.title` "Radera mall permanent?"
- `admin.delete.warning` "Detta raderar mallen i Lovable och tar bort produkten från Shopify. Det går inte att ångra."
- `admin.delete.confirmHint` "Skriv RADERA för att bekräfta"
- `admin.delete.confirm` "Radera permanent"
- `admin.delete.cancel` "Avbryt"
- `admin.delete.success` "Mallen och Shopify-produkten är raderade"
- `admin.delete.error` "Kunde inte radera mallen"

## Tekniska detaljer
- Edge-funktion deployas med default `verify_jwt = false`; i koden valideras inget JWT eftersom admin-sidan idag är öppen (samma säkerhetsmodell som befintlig `shopify-sync-template`).
- Shopify Admin GraphQL-versionen följer befintlig konvention i `shopify-sync-template`.
- Tomma cachar (`clearVariantResolverCache`, prislistecache) töms efter lyckad radering så UI inte håller kvar gammal variant.
- Inga schemändringar krävs om vi använder service role-klient i edge-funktionen för DELETE.