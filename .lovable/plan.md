

# Mapiful-inspirerad UX + fixar för karta, text och sök

## 1. Fixa kartan (kritisk bugg)

**Problem**: `containerRef` sätts inuti en `.map()` som filtrerar layout-lager → ref:en blir inte stabil och kartan får ingen container.

**Fix** i `MapPreview.tsx`:
- En enda stabil `<div ref={mapContainerRef}>` renderas alltid, positionerad absolut enligt det första `map`-lagret från config (eller fyller hela ytan som fallback).
- Init-effekten kollar `mapContainerRef.current` direkt.
- Lägg till `map.on("load", () => map.resize())` för att garantera korrekt rendering.
- Behåll text-overlay-loopen separat.

## 2. Auto-uppdatera text när plats väljs

**Problem**: `setPlaceName` rör inte `text`.

**Fix** i `editorStore.ts`:
- Ny action `applyPlace({ placeName, center })` som sätter `mapCenter`, `placeName` OCH genererar default-text:
  ```
  {STAD I VERSALER}
  {Land}
  {lat.toFixed(4)}°N · {lng.toFixed(4)}°E
  ```
- En flag `textIsCustom` (sätts true så fort användaren själv editerar texten) — då skriver `applyPlace` INTE över texten.
- `ControlPanel` `onPick(r)` anropar `applyPlace` istället för separata setters.

## 3. Live-sökförslag (debounce, ingen Enter)

I `ControlPanel.tsx`:
- `useEffect` på `query` med 300 ms debounce → kallar `geocode` automatiskt så fort man skriver ≥2 tecken.
- Visar förslag i en dropdown direkt under inputen.
- Ta bort sök-knappen (eller behåll som dekorativ ikon i input-fältet).

## 4. Mapiful-likt visuellt (UX-revamp)

**Färg & yta**:
- Tona ner till en **ljus, pappersaktig bakgrund** för preview-området (`bg-[#f6f3ee]` / varm beige likt Mapiful).
- Kontrollpanelen: ren vit, mjuka rundningar, mer luft, tunnare avgränsningslinjer.
- Accent-färg: en dämpad mörkblå/grafit för aktiv state (inte den nuvarande primary).
- Uppdatera `index.css` HSL-tokens: `--background`, `--card`, `--primary`, `--accent` för en lugnare palett.

**Vänster ikon-rail (Mapiful-stil)** *(valfritt v1, men vi lägger grunden)*:
- Smal vertikal rail (60-72px) längst till vänster på desktop med ikoner: Plats, Stil, Text, Format. Klick byter aktiv sektion i kontrollpanelen (istället för accordion). På mobil → accordion som idag.
- För nu: enkel tab-struktur i panelen, ikon-rail som progressive enhancement.

## 5. Kontrollpanelens ordning

Ny ordning (Format längst ner enligt önskemål):
1. **Plats** (sök + zoom)
2. **Kartstil** (thumbnails)
3. **Text** (input + font + visa/dölj)
4. **Format** (Produkt → Storlek → Ram/Djup → Orientering)

## 6. Storlek som dropdown

I `FormatSection.tsx`:
- Byt grid med knappar mot en `<Select>` (shadcn) för storlek.
- Visar storleken + prisdiff från minsta storleken: `13×18 cm` / `30×40 cm  +60 kr`.

## 7. Ramar som bilder + prisdiff

**Assets**: Kopiera de fyra uppladdade bilderna till `src/assets/frames/`:
- `frame-white.jpg` (bild 2)
- `frame-oak.jpg` (bild 3)
- `frame-walnut.jpg` (bild 4)
- `frame-black.jpg` (bild 5)
- "Ingen ram" → en enkel SVG-ikon (tom ram-kontur).

**UI** i `FormatSection.tsx`:
- Grid 3 kolumner: varje ram-val är en knapp med thumbnail (aspect-square, rundad), namn under, och prisdiff vs aktuell vald variant: `+150 kr`, `−40 kr`, `Ingen extra`.
- Aktiv: ring + fyllt selected-state.
- Canvas djup (2cm/4cm): liknande knappar med enkel SVG-illustration som visar djupet (2 rektanglar med olika tjocklek).

**Prisdiff-logik** (helt beräknad, inget hårdkodat):
- `priceDiff(option) = priceForOption − priceForCurrentSelection`
- Format `+150 kr` / `−40 kr` / `Ingen extra` (för 0).
- Används både för storlek-dropdown och ram/djup-knappar.

## 8. Pris-display: bara differens, ingen total i UI

Plats där pris visas idag (sticky bottom på mobil + sidebar bottom på desktop):
- Behåll en stor "Lägg i varukorg"-knapp.
- Ovanför: visa **inte** totalsumman, utan en sammanfattning av valt format: `30×40 cm · Vit ram · Stående`.
- Prisdiffer visas inline vid varje val (storlek-dropdown och ram-bilder).
- Den faktiska totalsumman skickas fortfarande till cart i bakgrunden — bara dold från UI per önskemål.

> *Notera: om du senare vill ha totalsumman synlig nånstans (t.ex. liten i hörnet) säg till — nu döljs den helt enligt din formulering.*

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/editor/MapPreview.tsx` | Stabil map-container, fix för att kartan inte renderas |
| `src/components/editor/ControlPanel.tsx` | Live-sökdebounce, ny sektionsordning, anropar `applyPlace` |
| `src/components/editor/FormatSection.tsx` | Storlek = dropdown, ram = bild-knappar, prisdiff överallt, flyttad sist |
| `src/stores/editorStore.ts` | `applyPlace` action, `textIsCustom` flag, auto-genererad text |
| `src/lib/mapbox.ts` | `geocode` returnerar även land/region för text-generering |
| `src/pages/EditorPage.tsx` | Tar bort total-pris från sticky bar, ersätter med format-sammanfattning |
| `src/index.css` | Mjukare Mapiful-likt färgtema (warm-paper bakgrund, dämpad accent) |
| `src/assets/frames/*.jpg` (nya) | Fyra ramthumbnails kopierade från uppladdningarna |
| `src/components/editor/FrameOption.tsx` (ny) | Liten komponent för en ram-knapp med bild + namn + prisdiff |

## Ordning vid implementation

1. **Fix karta** (highest priority — utan den fungerar inget)
2. Auto-text vid platsval + `textIsCustom`-flag
3. Live-sök med debounce
4. Kopiera ram-bilder till `src/assets/frames/`
5. Bygg om `FormatSection` (dropdown + bild-ramar + prisdiff)
6. Flytta Format sist i panelen + ta bort total i sticky bar
7. Färgtema-uppdatering i `index.css` för Mapiful-känsla

Allt görs utan att röra config-strukturen i Supabase — den dynamiska config-renderingen från förra iterationen behålls intakt så vi kan bygga admin-sidan ovanpå senare.

