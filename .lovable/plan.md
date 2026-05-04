# Posterhängare — 4 nya varianter i poster-flödet

## Vad som byggs
4 nya "hängare"-varianter som beter sig som ramvarianter i poster-flödet, men ritas som **trälist topp + botten + snöre** istället för en omslutande ram. Samma storleksval som befintliga posters. Visas i editor-Preview, mockups och cart-bilder. **Aldrig** bakade i tryckfilen.

## Varianter
- **Hängare Ek** — `#c8a371`
- **Hängare Valnöt** — `#5a3a26`
- **Hängare Svart** — `#1a1a1a`
- **Hängare Vit** — `#f5f5f2`

Pris (tills vidare): samma som motsvarande befintlig ram per storlek (Ek/Valnöt/Svart/Vit). Lätt att uppdatera senare i `pricing.ts`.

## Tekniska ändringar

### 1. `src/lib/pricing.ts`
- Utöka `POSTER_FRAMES` till `["Ingen","Vit","Svart","Ek","Valnöt","Hängare Ek","Hängare Valnöt","Hängare Svart","Hängare Vit"]`.
- Lägg till de 4 nya nycklarna i varje rad i `POSTER_PRICES` med samma värde som motsv. ram-färg.

### 2. Variantigenkänning
- Ny helper `isHangerVariant(name)` i `src/lib/mockup-scenes.ts`.
- Ny helper `hangerColorFromVariant(name)` som returnerar hex för listen (samma 4 färger som ramarna).
- `frameColorFromVariant` returnerar **null** för hängare (så ingen omslutande ram ritas).

### 3. Procedural rendering — `src/lib/template-snapshot.ts`
Efter befintligt frame-block (rad ~660), lägg till ett `hanger`-block som körs när `input.hangerColor` är satt och `input.hires === false`:
- Topp-list: rektangel `width = posterW`, `height ≈ 0.6 cm × PX_PER_CM × scale`, placerad strax ovanför postern.
- Botten-list: identisk, strax under postern.
- Snöre: tunn båge (quadratic curve) från topp-listens vänsterkant till högerkant, böjd uppåt ~1.5 cm.
- Färg från `hangerColor`. Vit list får tunn grå kontur för synlighet på vit bakgrund.
- I print-grenen (rad ~750): tvinga `hangerColor: undefined` precis som `frameColor` — säkerställer att tryckfilen är ren.

### 4. Mockup-composite — `src/lib/mockup-composite.ts`
- Ta emot `hangerColor` i input, sätt `frameWpx = 0` när hängare används (postern ska ligga direkt mot scenen utan ram-padding).
- Efter att postern ritats (efter rad ~193), rita topp/botten-list + snöre med samma proportioner som template-snapshot.

### 5. Editor-UI — `src/components/editor/FormatSection.tsx` + `FrameOption.tsx`
- `FRAME_THUMBS`: lägg till 4 hängar-thumbnails (procedurella SVG:er inline, eller återanvänd ram-thumbnails som färgreferens).
- Ändra label från "Ram" till "Ram / Hängare" när poster har hängar-varianter aktiva.
- Grid: byt till `grid-cols-3` när antal varianter > 6 (annars överfullt på mobil).

### 6. Anrops-uppdateringar
- `MockupGallery.tsx`: läs `hangerColor = hangerColorFromVariant(variant)`, skicka med i composite-anropet.
- `MapPreview.tsx` / `editor-snapshot.ts`: skicka `hangerColor` till `renderTemplateSnapshot` (preview/cart-pipeline). Print-pipeline rör vi inte — den passerar redan `hires: true` och nollställer overlays.

### 7. Admin (ProductOptionsSection)
- `allowedFrames` för poster bör nu kunna inkludera de 4 nya namnen — verifiera att admin-listan plockar upp dem från `POSTER_FRAMES` automatiskt (den läser konstanten).

## Vad som INTE ändras
- `src/lib/print-pipeline.ts` och `template-snapshot` print-grenen — hängare bakas aldrig i tryckfilen.
- Gelato SKU-map — du fyller på senare. Webhook kommer svara `sku_not_found` för hängar-ordrar tills dess (medvetet val).
- Storleks-/orienteringslogik — oförändrad.

## ASCII av hur en hängare ser ut i preview

```text
   ╭──────────────────╮      ← snöre (tunn båge)
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓      ← topp-list (färgad)
   │                  │
   │     POSTER       │
   │                  │
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓      ← botten-list (färgad)
```

## Resultat
Kund väljer "Hängare Ek" i ram-väljaren → preview, mockups och cart-bilder visar postern med träliste-hängare i vald färg. Tryckfil = bara motivet. Pris matchar motsvarande ram tills du levererar slutgiltig prislista.