

# Fas 2 — AI-stilar, foto-upload, Gelato-mockup-API, end-to-end checkout

Mål: Editorn ska stödja alla tre design-källor (karta / foto / AI-stil), visa professionella mockup-bilder från Gelato istället för lokala composites, och Shopify-checkout ska faktiskt fungera mot riktiga produktvarianter.

---

## Steg 1 — Foto-upload som design-källa

Idag: store har `photoFile`/`setPhotoSource` men ingen UI för det. Print-pipelinen klarar källan redan.

- Ny komponent `src/components/editor/PhotoUploadSection.tsx`: drag-and-drop + filväljare (jpg/png/webp/heic, max 25 MB). Visar miniatyr + "Ta bort foto"-knapp.
- Lägg en ny accordion-sektion **"Bild"** i `ControlPanel.tsx` ovanför "Plats". Sektionen visas bara om mallen har minst ett map-lager (foto ersätter kartytan).
- När foto valt: `setPhotoSource(file, previewUrl)` → `designSource="photo"`. `MapPreview` visar fotot i map-lagrens form (cirkel/hjärta/stjärna) istället för Mapbox.
- Uppdatera `MapLayerInstance.tsx` så att om `designSource==="photo"` renderas `<img>` med `object-fit: cover` clippad av samma SVG-shape istället för mapbox-canvas. Pan/zoom inom fotot via samma drag-handlers (offset-state per lager).
- "Återgå till karta"-knapp anropar `resetDesignSource()`.

Filer: `PhotoUploadSection.tsx` (ny), `ControlPanel.tsx`, `MapLayerInstance.tsx`, `MapPreview.tsx`.

---

## Steg 2 — AI-stilar (Replicate Flux Kontext Pro)

Edge-funktionen `replicate-style` finns och returnerar `printFileUrl` direkt. Saknas: UI + admin-konfiguration av presets.

### 2a. Admin: AI-stil-presets per produkt
- Schema-tillägg i `template-schema.ts`: `productOptions.aiStyles?: { id, label, thumbnailUrl, prompt }[]`.
- Ny sektion i `ProductOptionsSection.tsx`: lista AI-stil-presets, lägg till/ta bort, redigera label + prompt + ladda upp thumbnail (uploadas till `cart-previews`-bucket via `uploadCartPreview`).
- Default-presets seedas (Akvarell, Skiss, Olja, Pop-art, Linjeart, Vintage poster) första gången admin öppnar fliken om listan är tom.

### 2b. Kund: AI-stil-galleri
- Ny komponent `src/components/editor/AiStyleSection.tsx` — visas i `ControlPanel` när `designSource === "photo"` OCH foto är valt. Grid med thumbnail-knappar.
- Vid klick: anropa `supabase.functions.invoke("replicate-style", { body: { imageUrl, prompt, designId }})` med kundens uppladdade foto (eller dess uppladdade URL). Visa loading-spinner per knapp.
- Vid svar: `setAiPrintFileUrl(printFileUrl)` → `designSource="ai"`. `MapPreview` visar AI-bilden inom samma form.
- Foto-URL till Replicate: ladda upp originalfotot till `cart-previews`-bucket en gång (lazy) så Replicate kan hämta den.
- "Ångra AI"-knapp → `setPhotoSource(photoFile, previewUrl)` (tillbaka till foto utan stil).

Filer: `template-schema.ts`, `ProductOptionsSection.tsx`, `AiStyleSection.tsx` (ny), `ControlPanel.tsx`, `editorStore.ts` (lägg till `originalPhotoUrl` cachning).

---

## Steg 3 — Gelato Mockup Generator API för posters

Nuvarande `compositeMockup` (lokal canvas-blandning av interiörbilder) är amatörmässig och ramen renderas platt utan riktig perspektiv. Gelato har ett produktion-mockup-API.

- Ny edge-funktion `supabase/functions/gelato-mockup/index.ts`:
  - Body: `{ productUid, printFileUrl }` → POST till `https://product-api.gelatoapis.com/v3/products/{productUid}/mockups` med `imageUrl`. Returnerar fält av mockup-URL:er.
  - Cachar resultat i en ny Supabase-tabell `mockup_cache(product_uid, print_file_url, mockup_urls jsonb, created_at)` så identiska poster+motiv inte renderas om.
- Ersätt `MockupGallery.tsx`-flödet (när `productType==="posters"`):
  1. Skapa snapshot via `renderTemplateSnapshot` (som nu).
  2. Ladda upp som temporary print-URL till `print-files`-bucket.
  3. Anropa `gelato-mockup` med produktens `productUid` (resolvat från `gelato-sku-map.json` via befintlig `resolveProductUid`).
  4. Visa returnerade scen-URLs i samma swipe-galleri.
- Behåll `compositeMockup` som fallback om API:t fallerar (offline / saknad UID).

Migration: `mockup_cache`-tabell + RLS (public read, service-role write).

Filer: `gelato-mockup/index.ts` (ny edge), `MockupGallery.tsx`, ny migration.

---

## Steg 4 — 3D Canvas-preview-polish

Idag fungerar 3D-vyn men är statisk. Önskemål:

- Auto-rotation från sida till framsida vid första laddning (1.5 s ease-out → vila i frontvy).
- Mjuk realistisk skugga — ersätt `ContactShadows` med `AccumulativeShadows` + en HDR-environment (`useEnvironment` med `studio.hdr` från drei) för riktig duk-textur.
- Liten "vägg + golvlist"-bakgrund istället för platt färg (en enkel plane + ljusa pastell-toner).
- Behåll OrbitControls för manuell rotation.

Fil: `Canvas3DPreview.tsx`.

---

## Steg 5 — Shopify-checkout end-to-end

Idag: `EditorPage.tsx` skickar `gid://shopify/ProductVariant/preview-${size}-${variant}` till cart-storen. Det är en sträng, inte en riktig variant → checkout-länken kommer fungera men varianten är ogiltig.

- I `ControlPanel`/`FormatSection` när storlek + variant valts: slå upp den verkliga Shopify variant-ID:n via Storefront API.
  - Ny edge-helper i `shopify-storefront/index.ts` (befintlig proxy fungerar — bara skicka rätt query): GraphQL `productByHandle(handle).variants` matchat på `selectedOptions` (Storlek + Ram/Djup).
  - Cache i `editorStore` (`shopifyVariantId: string | null`) som uppdateras när handle/size/variant ändras.
- `handleAddToCart` använder den riktiga `variantId` (`gid://shopify/ProductVariant/<numeric>`) istället för fake-strängen. Lämnar in `attributes` (cart line attributes) — alla `_print_file_url`, `_size`, etc. som idag.
- Verifiera att webhook fortsatt mottar properties: shopify cart line `attributes` blir `note_attributes` på order line items — detta kontrollerades fungera redan i webhook.
- Toast på fel: om variant inte hittas (t.ex. produkten är inte publicerad i Shopify) → visa "Denna kombination är inte tillgänglig i butiken ännu" och blockera knappen.

Filer: `EditorPage.tsx`, `editorStore.ts`, `cartStore.ts` (ingen ändring förväntas), ev. ny helper `src/lib/shopify-variant-resolver.ts`.

---

## Steg 6 — Order-flöde-validering

Snabb verifikation av befintlig webhook → Gelato-pipeline med ett verkligt köp:

- Bekräfta att `_print_file_url` faktiskt landar i Shopify order line `note_attributes` (kontrollera via webhook-logg vid testbeställning).
- Lägg till en "Beställnings­status"-tabell i `AdminConfigs.tsx` som visar senaste 20 raderna i `gelato_orders` (status, error, gelato_order_id, ts) — read-only, hjälper admin se om något fail. Bygger på enklast möjliga `select`.

Filer: `AdminConfigs.tsx`.

---

## Filer (sammanställning)

| Fil | Ändring |
|---|---|
| `src/components/editor/PhotoUploadSection.tsx` | NY — uppladdning + miniatyr |
| `src/components/editor/AiStyleSection.tsx` | NY — preset-grid + Replicate-anrop |
| `src/components/editor/ControlPanel.tsx` | Lägg till Bild + AI-stil sektioner |
| `src/components/editor/MapPreview.tsx` + `layers/MapLayerInstance.tsx` | Foto/AI-källa renderas i shape |
| `src/components/editor/MockupGallery.tsx` | Posters → Gelato mockup API |
| `src/components/editor/Canvas3DPreview.tsx` | HDR + auto-rotation + miljö |
| `src/components/admin/ProductOptionsSection.tsx` | AI-presets-editor |
| `src/lib/template-schema.ts` | `aiStyles` i productOptions |
| `src/lib/shopify-variant-resolver.ts` | NY — handle+options → variantId |
| `src/stores/editorStore.ts` | `originalPhotoUrl`, `shopifyVariantId` |
| `src/pages/EditorPage.tsx` | Använd riktig variantId i addItem |
| `src/pages/AdminConfigs.tsx` | Senaste gelato-orders-tabell |
| `supabase/functions/gelato-mockup/index.ts` | NY edge för mockup-API |
| `supabase/migrations/...` | `mockup_cache`-tabell + RLS |

---

## Verifiering

1. **Foto**: Ladda upp ett JPG → fotot visas inom hjärt-formen i editorn → "Lägg i varukorg" → tryckfilen i `print-files` är originalfotot oförändrat.
2. **AI**: Foto → klick på "Akvarell"-preset → loading 5–15 s → bild ersätts med stiliserad version → tryckfilen är AI-bilden.
3. **Mockup**: Posters visar minst 4 Gelato-mockup-bilder (kontrollerad mot Network-flik). Andra gången samma motiv laddas → cache-hit (snabbare svar).
4. **3D-preview**: Canvas roterar in från sidan, stannar i framsidesvy, går att rotera manuellt; skuggan är mjuk och realistisk.
5. **Checkout**: Lägg i varukorg → öppna kassan i ny flik → korrekt produkt + variant + alla custom attributes är synliga i Shopify-order. Webhooken triggar Gelato-order med rätt productUid + printFileUrl. Statusen "submitted" visas i `AdminConfigs`-vyn.
6. **Befintliga single-layer-poster fungerar oförändrat** — ingen visuell regression.

---

## Förslag på arbetsordning

1. Steg 5 (riktig variant-checkout) — kortast väg till en fungerande end-to-end-beställning, blockerar inget annat.
2. Steg 1 (foto-upload) → Steg 2 (AI-stil) — bygger på varandra.
3. Steg 3 (Gelato-mockup) — visuell uppgradering, oberoende av 1+2.
4. Steg 4 (3D-polish) — kosmetiskt, kan vänta.
5. Steg 6 (admin-vy) — operativt, sist.

Vill du att jag kör i den ordningen, eller prioritera om någon del?

