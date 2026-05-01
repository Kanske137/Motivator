Jag förstår korrigeringen: thumbnails är nu rätt, men det saknas i själva admin-designytan (`/admin/designer/...`) för akrylmallar. Dessutom ligger kundeditorns akryl-overlay för högt och hamnar ovanpå thumbnail/lightbox-element, vilket ska stoppas utan att skruvarna hamnar bakom designlagren.

Plan:

1. Lägg till akrylskruvar i admin-designytan
- Uppdatera `LayerCanvas` så den kan veta vilken produkttyp som redigeras.
- För `product_type === "acrylic"` renderas samma `AcrylicCornerOverlay` ovanpå admin-canvasen.
- Overlayn ska vara `pointer-events: none`, så den inte stör drag/drop, markering eller resize av lager.
- Den ska ligga över mallens lager i adminytan, men under adminens egna guider/selection-hjälp där det behövs.

2. Skicka produkttyp från admin-sidan
- Uppdatera `DesignerPage` så `LayerCanvas` får `productType={config.product_type}`.
- Canvas-logiken för canvas-wrap lämnas oförändrad.
- Poster, canvas och aluminium påverkas inte visuellt.

3. Begränsa z-index på kundeditorns skruvar
- Ändra `MapPreview` så akrylskruvarna bara skapar en lokal stacking context inne i själva produkt-/printytan.
- Sänk z-index från dagens nivå (`60`) till en nivå som fortfarande är över alla designlager, marginaler och former i själva printytan, men inte konkurrerar med dialoger, thumbnails, lightbox, controls eller övriga UI-element.
- Sätt vid behov `isolation: isolate` på produktens ram/container så interna z-index inte kan “läcka” över externa UI-element.

4. Behåll rätt exportbeteende
- Ingen ändring i tryckfilsgenerering: skruvarna ska fortsatt inte hamna i högupplöst tryckfil.
- Snapshot/mockup/cart-bild ska fortsatt kunna visa skruvarna som tidigare fix.

Teknisk riktning:
- Återanvänd `src/components/editor/AcrylicCornerOverlay.tsx` i adminytan för att få samma proportioner: centrum ca 1.4 cm från kant och diameter ca 1.5 cm.
- I adminytan används en rimlig designstorlek baserat på orientering/aspect, t.ex. 30×40 cm för stående 3:4 och 40×30 cm för liggande 4:3, så storleken blir proportionellt korrekt.
- I kundeditorn läggs overlayn inne i produktens relativa container och hålls inom en lokal stacking context.