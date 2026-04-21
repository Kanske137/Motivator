

## Plan: Synka printfil med editor-val (etiketter + form)

### Problem
1. **Områdestexter (map labels) syns på printfilen** trots `showLabels=false` i editorn. Mapbox Static API ignorerar vår klient-side `setLayoutProperty(visibility: none)` — den tillämpas bara på live-mapen i browsern, inte på den statiska bilden vi hämtar i edge function.
2. **Kartform (cirkel/kvadrat) ignoreras**. Loggarna visar `shape=rect` även när användaren valt cirkel — `mapShape` skickas inte med från `shopify-order-webhook` till `generate-print-file`.

### Rotorsaker

**Labels:** I `generate-print-file/index.ts` byggs Mapbox URL utan `?fresh` style-overrides. Mapbox Static API stödjer inte runtime layer-toggle via URL för standard-stilar. Två sätt att lösa:
- **A)** Använd en Mapbox-stil där labels redan är dolda (kräver custom style ID per användarval — komplext).
- **B (vald)**: Ladda stilen via `/styles/v1/{user}/{style}` med `addlayer`/`setfilter` URL-params. Mapbox Static Images API stödjer faktiskt `setfilter` och `addlayer` query-params för att modifiera stilen on-the-fly. Vi kan skicka `setfilter=["==",["get","class"],"__hidden__"]` på alla symbol-layers, men det kräver att vi vet layer-IDs.

Enklare och mer robust: använd Mapbox **`/styles/v1/{username}/{style_id}/static`** med en **style override** i form av en JSON-payload (`POST` style + `GET` static räcker inte).

**Verkligen enklast**: Map Static API stödjer `before_layer` och layer-overrides via en **temporär style** — men vi kan undvika hela problemet genom att hämta Mapbox-tilen UTAN labels via en egen `no-labels`-variant av stilen. Mapbox tillhandahåller redan `mapbox/streets-v12` som har labels — vi behöver en label-fri motsvarighet.

**Praktisk lösning**: Använd Mapbox Static Tiles API med parameter `&attribution=false&logo=false` + lägg till en **POST-baserad style temporary override**. Detta är komplext.

**Realistisk lösning (vald)**: Lägg labels som **SVG text overlay i vår egen pipeline** istället för att förlita oss på Mapbox-renderade labels. För `showLabels=false` skickar vi en ren label-fri Mapbox-tile genom att använda Mapbox-stilarnas `-no-labels`-variant där det finns, ELLER vi accepterar Mapbox-labels men lägger en vit/transparent overlay-mask. 

Bästa pragmatiska väg: **använd Mapbox `static` med `addlayer`-parameter för att lägga ett tomt fill ovanpå alla symbol-layers**. Mapbox Static API stöder `&addlayer={...}&before_layer={layer_id}`. Men eftersom det krävs att vi känner till alla symbol-layer IDs i varje stil, är det fortfarande klent.

**Slutgiltigt val: dubbla style-IDs.**
Mappa varje stil till en `-no-labels`-variant när `showLabels=false`:
- `mapbox/streets-v12` → använd Mapbox `mapbox/light-v11` eller en custom style. Tyvärr har inte alla Mapbox-stilar en label-fri variant.

→ **Renaste lösningen: skapa custom Mapbox-stilar (en med, en utan labels) per design** ELLER **fetcha tile-bilden och kör en post-process som maskar text-områden** (komplext).

→ **Pragmatisk MVP-lösning: använd Mapbox `static` API med `addlayer` som lägger ett genomskinligt fill över hela bilden + kör samma `applyLabelVisibility`-logik** — fungerar inte på static API.

### Den faktiska, fungerande lösningen

Mapbox Static Images API **stöder query-parameter `&addlayer=` + `before_layer=`** för att modifiera stilen on-the-fly. Vi kan dock INTE dölja existerande layers via URL-params.

**Den enda realistiska vägen för MVP:**
1. För varje Mapbox-stil i `gelato-uids.json` / style-listan, definiera ett `noLabelsStyleId`-mappning i en ny konstant i edge function. Standard Mapbox-stilar utan labels:
   - `mapbox/streets-v12` → ingen direkt motsvarighet, fallback till samma
   - `mapbox/light-v11` → `mapbox/light-v11` (har minimala labels)
   - `mapbox/dark-v11` → `mapbox/dark-v11`
   - `mapbox/outdoors-v12` → fallback
2. Acceptera att vissa stilar inte har label-fri variant och kommunicera detta till användaren (eller skapa custom-stilar i Mapbox Studio senare).

**ELLER — bättre på sikt: skapa custom Mapbox-stilar i Mapbox Studio** (en label-fri variant per stil) och lagra mappningen. Detta är ett separat task.

**För denna iteration: implementera shape-clipping (lätt fix) + använd `applyLabelVisibility`-equivalent via Mapbox Static API:s `setfilter`-parameter där möjligt, annars dokumentera limitation.**

### Vad jag faktiskt ändrar nu

**Fix 1 — Shape clipping (riktig fix):**
- `shopify-order-webhook/index.ts`: läs `_mapShape` från cart properties och skicka `mapShape` i payload till `generate-print-file`. Idag skickas det inte alls → defaultar till `"rect"` i edge function.
- `generate-print-file/index.ts`: shape-clipping-koden finns redan (`clipDef` + `clipAttr`). Bekräfta att den används korrekt + att canvas-bakgrund (`posterBgColor`) syns runt cirkel/kvadrat.

**Fix 2 — Labels (pragmatisk fix):**
- `shopify-order-webhook/index.ts`: läs `_showLabels` från cart properties och skicka i payload.
- `generate-print-file/index.ts`: implementera **Mapbox Static API addlayer-trick** — lägg till `&addlayer=` med ett tomt symbol-layer som overrides text-paint till transparent. Detta fungerar för layers vi själva lägger till, INTE för befintliga. 
- **Realistisk MVP**: När `showLabels=false`, byt `styleId` till en label-free variant via en mapping i edge function. Lista:
  ```ts
  const NO_LABEL_STYLE: Record<string,string> = {
    "mapbox/streets-v12": "mapbox/light-v11",  // fallback
    "mapbox/light-v11": "mapbox/light-v11",
    "mapbox/dark-v11": "mapbox/dark-v11",
    // custom user styles → samma (kräver custom no-label style i Mapbox Studio)
  }
  ```
- Detta är inte perfekt men matchar editor-beteendet "bättre" än idag. Långsiktig fix: skapa custom no-label styles i Mapbox Studio (separat task).

**Fix 3 — Cart properties end-to-end:**
- Verifiera att editor faktiskt skriver `_mapShape` och `_showLabels` till Shopify cart line item properties. Om inte → fix i `cartStore.ts` / `useCartSync.ts` så att alla relevanta editor-state (mapShape, showLabels, posterBgColor, textVisible, textFont) följer med ordern.

### Filer som ändras

- `src/hooks/useCartSync.ts` eller `src/stores/cartStore.ts` — lägg till `_mapShape`, `_showLabels`, `_textVisible`, `_textFont`, `_posterBgColor` i cart line item properties (om saknas).
- `supabase/functions/shopify-order-webhook/index.ts` — läs nya cart properties + skicka i payload till `generate-print-file`.
- `supabase/functions/generate-print-file/index.ts` — tillämpa `noLabelStyleId`-mappning när `showLabels=false`. Bekräfta shape-clip-logik.

### Förberedelse för framtida bilder (kind: "image")

- Shape-clip-koden i `generate-print-file` är redan motiv-agnostisk → fungerar identiskt för `kind:"image"` (foto/AI). Inget extra behövs.
- Labels-frågan gäller bara `kind:"map"` — för bilder finns inga inbäddade labels att dölja.
- Text-overlay-koden är redan villkorad på `textVisible` → fungerar för båda.

### Verifiering

1. Gå in i editorn, välj cirkel-form + stäng av labels + lägg till text.
2. Lägg testorder via Bogus Gateway.
3. Öppna print-fil-URL från `gelato_orders` → ska visa cirkulär karta med vit bakgrund runt + ingen text-overlay för områdesnamn + din text-rad nedtill.
4. Gelato dashboard visar ordern.

### Limitations som dokumenteras

- Label-fri variant för custom Mapbox-stilar kräver att du skapar en parallel "no-labels"-stil i Mapbox Studio och lägger till mappningen i edge function. Görs som separat task vid behov.

