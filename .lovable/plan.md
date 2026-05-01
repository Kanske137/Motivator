## Mål
1. Ta bort den stora 3D-sektionen för canvas och göra 3D-previewn till en thumbnail i samma rad som de övriga mockup-thumbnails. Klick → öppna i samma lightbox/dialog.
2. Lägga till statiska "produktdetalj"-thumbnails i samma rad:
   - Canvas: 2 st (de uppladdade närbilderna på canvasens hörn/baksida).
   - Poster: 1 st (den uppladdade närbilden på papperskvalitén).
   Dessa visar produktkvaliteten generellt — de komponeras inte med användarens motiv.

## Layout (efter ändringen)

För **poster**:
```text
[Mockup vardagsrum] [Mockup sovrum] [Mockup kontor] [Mockup vägg] [Pappersdetalj]
```

För **canvas**:
```text
[3D-preview] [Mockup vardagsrum] [Mockup diagonal] [Mockup sovrum] [Mockup närbild] [Canvas-detalj 1] [Canvas-detalj 2]
```

Alla är samma storlek (32×32 / 40×40 som idag), horisontellt scrollande rad. Klick på vilken som helst → samma lightbox-dialog som redan finns. 3D-thumbnailen visar en statisk render (samma snapshot, men med en liten 3D-ikon som overlay) och öppnar då en dialog med den interaktiva Three.js-vyn istället för en bild.

## Filer att ändra/skapa

**Nya assets** (kopieras från uppladdningar till `src/assets/product-details/`):
- `canvas-corner.webp` (Canvas1-2.webp)
- `canvas-back.webp` (Canvas2.webp)
- `poster-paper.webp` (Posterthumbnail-2.webp)

**Ny komponent**: `src/components/editor/ProductDetailScene.ts` (eller liknande) — exporterar en lista med statiska detalj-thumbnails per produkttyp. Enkel struktur: `{ id, label, src, productType }`.

**Ändras**: `src/components/editor/MockupGallery.tsx`
- För canvas: rendera även mockup-scenerna (idag returneras `null` → 3D direkt). Lägg till en "3D"-thumbnail som första item.
- För båda: appenda statiska detalj-thumbnails sist i raden.
- Lightbox-dialogen utökas så att om vald slot är "3D" så renderas `<Canvas3DPreview>` (utan dess egen border/header), annars en `<img>` som idag.

**Ändras**: `src/pages/EditorPage.tsx`
- 3D-sektionen (`<Canvas3DPreview>`) tas bort som egen sektion under editorn — den lever nu enbart i lightboxen via `MockupGallery`.

**Ändras**: `src/components/editor/Canvas3DPreview.tsx`
- Lägg till en "compact" eller "embedded" prop som tar bort den yttre `border-t`-wrappern och rubriken "3D-förhandsvisning" så komponenten kan renderas rent inuti en dialog. Behåll bakåtkompatibilitet.

## Tekniska detaljer

- Canvas-mockup-scenerna (`CANVAS_SCENES` i `mockup-scenes.ts`) finns redan men används inte idag eftersom `MockupGallery` returnerar tidigt med 3D för canvas. De återanvänds nu via samma `compositeMockup`-pipeline som för posters.
- 3D-thumbnailen: enklast är att visa `snapshotUrl` (snapshot inkl. wrap+bleed) cropad till frontens area som "preview" plus en liten "3D"-badge (lucide `Box`-ikon i hörn). Klick öppnar dialog → renderar `<Canvas3DPreview embedded printUrl={snapshotUrl} ... />`.
- Detalj-thumbnails: bara `<img>`. När de öppnas i lightboxen visas samma bild i full storlek, ingen Three.js.
- Dialogens befintliga prev/next-navigering ska fungera över alla typer av slots (mockup, 3D, detalj).

## Verifiering
- Poster: 4 mockups + 1 pappersdetalj i thumbnail-raden. Lightbox prev/next loopar genom alla 5.
- Canvas: 1 3D + 4 mockups + 2 detaljer i raden. Klick på 3D-thumbnail → interaktiv 3D-vy i dialog (rotera fungerar). Klick på övriga → bild i dialog. Editor-sidan har inte längre den fasta 3D-sektionen under editorn.
