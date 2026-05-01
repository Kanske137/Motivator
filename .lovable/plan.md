# Fix: Akryl-skruvar saknas i preview/editor

## Problem
De fyra silverskruvarna (1.5 cm diameter, 1.4 cm in från hörnen) som rendreras IRL på Gelatos akrylglas-print syns inte:

1. **Mockup-gallerietsförhandsbilder** (`MockupGallery.tsx`) – snapshoten som komponeras in i rumsmiljöerna saknar skruvarna eftersom `acrylicCorners`-flaggan aldrig skickas till `renderTemplateSnapshot`.
2. **Designytan i editorn** (`MapPreview.tsx`) – `<AcrylicCornerOverlay/>` renderas redan villkorligt på `isAcrylic`, men i praktiken syns den inte. Trolig orsak: `padding: innerPadding` på frame-divens style + att overlayns parent-div har `position: relative` men overlayn använder `inset-0` – verifierat att den ligger högst upp (zIndex 50). Vi förstärker positioneringen så den alltid täcker hela frame-rektangeln, även när padding/border finns, och garanterar att den ritas över alla interna lager.

## Ändringar

### 1. `src/components/editor/MockupGallery.tsx`
Skicka med `acrylicCorners: config.product_type === "acrylic"` till `renderTemplateSnapshot` (rad ~77). Då bakas skruvarna in i den snapshot som sedan komponeras in i alla mockup-scener — exakt samma flöde som cart-bilden i `EditorPage`.

### 2. `src/components/editor/MapPreview.tsx`
- Säkerställ att `<AcrylicCornerOverlay/>` ligger som **sista barn** i frame-diven så den alltid renderas över allt annat innehåll (är redan i botten av JSX, men double-check efter alignment-guides).
- Höj overlays `zIndex` till `60` så den inte krockar med ev. dragghandtag (zIndex 39) eller margin (40) eller guides (10000 — den ska ligga UNDER guides).
- Justera så overlayns absoluta position räknas mot själva frame-rektangelns inner-content-box (om `padding`/`border` finns) genom att lägga overlayn i en wrapper med `position:absolute; inset:0; pointer-events:none` direkt under frame-diven, snarare än att förlita sig på `<AcrylicCornerOverlay/>`s eget `inset-0` som påverkas av padding.

### 3. (Bonus) `src/components/admin/TemplateThumbnail.tsx`
Lägg till stöd för `productType === "acrylic"`: rendera 4 små grå cirklar i hörnen så även admin-thumbnailen visar att det är akryl. Mycket lätt – återanvänd `AcrylicCornerOverlay` med `frontWcm/frontHcm` baserat på en standardstorlek (30×40).

## Vad som INTE ändras
- `template-snapshot.ts` – logiken för att rita skruvarna finns redan och fungerar; vi ska bara aktivera `acrylicCorners`-flaggan från fler call sites.
- Print-pipeline / hires-snapshots – skruvarna fortsätter att vara explicit avstängda i tryckfiler (`acrylicCorners: false`).
- Posters/canvas/aluminium berörs inte alls.

## Verifiering efter implementation
1. Skapa eller öppna en akryl-mall i editorn → fyra silverdiskar ska synas i hörnen i designytan.
2. Mockup-galleriet längre ner ska visa rummet med en akryl-tavla där skruvarna också syns.
3. Cart-bilden (när man lägger i varukorg) visar redan skruvarna – ingen regression där.
4. Tryckfilen som skickas till Gelato ska INTE innehålla skruvar.
