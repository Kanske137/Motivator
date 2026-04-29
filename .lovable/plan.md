# Plan: Förfinad karttext-länkning + utbyggd typsnittshantering

## 1. Per-fält val för länkad karttext

Idag, när en text-layer länkas till en karta, sätts hela texten till tre rader (STAD, LAND, koordinater). Vi gör det möjligt att per text-layer välja vilka av dessa rader som ska inkluderas.

### Schema (`src/lib/template-schema.ts`)
Lägg till på `textDefaultsSchema`:
```ts
linkedMapFields: z.object({
  city: z.boolean().default(true),
  country: z.boolean().default(true),
  coordinates: z.boolean().default(true),
}).optional(),
```
Optional för bakåtkompabilitet — saknas fältet behandlas det som "alla tre på" (nuvarande beteende).

### Admin UI (`src/components/admin/LayerInspector.tsx`)
Direkt under "Länka till karta"-selecten, när `linkedMapLayerId` är satt: visa tre `Checkbox`-rader:
- [x] Stad / ort
- [x] Land
- [x] Koordinater

Uppdaterar `linkedMapFields` via `updateDefaults`.

### Auto-text-generering
`buildAutoText` finns på två ställen — refaktorera till att ta ett valfritt `fields`-objekt:

- `src/stores/editorStore.ts` (rad ~230 och ~790): `applyPlaceInternal` läser layerns `linkedMapFields` och skickar till `buildAutoText`.
- `src/lib/template-migrate.ts` (rad ~232 och ~252): samma sak när texten initialiseras från admin-default place.

`buildAutoText(args, fields)` filtrerar bort de rader vars flagga är `false`. Saknas `fields` → alla tre med (oförändrat beteende).

## 2. Utbyggd typsnittskatalog + per-template låsning av kundval

### Ny fontkatalog (`src/lib/font-catalog.ts` — ny fil)
Definierar ~25-30 kuraterade Google Fonts grupperade i kategorier (Sans, Serif, Display, Script, Mono). Varje post: `{ family, category, googleSpec }`.

Exempel (urval): Inter, Roboto, Open Sans, Montserrat, Poppins, Lato, Nunito, Work Sans, DM Sans, Manrope · Playfair Display, Cormorant Garamond, Lora, Merriweather, EB Garamond, Crimson Text, Libre Baskerville · Bebas Neue, Oswald, Abril Fatface, Archivo Black, Anton · Dancing Script, Great Vibes, Pacifico, Caveat, Sacramento · JetBrains Mono.

Genererar också en `GOOGLE_FONTS_HREF` med alla familjer i en `fonts.googleapis.com/css2`-URL.

### Font-loading (`index.html`)
Ersätt nuvarande hårdkodade `<link href="...family=Cormorant+Garamond&family=Inter...">` med en `<link>` mot hela katalogen. Alternativt lazy-load via en liten effekt i `App.tsx` som injicerar samma URL — vi väljer hårdkodad i `index.html` för enkelhet och cachning.

### Admin: typsnittsväljare visad i typsnittet (`LayerInspector.tsx`)
- Ersätt `config.text_config.fonts` som källa med `FONT_CATALOG`.
- Varje `<SelectItem>` sätter `style={{ fontFamily: f.family }}` så namnet renderas i sitt eget typsnitt.
- Gruppera per kategori med `SelectGroup`/`SelectLabel` för läsbarhet.

### Admin: välj vilka typsnitt kunden får använda
Ny sektion i `ProductOptionsSection.tsx` (visas på Designer-sidan): "Tillåtna typsnitt för kunden". Multi-select-popover med checkboxes över hela `FONT_CATALOG`, namn renderade i eget typsnitt.

Lagras i `template.productOptions.allowedFonts: string[]` (ny optional zod-array; tom/utelämnad → kunden får hela katalogen så befintliga mallar inte går sönder).

### Schema-tillägg
I `productOptionsSchema`:
```ts
allowedFonts: z.array(z.string()).optional(),
```

### Kundeditor (`src/components/editor/ControlPanel.tsx` rad ~506-524)
- Läs `template.productOptions.allowedFonts ?? FONT_CATALOG.map(f => f.family)` istället för `config.text_config.fonts`.
- Knapparna får `style={{ fontFamily: f }}` (redan idag), oförändrat — så kunden ser typsnittet.

### Bakåtkompabilitet
- `text_config.fonts` (legacy) lämnas orört i DB; vi slutar bara läsa det. Ingen migration krävs.
- Befintliga mallar utan `allowedFonts` → hela katalogen tillgänglig (rimligt default; admin kan strama åt).

## Filer som ändras
- `src/lib/template-schema.ts` — `linkedMapFields`, `allowedFonts`
- `src/lib/font-catalog.ts` — ny
- `index.html` — utökad Google Fonts-länk
- `src/components/admin/LayerInspector.tsx` — checkboxes för länkfält + ny font-dropdown med previews
- `src/components/admin/ProductOptionsSection.tsx` — välj tillåtna typsnitt
- `src/components/editor/ControlPanel.tsx` — använd `allowedFonts`
- `src/stores/editorStore.ts` — `buildAutoText` respekterar `linkedMapFields`
- `src/lib/template-migrate.ts` — samma

## Att verifiera efter implementation
1. Befintlig mall med länkad text fortsätter visa STAD/LAND/KOORDINATER.
2. Avbocka "Land" → bara stad + koordinater i texten, kunden ser uppdateringen vid nytt platsval.
3. Admin-dropdownen visar varje typsnittsnamn renderat i sitt typsnitt.
4. Om admin tillåter t.ex. bara Inter + Playfair → kunden ser bara dessa två i sin typsnittsväljare.
5. Mall utan `allowedFonts`-config → kunden ser alla typsnitt.
