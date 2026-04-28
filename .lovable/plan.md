# Vit marginal: kund-toggle "Ja/Nej" som expanderar designytan

## Vad som byggs

I kundeditorns Format-flik, direkt under "Bakgrundsfärg", ett nytt block **"Vit marginal"** med två pill-knappar (Ja / Nej) på samma rad. Visas bara om mallen har minst ett `margin`-lager i aktiv orientering. Default = **Ja** (admins marginal är aktiv). Vid **Nej**:

1. Margin-lagret göms helt (inte renderat — varken i live preview, mockups, cart-thumbnail eller printfilen).
2. Alla övriga lager skalas proportionerligt utåt så att den tidigare innanför-marginalen-ytan blir hela 0–100%-ytan.
3. Aspect ratio per lager bevaras (vi mappar varje lagers rect via samma per-axel-skala — oavsett att margin är symmetrisk i % av kortsidan, så blir x-skalan och y-skalan olika tal för icke-kvadratiska kartor; varje lagers individuella w/h-aspekt bevaras eftersom alla lager mappas med samma transform).
4. Ändringen syns överallt: live preview, MockupGallery (2D + 3D-canvas), cart-thumbnail och Gelato-printfilen.

## Tekniska detaljer

### Ny store-yta
`editorStore.ts`:
- `whiteMarginEnabled: boolean` (default `true`).
- `setWhiteMarginEnabled(v: boolean)`.
- Återställs till `true` vid `setConfig` och `setOrientation` (samma livscykel som `layerTransforms`).

### Helper: marginInsets (per axis, %)
Ny helper i `layer-utils.ts`:
```ts
getActiveMarginInsetsPct(layers, frontWcm, frontHcm): { left, right, top, bottom } // %
```
- Hittar första `margin`-lagret bland `layers` (admin sätter typiskt 0/0/100/100 + `defaults.thicknessPct` i % av **kortsidan**).
- Konverterar `thicknessPct` (av kortsida) till per-axel-procent av canvas:
  - `shortCm = min(frontW, frontH)`
  - `marginCm = thicknessPct/100 * shortCm`
  - `leftPct = rightPct = marginCm / frontWcm * 100`
  - `topPct = bottomPct = marginCm / frontHcm * 100`
- Om inget margin-lager finns → returnerar `{0,0,0,0}`.

### Helper: expandLayerRectIfMarginRemoved
Ny helper i `layer-utils.ts`:
```ts
expandRectForRemovedMargin(rect, insets) -> rect
```
För varje icke-margin-lager: mappa `xPct/yPct/wPct/hPct` från "andel av hela canvas" → "andel av hela canvas EFTER att inner-rektangeln (insets) blivit ny 0..100".
- `innerW = 100 - insets.left - insets.right`
- `innerH = 100 - insets.top - insets.bottom`
- Nya `xPct = (oldXPct - insets.left) / innerW * 100`
- Nya `yPct = (oldYPct - insets.top) / innerH * 100`
- Nya `wPct = oldWPct / innerW * 100`
- Nya `hPct = oldHPct / innerH * 100`
- Sedan `clampLayerRect` för säkerhets skull.

Note: Lager som ligger HELT inom marginalen (admin-typiska kart-/textlager) får sina koordinater i [0,100] efter mappning. Lager som råkar överlappa marginalen klamps; det är acceptabelt, admin förväntas ändå inte placera lager ovanpå marginalen.

### Integration i `effectiveLayerRect`
Utvidga signatur:
```ts
effectiveLayerRect(layer, transforms, opts?: { marginRemovedInsets?: Insets })
```
Om `marginRemovedInsets` ges OCH lagret inte är `margin`: applicera `expandRectForRemovedMargin` på resultatet (efter transform-merge). Margin-lagret hoppas över helt av callers när `whiteMarginEnabled === false`, så insets-mappningen rör inte det.

### MapPreview (live editor)
`src/components/editor/MapPreview.tsx`:
- Läs `whiteMarginEnabled` + `templateLayers()`.
- Beräkna `insets` via `getActiveMarginInsetsPct(layers, frontW, frontH)`.
- Filtrera bort margin-lager om `!whiteMarginEnabled`.
- Skicka `marginRemovedInsets: !whiteMarginEnabled ? insets : undefined` till `effectiveLayerRect` i `layerToEditorRect`.
- `onDragStart` använder samma effective rect så drag fortsätter funka i det nya koordinatsystemet.

### MockupGallery + EditorPage (snapshot/3D/cart)
Skicka in `whiteMarginEnabled` till `renderTemplateSnapshot`-anropen och Canvas3DPreview (som använder samma snapshot).

### template-snapshot.ts
- Ny input-flagga: `whiteMarginEnabled?: boolean` (default `true`).
- I render-loopen: när `whiteMarginEnabled === false`:
  1. Skippa alla `margin`-lager.
  2. Beräkna `insets` från `template.defaultLayout[orientation].layers` + frontW/frontH.
  3. Vid varje lager-rect-beräkning: applicera `expandRectForRemovedMargin` efter transform-merge, innan rect konverteras till px.
- Ändringen täcker automatiskt printfilen (samma path som mockup/cart).

### FormatSection UI
`src/components/editor/FormatSection.tsx`:
- Lägg till nytt block direkt under "Bakgrundsfärg":
  ```
  Vit marginal
  [ Ja ] [ Nej ]
  ```
  Med samma pill-stil som "Produkt"/"Orientering"-toggles (`flex p-1 bg-muted rounded-full`, `flex-1 h-10`).
- Visas bara om `template.defaultLayout[orientation].layers.some(l => l.type === "margin")`.
- Bind till `whiteMarginEnabled` + `setWhiteMarginEnabled`.

## Filer som ändras

- `src/stores/editorStore.ts` — `whiteMarginEnabled` state + setter, reset i `setConfig`/`setOrientation`.
- `src/lib/layer-utils.ts` — `getActiveMarginInsetsPct`, `expandRectForRemovedMargin`, utvidgad `effectiveLayerRect`.
- `src/components/editor/MapPreview.tsx` — filtrera margin-lager + skicka insets till rect-beräkning.
- `src/components/editor/MockupGallery.tsx` — skicka `whiteMarginEnabled` till snapshots.
- `src/pages/EditorPage.tsx` — skicka `whiteMarginEnabled` i cart-thumbnail-snapshot + print-pipeline.
- `src/lib/template-snapshot.ts` — ny `whiteMarginEnabled`-prop, hoppa margin-lager, expandera rects.
- `src/components/editor/FormatSection.tsx` — Ja/Nej-toggle UI.

## Ej i scope

- Admin kan fortfarande inte ändra default-värdet på `whiteMarginEnabled` (det följer alltid om mallen har en margin = "Ja" som default). Säg till om du vill att admin ska kunna styra defaulten — det är ett snabbt tillägg om så.
- Margin-lagrets själva färg/tjocklek ändras inte; toggla är binärt.
