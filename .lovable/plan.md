

## Fas 3 — Steg 1: Tryckfilen ska vara identisk med editor-vyn

### Problem (kritiskt)

`getPrintFileUrl()` i `src/lib/print-pipeline.ts` har tre grenar:

| Source | Vad som skickas till Gelato idag |
|---|---|
| `map` | ✅ Hi-res komposit av alla lager |
| `photo` | ❌ Bara den uppladdade originalbilden |
| `ai` | ❌ Bara AI-resultatet, ingen komposit |

För `photo`/`ai` görs en **passthrough-uppladdning** — alla andra lager (kartor, text, bakgrund, shape-clip på fotot) ignoreras. Det är därför din senaste beställning bara fick AI-bilden i full storlek istället för hela posterdesignen.

Cart-thumbnailen är korrekt eftersom den alltid kör genom `renderTemplateSnapshot()` som komponerar alla lager och redan tar emot `photoOverlayUrl` som målas in i fotolagrets shape-clippade rektangel.

### Lösning

#### 1. `src/lib/print-pipeline.ts` — kör ALLTID hi-res-snapshot

Ta bort passthrough-grenarna för `photo` och `ai`. Alla källor → `renderHiresTemplateSnapshotSafe(templateInput)` → upload till `print-files`-bucket. `templateInput.photoOverlayUrl` är redan korrekt satt av `EditorPage.handleAddToCart` så fotot/AI-resultatet hamnar inuti rätt fotolager med rätt shape-clip och pan-offset.

Behåll guarden som kräver att mallen har ett `photo`-lager när `source !== "map"`.

Ny semantik:
- `designSource` används bara för att avgöra om `photoOverlayUrl` ska sättas — själva print-renderingen är nu identisk för alla källor.
- `photoFile` / `aiPrintFileUrl` behöver inte längre laddas upp separat innan tryck, men `aiPrintFileUrl` är fortfarande den URL som matas in i editor + snapshot.

#### 2. `src/lib/template-snapshot.ts` — höj print-DPI

Idag: `PX_PER_CM = 32` i hires-läge, max-px klamp `2000–3600` beroende på enhet. För en 21×30 cm poster ger det ~960×1370 px → ca 116 DPI. Gelato rekommenderar **300 DPI** för fotokvalitet (≈ 118 PX_PER_CM). Det är inte realistiskt att rendera 21×30 cm @ 300 DPI i webbläsaren (~2480×3540 px = OK), men 30×40 / 50×70 blir gigantiskt och WebGL-kontexten dör.

Justering:
- `PX_PER_CM` höjs till `48` i hires (motsvarar ~122 DPI), vilket Gelato accepterar för posters/canvas i de flesta storlekar.
- `pickHiresMaxPx()`-tak höjs till `4800` på desktop, `2800` på mobil.
- Lägg till `ctx.imageSmoothingEnabled = true` och `ctx.imageSmoothingQuality = "high"` innan `drawImage`-anropen i `drawPhotoLayer`, `drawImageLayer` och `drawMapLayer`.
- Byt JPEG-kvalitet från `0.92` → `0.95` (fortfarande betydligt mindre fil än PNG).

För **stora** storlekar (50×70 / 70×100) håller automatisk-skalningen redan koll på maxpixel-budgeten — vi får då lägre faktisk DPI, men inte värre än idag.

#### 3. `src/components/CartDrawer.tsx` — rensa cart-radens metadata

Kunden ser idag:
- Produkttitel
- Variant (storlek · ram)
- **Alla** non-underscore-attribut (idag: `Orientation`, `Text` — och `Text` visar bara ena textrutan vilket är missvisande)

Fix: visa endast storlek + ram + orientering. Konkret:
- Ta bort `Orientation` och `Text` från `properties` i `EditorPage.handleAddToCart`. (Variantens namn `${size} · ${variant}` täcker storlek + ram, så vi lägger till orientering som en line-item-attribut: `Orientering: Stående`.)
- Resten av designdatan ligger fortsatt i `_-prefixade` attribut för Shopify-webhooken, oförändrat.
- `CartDrawer`s filter `a.key.startsWith("_")` fungerar då redan — bara `Orientering` visas under variant-raden.

#### 4. `supabase/functions/shopify-order-webhook/index.ts`

Ingen kod-ändring krävs här — webhooken läser redan `_print_file_url` från line item properties och skickar till Gelato. Eftersom URL:en nu pekar på en korrekt komposit-tryckfil löser det sig automatiskt.

Verifiera dock i loggen efter nästa testorder att:
- `_print_file_url` pekar på en ny fil
- `source=` rapporterar fortfarande "ai"/"photo" (för spårbarhet — men filen är nu en full komposit)

### Filer

| Fil | Ändring |
|---|---|
| `src/lib/print-pipeline.ts` | Ta bort `ai`/`photo` passthrough, alla källor → hi-res komposit |
| `src/lib/template-snapshot.ts` | PX_PER_CM 32→48, max-px-tak höjs, smoothingQuality=high, JPEG 0.95 |
| `src/pages/EditorPage.tsx` | Ta bort `Orientation` + `Text` från properties; lägg `Orientering: …` |
| `src/components/CartDrawer.tsx` | Ingen ändring (filtret fungerar redan när vi tar bort attributen) |

### Verifiering

1. Gör om beställningen (mall med 2 kartor + 3 texter + 1 AI-bild, 21×30 vit ram).
2. Cart-raden visar: `Personlig karta poster · 21x30 · Vit · Orientering: Stående`. Ingen "Text"-attribut.
3. Cart-thumbnailen oförändrad (visuellt identisk med editorn).
4. `_print_file_url` i webhook-loggen pekar på en NY fil i `print-files/`.
5. Öppna URL:en direkt i webbläsaren → bilden visar **hela kompositen** (bakgrund + båda kartor + alla texter + cirkulär AI-bild i sin shape).
6. Filen är ≥ 2480×3540 px för 21×30 (≈ 300 DPI på kortsidan, ≈ 122 DPI faktisk efter klamp om enheten triggar maxpx-skalning).
7. Gelato accepterar filen utan DPI-varning i admin (kontrollera nästa orderbekräftelse).
8. Testa även `source=map` (utan AI/foto) → fortsatt korrekt, ingen regression.

