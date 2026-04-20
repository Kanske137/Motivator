
## Fix för tom live-editor, enkel accordion och synliga adressförslag

### 1. Fixa den tomma kart-/preview-ytan först
Huvudproblemet är att preview-boxen i `MapPreview.tsx` saknar en stabil, explicit storlek i portrait-läget:
- ytterboxen använder `aspectRatio`
- `width` blir `auto`
- innehållet är nästan bara absolut positionerat
- resultatet blir att render-ytan kan kollapsa till 0 höjd/bredd, så kartan aldrig syns

**Ändring**
- Byt till en wrapper med explicit area och stabil storlek, t.ex. med `AspectRatio` eller en container som alltid får verklig width/height.
- Låt previewn ha tydliga constraints som:
  - `w-full`
  - fast/max bredd på desktop
  - `max-h` relativt viewport
- Mapbox-containern ska alltid fylla den verkliga preview-ytan, inte en auto-beräknad box.

**I praktiken**
- `MapPreview.tsx`
  - ersätt nuvarande `width: orientation === "portrait" ? "auto" : "100%"` och `height: "auto"`
  - använd en stabil layout som alltid ger previewn dimensioner
  - behåll en enda `div ref={mapContainerRef}` för kartan
  - kalla `map.resize()` efter init, efter orientation-byte, och när config/layout ändras

### 2. Säkerställ att kartan ominitieras korrekt när config/layout finns
Just nu initieras kartan en gång direkt. Om config/layout kommer in efter första render finns risk att kartan skapas innan preview-ytan är korrekt uppmätt.

**Ändring**
- Låt init-effekten vänta tills:
  - `mapContainerRef.current` finns
  - `config/layout` finns
  - preview-boxen har faktiska dimensioner
- Lägg till guard så vi inte försöker skapa kartan i en 0x0-container
- Lägg till tydligare fel-logg om token saknas eller om containern saknar storlek

### 3. Gör accordionen till “en öppen i taget”
Nu används:
- `type="multiple"`

Det ska istället vara:
- `type="single"`
- `collapsible`
- ett aktivt `value`

**Ändring i `ControlPanel.tsx`**
- byt till single-accordion
- default: t.ex. `"plats"`
- när en ny sektion öppnas ska tidigare stängas automatiskt

### 4. Gör adressförslag okapade och alltid 4 synliga
Nu ligger förslagslistan absolut inuti en container som i praktiken begränsas av panelens scroll/overflow. Därför kapas listan.

**Ändring**
- Flytta sökförslagen till en portaled overlay/popover istället för vanlig absolut dropdown inne i panelen
- Använd t.ex. `Popover`/`Command`-mönster eller motsvarande portaled lista
- Visa exakt 4 förslag åt gången:
  - begränsa sökresultat till 4 i UI
  - ge listan höjd för 4 rader
  - scroll först om fler än 4 skulle finnas senare

**I praktiken**
- `ControlPanel.tsx`
  - rendera förslagen i en overlay som inte klipps av `aside` eller accordion-content
  - ge varje rad konsekvent höjd
  - använd `max-h` för exakt fyra rader
- `src/lib/mapbox.ts`
  - sänk gärna `limit=5` till `limit=4` så det matchar UX-kravet

### 5. Fixa React-varningarna om refs
Console visar:
- `NoFrameIcon`
- `MockupGallery`

Det tyder på att någon komponent används med `asChild`/ref-krav trots att den inte är `forwardRef`.

**Ändring**
- Gå igenom `FormatSection` och `EditorPage`
- se var funktionella komponenter skickas in i Radix/shadcn-komponenter som kräver ref
- byt till:
  - vanlig JSX-node
  - eller `forwardRef` där det verkligen behövs

Detta är sannolikt inte huvudorsaken till tom karta, men bör fixas samtidigt för stabilitet.

### 6. UI-justeringar som följer med fixen
När previewn väl renderar:
- behåll `Format` längst ner
- behåll live-sök
- se till att dropdown/popover har högre `z-index` än panel/sticky footer
- lås desktop-previewn så den alltid syns tydligt även för canvas i portrait

## Filer att ändra
- `src/components/editor/MapPreview.tsx`
  - stabil preview-box med explicit dimension
  - robust map-init + resize
- `src/components/editor/ControlPanel.tsx`
  - `Accordion` från `multiple` till `single`
  - portaled adressförslag
  - 4 synliga förslag
- `src/lib/mapbox.ts`
  - ev. `limit=4`
- `src/pages/EditorPage.tsx`
  - säkerställ att preview-sektionen tillåter full höjd/bredd för kartan
- `src/components/editor/FormatSection.tsx`
  - rensa ref-problemet kring ikon/rendering om det sitter där
- `src/components/editor/MockupGallery.tsx`
  - rensa eventuell ref-varning

## Prioriterad ordning
1. Fixa preview-dimensionerna i `MapPreview.tsx`
2. Säkra map-init först när container/layout har riktig storlek
3. Byt accordion till single-open
4. Flytta adressförslag till portaled dropdown
5. Begränsa till 4 synliga förslag
6. Rensa ref-varningarna

## Förväntat resultat efter ändringen
- live-editorn visar kartan igen
- endast en panelsektion är öppen åt gången
- adressförslag visas direkt medan man skriver
- förslagen kapas inte av panelen
- exakt fyra förslag får plats visuellt
