
## Mål

På AI-fotolager med motiv = Människa eller Hund/Katt ska admin kunna ladda upp **flera** referensbilder. På kundeditorn dyker det då upp en motiv-väljare ovanför "Din bild"-uppladdaren. När kunden byter motiv uppdateras live-previewen direkt; face-swap körs först när kunden trycker "Skapa nu", och resultatet cachas per (ansikte, motiv, lager) så ingen onödig AI-körning sker när man hoppar fram och tillbaka.

Ingen annan funktionalitet ändras. `removeBackground`-läget förblir helt orört (ingen referens där).

## Terminologi

I sektions-rubriken används ordet **"Motiv"** (kunden väljer ett motiv som hen vill bli). Det matchar redan admin-fältet ("Motiv: Människa / Hund/Katt") och fungerar generellt för superhjältar, skådespelare, hundar, kungligheter osv. Översätts via `aiPhoto.chooseSubject` i alla språkfiler.

## Schema (`src/lib/template-schema.ts`)

Lägg till en lista parallellt med befintligt fält (bakåtkompatibelt):

```ts
referenceImages: z.array(z.object({
  id: z.string().min(1),
  url: z.string().url(),
  label: z.string().optional(),   // valfritt, t.ex. "Spider-Man"
})).default([]),
referenceImageUrl: z.string().url().optional(),  // legacy, behålls
```

## Migration (`src/lib/template-migrate.ts`)

Vid laddning av äldre mallar: om `referenceImages` saknas eller är tom **och** `referenceImageUrl` finns, fyll `referenceImages = [{ id: <uuid>, url: referenceImageUrl }]`. `referenceImageUrl` lämnas kvar oförändrad så gamla snapshot/print-flöden inte påverkas.

## Admin (`src/components/admin/LayerInspector.tsx`)

Ersätt det enskilda referensbild-blocket (rad 761–810) med en lista:

- Grid av thumbnails (bild + valfri label-input + "Ta bort").
- "Lägg till referensbild"-knapp som triggar samma `uploadAiReferenceImage`-flöde och pushar en ny `{id, url}` till listan.
- Vid första uppladdningen synkas även `referenceImageUrl` till den första bildens URL (för bakåtkompat med snapshot/thumbnail). Vid borttagning hålls `referenceImageUrl` synkad mot `referenceImages[0]?.url ?? undefined`.

## Kundeditor (`src/components/editor/AiPhotoSection.tsx`)

1. Läs `layer.defaults.referenceImages`. Om tomt → falla tillbaka på en virtuell lista `[{id:"legacy", url: referenceImageUrl}]` om den gamla finns.
2. Ny lokal state `selectedReferenceId`. Auto-välj första posten på mount/byte av layer.
3. Visa **bara om** `referenceImages.length >= 2` och `subjectKind !== "removeBackground"`:
   - Rubrik: `t("aiPhoto.chooseSubject")` ("Välj motiv").
   - Grid (samma stil som style-pickern) med thumbnails; aktiv ring runt vald.
4. Variabeln `refUrl` byts från `layer.defaults.referenceImageUrl` till **vald** referens-URL (med fallback till `referenceImageUrl`).
5. Live-preview: bakomliggande visning sker i `MapPreview.tsx` rad 490 (`l.defaults.referenceImageUrl`). Lägg till en parallell store-map `aiPhotoSelectedRefUrl: Record<layerId, string>` i `editorStore` som `AiPhotoSection` skriver till när man byter motiv. `MapPreview` läser den och visar `aiResultUrl ?? selectedRefUrl ?? defaults.referenceImageUrl`. Inget renderingsbeteende ändras i övrigt.
6. Cachen är redan nycklad på `referenceImageUrl|faceHash|layerId`. Eftersom vi nu skickar **vald** ref-URL till `refSlotFor(...)` får varje motiv sin egen cache-entry automatiskt → ingen omkörning vid återbesök, men nytt motiv kräver ett "Skapa nu"-tryck (precis som du beskriver).

## Snapshot / print-pipeline / thumbnails

Inga ändringar krävs i `template-snapshot.ts`, `print-pipeline.ts` eller `TemplateThumbnail.tsx`: de fortsätter använda `defaults.referenceImageUrl` (= första referensen, hålls synkad av admin-UI). Vid faktiskt köp finns alltid `aiResultUrl` (kundens swap), så referensen används där bara som fallback för förhandsvisning.

## i18n

Ny nyckel `aiPhoto.chooseSubject = "Välj motiv"` i `sv.json` + översättningar i `en/de/no/da/fi/fr/es/it/nl/pl`.

## Verifiering

- Admin: ladda upp 2+ referenser → sparas → reload visar samma lista.
- Kund (mall med 2 ref-bilder): motiv-väljare syns; byt motiv → previewen byter bild direkt utan AI-körning; "Skapa nu" gör face-swap; växla tillbaka till tidigare motiv → tidigare swap-resultat dyker upp direkt från cache (ingen ny körning).
- Mall med endast 1 referens: ingen väljare visas, beteende oförändrat.
- `removeBackground`-mall: helt oförändrat.
