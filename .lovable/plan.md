# Plan: fixa kritiska problem med mallgruppering, format-väljaren och fel produkt i kundvagn

## Vad som är fel nu

Jag förstår problemen, och de hänger ihop:

1. **Format visar fel produkter**
   - Databasen har idag bara dessa config-rader:
     - `personlig-karta-canvas`
     - `personlig-karta-poster`
     - `mitt-hjarta`
   - Det finns alltså **ingen separat `mitt-hjarta`-canvas config-rad**.
   - Samtidigt är `mitt-hjarta` en legacy-rad utan `-poster`-suffix, vilket gör att editorn blandar ihop mallgrupperna.

2. **Fel produkt öppnas i editorn**
   - `EditorPage` löser idag config via `handle` eller `template_slug`, men fallback-logiken gör att den kan landa på fel typ när en mall saknar sitt “syskon” eller använder legacy-handle.
   - Därför kan `mitt-hjarta` öppna canvas trots att du öppnade poster.

3. **Fel produkt hamnar i kundvagn**
   - Kundvagnen visar numera titel/bild från Shopify korrekt, men själva variant-resolving bygger fortfarande på att rätt config/handle redan är aktiv.
   - Om editorn har laddat fel config från början, resolve:as också fel Shopify-variant.

4. **Tomma storlekar/ramar på en av posterna**
   - Det är ett symptom på att UI:t kan växla till en config som inte egentligen hör till aktuell mall/kombination.
   - Då filtreras size/variant-listor mot fel `productOptions`, vilket ger tomt resultat.

5. **Försäljningskanal och kategori saknas fortfarande**
   - Publicering mot Online Store finns i edge-funktionen men verkar inte träffa rätt publication i alla fall.
   - Produktkategori sätts inte alls i syncen idag.

## Vad som ska byggas

### 1) Normalisera mallmodellen så varje mall har en config per produkttyp

Gör `product_configs` till den tydliga sanningskällan:
- En mallgrupp identifieras av `template_slug`
- Varje produkttyp får en egen config-rad
  - ex:
    - `mitt-hjarta-poster`
    - `mitt-hjarta-canvas`
  - båda med `template_slug = 'mitt-hjarta'`

Detta ersätter dagens blandning där en legacy-rad (`mitt-hjarta`) försöker representera flera typer.

### 2) Backfill/migrera befintliga mallar till rätt struktur

Implementera en säker datamigrering för befintliga configs:
- Identifiera legacy-rader utan suffix
- Om mallen har både poster och canvas aktiverat i `template.productOptions`:
  - behåll/konvertera legacy-raden till `-poster`
  - skapa en separat `-canvas`-rad med samma template och samma `template_slug`
- Om mallen bara har en typ aktiverad:
  - normalisera handle till typ-suffix ändå för konsekvens, eller håll kvar legacy-handle men mappa den explicit som alias

Rekommenderad väg: **normalisera allt till suffixade handles** för skalbarhet.

### 3) Uppdatera admin-flödet så nya mallar alltid skapas korrekt

`CreateTemplateDialog` ska inte längre skapa bara en rad när man väljer “Båda”.

I stället:
- `Poster` skapar `slug-poster`
- `Canvas` skapar `slug-canvas`
- `Båda` skapar **två config-rader direkt**
- båda delar samma:
  - `template_slug`
  - template-innehåll
  - titelbas

Designer-vyn ska öppna rätt config-handle direkt.

### 4) Lås editorns produktväxling till aktuell mallgrupp

`EditorPage` + `FormatSection` ska ändras så att produktväljaren enbart byggs från:
- aktuell `template_slug`
- faktiskt existerande configs för den mallen
- endast aktiverade produktOptions för respektive config

Målet:
- öppnar du “Mitt hjärta” ska du bara se dess egna produkttyper
- aldrig någon annan malls poster/canvas
- inga dubbletter
- inga “spökposter”-val

Format-väljaren ska dessutom drivas av en stabil sorterad lista per mallgrupp, inte av “första matchande config”.

### 5) Gör route-resolution deterministisk

`EditorPage` ska sluta falla tillbaka tvetydigt.

Ny regel:
- `handle` matchar exakt config först
- om URL innehåller legacy-handle eller `template_slug`, krävs tydlig typupplösning
- om flera configs finns i samma mallgrupp men `type` saknas:
  - välj poster som default endast om det är definierat som primär typ
  - annars välj explicit första typ enligt stabil ordning
- när användaren växlar format uppdateras URL alltid till exakt config-handle

Detta gör att “öppna mitt-hjarta-poster” alltid landar på rätt editor-config.

### 6) Nollställ invalid state när produkt byts

När man byter mellan produkttyper inom samma mall ska state uppdateras säkert:
- size/variant måste revalideras mot nya configens tillåtna kombinationer
- om tidigare val inte finns i nya configen ska första giltiga val väljas
- variant-resolver-cache ska använda rätt handle och inte återanvända gammalt resultat

Detta eliminerar tomma dropdowns och felaktiga add-to-cart-val.

### 7) Säkerställ att kundvagn alltid använder aktiv config, inte “senast matchad mall”

Verifiera och justera add-to-cart-flödet så att det alltid använder:
- aktiv config-handle
- variant resolvad för just den configen
- properties som inkluderar rätt `_product_handle` och mallmetadata

Om det behövs läggs extra guard in före `addItem()`:
- stoppa add-to-cart om aktiv config och resolvad variant inte hör ihop
- logga tydligt fel om variant hittas för annan handle än den aktiva

### 8) Slutför Shopify-metadata: försäljningskanal och kategori

`shopify-sync-template` uppdateras också för att:
- publicera mot rätt Online Store-publication robustare
- returnera tydligare status om publication inte hittas
- sätta produktkategori enligt produkttyp
  - Poster → poster/print-art-liknande kategori
  - Canvas → canvas wall art-liknande kategori

Om Shopify kräver annan kategori-representation i 2025-07 anpassas mutationen därefter.

## Teknisk implementation

### Filer som kommer att ändras
- `src/components/admin/CreateTemplateDialog.tsx`
- `src/pages/admin/DesignerPage.tsx`
- `src/pages/EditorPage.tsx`
- `src/components/editor/FormatSection.tsx`
- `src/stores/editorStore.ts`
- `src/lib/product-config.ts`
- `src/lib/shopify-variant-resolver.ts`
- `src/stores/cartStore.ts` (bara om guard/felsäkring behövs)
- `supabase/functions/shopify-sync-template/index.ts`
- eventuell DB-migration för datanormalisering om struktur behöver kompletteras

### Datamodell efter fix
```text
template_slug = mitt-hjarta
  ├─ mitt-hjarta-poster   (product_type=posters)
  └─ mitt-hjarta-canvas   (product_type=canvas)

template_slug = personlig-karta
  ├─ personlig-karta-poster
  └─ personlig-karta-canvas
```

### Princip för skalbarhet
Detta byggs inte hårdkodat för poster/canvas idag, utan som en mallgrupp + produkttyp-modell som kan utökas senare med fler typer.

## Verifiering efter implementation

1. Öppna `mitt-hjarta-poster`
   - editorn laddar poster, inte canvas
2. Format visar exakt två val för Mitt hjärta
   - Poster
   - Canvas
3. Växling mellan dessa stannar inom `template_slug = mitt-hjarta`
4. Inga produkter från `personlig-karta` visas i Mitt hjärta-flödet
5. Storlek och ram/djup visas korrekt för båda typerna
6. Lägg `Mitt hjärta canvas` i kundvagn
   - rätt Shopify-produkt och rätt variant hamnar i cart
7. Synka till Shopify
   - kategori sätts
   - publicering mot försäljningskanal verifieras

## Resultat

Efter detta ska systemet bete sig så här:
- varje mall har sina egna produkttyper
- format-väljaren visar bara produkter från samma mall
- poster öppnar poster och canvas öppnar canvas
- kundvagnen får rätt produkt
- lösningen är skalbar för ett stort mallbibliotek

Godkänn planen så implementerar jag den i helhet.