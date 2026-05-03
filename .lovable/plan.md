Jag hittade problemet: själva testordern kommer in, printfilen finns, men order-webhooken som skickar till Gelato känner fortfarande bara igen `poster` och `canvas`.

Aktuell order #1018 stoppades därför med:

```text
sku_not_found: unknown product type for handle="testglas-acrylic"
```

Det betyder: SKU:erna som vi lade in är rätt sparade i frontend/shared mapping, men `shopify-order-webhook` har en äldre/inlinad SKU-resolver som inte har uppdaterats för `acrylic` och `aluminum`. Därför försöker den inte ens slå upp de nya SKU:erna.

## Plan

1. Uppdatera `supabase/functions/shopify-order-webhook/index.ts`
   - Lägg till stöd för produkttyperna `aluminum` och `acrylic` i `productTypeFromHandle`.
   - Utöka den inlinade `GELATO_SKU_MAP` med de nya SKU:erna för:
     - Aluminium: 20x30, 30x40, 40x50, 50x70, 70x100 i portrait/landscape
     - Akryl: 20x30, 30x40, 40x50, 50x70, 70x100 i portrait/landscape
   - Säkerställ att `Standard` för akryl och aluminium matchar kartans nycklar, så orderraden `size=20x30 variant=Standard orient=portrait` resolve:ar till rätt `acrylic_..._ver` UID.

2. Göra resolver-logiken mer robust
   - Om `gelato_sku_map` finns på `product_configs` men inte matchar dagens nested-format, ska webhooken ändå kunna falla tillbaka på den lokala mappen.
   - Behåll befintligt beteende för posters/canvas oförändrat.

3. Deploya order-webhooken
   - Deploya `shopify-order-webhook` så att den kör uppdaterad logik i backend.
   - Ingen Shopify-sync behövs för detta specifika fel, eftersom produkten redan skickar `_product_handle`, `_size`, `_variant`, `_orientation` och `_print_file_url` korrekt.

4. Verifiera efter ändringen
   - Kontrollera senaste `gelato_orders` och webhook-loggar.
   - För en ny akryltestorder ska loggen ändras från:

```text
source=missing uid=NONE
```

till ungefär:

```text
source=local-exact uid=acrylic_200x300-mm-8x12-inch_4-mm_4-0_ver
```

Därefter ska ordern kunna gå vidare till Gelato. De två redan misslyckade testordrarna (#1017 och #1018) kommer inte automatiskt skickas om av denna ändring; enklast är att göra en ny testorder efter fixen, alternativt kan vi senare lägga till/bygga en manuell retry för sådana ordrar.