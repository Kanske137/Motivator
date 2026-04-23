

## Steg 3: Gelato Mockup API-integration

### Bakgrund

Idag genereras alla mockup-bilder klient-side: vi tar snapshot av tryckfilen och komponerar in den i statiska scen-bilder via canvas (`mockup-composite.ts`). Det fungerar men ser “klistrat” ut, saknar äkta belysning/skuggor och har bara 4–6 rumsmiljöer.

Gelato har ett **Mockup Generator API** som tar emot en print-fil + product UID och returnerar fotorealistiska mockups (samma bilder som syns i deras egna butiker). Vi har redan allt på plats för att koppla in det:

- `GELATO_API_KEY` finns som secret.
- `gelato-fetch-uids` edge function visar redan hur Gelato-API:et anropas.
- `getPrintFileUrl()` ger en publik URL till tryckfilen i `print-files`-bucket.
- `cart-previews` bucket kan återanvändas för cache.

### Varför tidigare försök fastnade

Gelato Mockup API kräver att vi skickar **både** ett `productUid` (för att veta vilken mockup-mall som ska användas) **och** en publik URL till tryckfilen. När detta försöktes tidigare fanns ingen stabil publik tryckfil-URL ännu (uppladdningen till `print-files` byggdes senare som del av cart-flödet) och UID-mappningen var ofullständig. Båda problemen är nu lösta — `print-files`-bucket är public och `gelato-sku-map.json` täcker alla varianter.

### Lösning

#### 1. Ny edge function `gelato-mockups`

`supabase/functions/gelato-mockups/index.ts`

**Input** (POST JSON):
```ts
{
  productUid: string,        // från resolveProductUid()
  printFileUrl: string,      // public URL i print-files-bucket
  designId: string,          // för cache-key
}
```

**Flöde:**
1. Validera input (Zod).
2. Cache-check: kolla `mockup-cache`-bucket på path `${designId}/${md5(productUid)}.json`. Om finns → returnera cachad lista direkt.
3. Anropa Gelato:
   - `POST https://order.gelatoapis.com/v4/mockups` (eller motsv. mockup-endpoint, vi verifierar exakt path mot deras docs i implementationsfasen) med body `{ productUid, printFileUrl, mockupTypes: ["default", "in-room", "lifestyle"] }`.
   - Polla status om async, eller läs URLs direkt om sync.
4. Spara JSON-array `[{ id, label, url }]` i cache-bucket.
5. Returnera samma lista till klienten.

**Felhantering:** vid Gelato-fel → returnera `{ ok: false, error }` med 502; klienten faller tillbaka till lokal komposit (befintlig `compositeMockup`).

#### 2. Ny storage-bucket `mockup-cache` (public, read-only via signed-not-needed eftersom URLs redan är publika hos Gelato)

```sql
insert into storage.buckets (id, name, public)
values ('mockup-cache', 'mockup-cache', true);

-- Public read; service-role write
create policy "Public read mockup-cache"
on storage.objects for select
to public
using (bucket_id = 'mockup-cache');
```

(Skrivning sker bara från edge function via service-role, ingen insert-policy behövs.)

#### 3. Klient-integration i `MockupGallery.tsx`

Refaktorera `useEffect` så den först:
1. Producerar `printFileUrl` via befintliga `getPrintFileUrl()` (samma som cart använder).
2. Resolver `productUid` via befintliga `resolveProductUid()`.
3. Anropar `supabase.functions.invoke("gelato-mockups", { body: { productUid, printFileUrl, designId } })`.
4. Om svaret innehåller `urls.length > 0` → visa Gelato-bilderna i karusellen.
5. Om edge function failar eller returnerar tom lista → fall tillbaka på dagens `compositeMockup` så vi aldrig visar en tom galleri.

För canvas: behåll 3D-previewen som primär, men **lägg till** Gelato-mockups under (canvas-på-vägg-renders från Gelato är riktigt bra).

#### 4. Debounce + request invalidation

Behåll dagens `reqIdRef`-mönster — Gelato-anropet kan ta 2–5 s, så att avbryta in-flight requests när användaren ändrar något är kritiskt. Edge function-anropet wrappas i samma `myReq`-check.

#### 5. Cache-invalidation

Cache-keyn bygger på `designId` (UUID per komposit-state) — eftersom `designId` regenereras vid `handleAddToCart`, men inom editor-sessionen är `designId` stabilt **per design-state**. Vi behöver alltså generera en deterministisk hash av `printFileUrl` + `productUid` istället, så att samma design + samma produkt ger samma cache-träff. Använd `crypto.subtle.digest("SHA-1", ...)` i edge function.

### Filer

| Fil | Ändring |
|---|---|
| `supabase/functions/gelato-mockups/index.ts` | NY edge function |
| `supabase/migrations/<ts>_mockup_cache_bucket.sql` | NY: skapa `mockup-cache` bucket + RLS |
| `src/components/editor/MockupGallery.tsx` | Anropa nya edge function först, fall tillbaka på lokal composite |
| `src/lib/mockup-gelato.ts` | NY liten helper som wrappar `supabase.functions.invoke` + resolve UID |

### Verifiering

1. Öppna editorn, designa en poster → Gelato-mockups laddas i galleriet (loading spinner ~3 s, sen 3–5 fotorealistiska bilder).
2. Klicka på bild → lightbox öppnas precis som idag.
3. Stäng nätverket / blockera Gelato → fallback till lokal composite, inga tomma slots.
4. Ändra mapZoom → ny `printFileUrl` → ny mockup-uppsättning hämtas (med debounce).
5. Samma design + samma produkt två gånger → andra anropet träffar cache (< 200 ms).
6. Canvas-produkt: 3D-preview kvarstår överst, Gelato-canvas-mockups visas under.
7. Gelato 4xx/5xx → fallback aktiveras, toast loggas i console (ingen användar-toast eftersom fallbacken levererar fungerande bilder).

### Arbetsordning

1. Skapa `mockup-cache`-bucket via migration.
2. Bygg `gelato-mockups` edge function — börja med ett minimalt anrop till Gelatos endpoint för att verifiera exakt request/response-form (testa via `curl_edge_functions` direkt).
3. Lägg till caching.
4. Bygg klient-helpern + integrera i `MockupGallery`.
5. Bekräfta fallback-vägen genom att tillfälligt stänga av edge function.

