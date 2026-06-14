# AI Multi Face-Swap — nytt lager, generiskt, additivt

Strikt **additivt** och **isolerat**. Inga befintliga lager, komponenter, edge functions, scheman eller flöden ändras. Allt nytt har prefix `multiFace` / `MultiFace` / `aiMultiFace`.

## 1. Nytt lager-typ i schemat

I `src/lib/template-schema.ts` läggs en ny gren till `templateLayerSchema`-unionen:

```ts
export const aiMultiFaceLayerSchema = baseLayerSchema.extend({
  type: z.literal("aiMultiFace"),
  defaults: z.object({
    referenceImageUrl: z.string().url().optional(),
    prompt: z.string().default(""),                // admin-redigerbar, som aiPhoto
    faceCount: z.number().int().min(2).max(4).default(2),
    slots: z.array(z.object({
      id: z.string().min(1),       // "slot-1", "slot-2" (auto-genereras)
      label: z.string().min(1),    // admin-fritext, t.ex. "Kung", "Vänster person"
      position: z.string().min(1), // admin-fritext, t.ex. "left", "front-right"
    })).min(2).max(4),
  }),
});
```

Unionen utökas med `z.discriminatedUnion("type", [...befintliga, aiMultiFaceLayerSchema])`. Befintliga lager fortsätter validera oförändrat — den nya literalen läggs bara till.

Inga andra fält i schemat ändras. Ingen migration. Lagret skapas via admin-UI (eller manuellt jsonb-edit) på de mallar som vill ha det.

## 2. Admin — skapa & konfigurera lagret

**`src/components/admin/LayerList.tsx`** (eller motsvarande "lägg till lager"-meny): ett nytt alternativ "AI Multi Face-Swap" som pushar ett default-lager `{type:"aiMultiFace", defaults:{faceCount:2, slots:[{id:"slot-1",label:"Person 1",position:"left"},{id:"slot-2",label:"Person 2",position:"right"}], prompt: DEFAULT_MULTI_FACE_PROMPT}}`. En tilläggsrad bredvid befintliga lager-typer, inget annat rörs.

**`src/components/admin/LayerInspector.tsx`**: ny gren `if (layer.type === "aiMultiFace")` som renderar `MultiFaceInspector` (ny fil). Befintliga grenar (`photo`, `aiPhoto`, `text`, `map`, `shape`) orörda.

**Ny komponent `src/components/admin/MultiFaceInspector.tsx`:**
- Referensbild-uppladdare (återanvänder `uploadAiReferenceImage` från `ai-reference-upload.ts`, samma som aiPhoto).
- Prompt-textarea (redigerbar, default = `DEFAULT_MULTI_FACE_PROMPT`, med hjälptext om placeholders).
- Number-input "Antal ansikten" (2–4). När värdet ändras: arrayen `slots[]` justeras — nya slots får defaults `{id:"slot-N",label:"Person N",position:""}`, borttagna slots tas bort från slutet.
- Repeater över `slots[]`: per slot två textfält (`label`, `position`). Drag-handtag är inte i scope.

## 3. Default-prompt (admin kan ändra)

Ny export i `src/lib/ai-photo-prompts.ts` (additiv, rör inte `DEFAULT_AI_PHOTO_PROMPTS`):

```ts
export const DEFAULT_MULTI_FACE_PROMPT = `You are given several images. Image 1 is the reference artwork to preserve exactly: composition, style, clothing, accessories, pose, background and framing. The remaining images are customer face photos.

Re-render image 1 as the same artwork, but replace each depicted person with the matching customer face according to these mappings:
{{SLOTS}}

Preserve each customer's facial identity and likeness faithfully. Keep the people clearly distinct — never blend, mirror or swap them. Keep everything else in the artwork unchanged. Render each likeness naturally within the artistic style.`;
```

Edge-funktionen ersätter `{{SLOTS}}` med en rad per slot: `"- The person at the {position} position becomes the face in image {n}"` (n = 2..N+1, ordningen följer `slots[]`).

## 4. Kund-UI — ny komponent

**`src/components/editor/ControlPanel.tsx`** (rad 142 / 190 / 216): där `aiPhotoLayers` filtreras och renderas — lägg till parallell hantering för `aiMultiFaceLayers = layers.filter(l => l.type === "aiMultiFace")`, samma list-mönster. Befintlig `AiPhotoSection`-rendering oförändrad.

**Ny komponent `src/components/editor/MultiFaceUploadSection.tsx`:**
- Speglar `PhotoUploadSection` / `AiPhotoSection`-UI:t.
- En upload-ruta per slot (titel = `slot.label`).
- Återanvänder `uploadCartPreview` + `hashFile` (samma helpers som AiPhotoSection).
- "Skapa"-knapp disabled tills alla slots är fyllda.
- Använder befintlig `useAiBusyStore` + `AiBusyOverlay` (samma overlay-frysning som idag).
- Skriver resultatet via `setAiPhotoResult(layer.id, url)` — **samma store-fält som single-face** → preview/snapshot/print/cart-pipeline funkar oförändrat, ingen förgrening nedströms.
- Egen cache `src/lib/multi-face-cache.ts` (nyckel: `layerId + sorted(slotId:hash) + referenceImageUrl`), spegelmönster från `face-swap-cache.ts`.

**`src/stores/editorStore.ts`**: ny slice `multiFacePortraits: Record<layerId, Record<slotId, {file, previewUrl, uploadedUrl, hash}>>` + actions `setMultiFacePortrait(layerId, slotId, ...)`, `clearMultiFacePortraits(layerId)`. Additivt — befintliga slices orörda.

## 5. Ny edge function `multi-face-swap`

Ny mapp `supabase/functions/multi-face-swap/index.ts`. **`replicate-face-swap` rörs inte.**

**Input:**
```ts
{
  layerId: string,
  referenceImageUrl: string,
  prompt: string,                                  // skickas från klienten (admin-konfigurerad)
  slots: Array<{ id: string, position: string }>,  // ordnad
  portraits: Record<slotId, portraitUrl>,
  designId: string
}
```

**Flöde** (samma struktur som `replicate-face-swap`):
1. CORS-preflight (`corsHeaders` från `npm:@supabase/supabase-js@2/cors`).
2. Zod-validering, 400 vid fel.
3. Bygg slot-mapping-text och ersätt `{{SLOTS}}` i prompten.
4. **Anropa Nano Banana 2** via Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`, modell `google/gemini-3.1-flash-image-preview`). Använder samma chat-completions-mönster som dagens pet/removeBackground-grenar i `replicate-face-swap`. Multi-image-input via `image_url`-blocks: image 1 = referensmotiv, image 2..N+1 = porträtt i slot-ordning.
5. Ladda upp PNG till befintlig **`print-files`**-bucket (samma helpers/bucket som idag).
6. Returnera `{ printFileUrl }`. Vid fel: `200 + {error, userMessage, fallback: true}` (samma envelope som befintlig function).

**Inga nya env-variabler.** Återanvänder `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 6. i18n — endast nya nycklar

`src/i18n/locales/sv.json` (källa) + översättning till `en/de/no/da/fi/fr/es/it/nl/pl`:

```
multiFace.uploadFor: "Ansiktet som blir {{label}}"
multiFace.allRequired: "Ladda upp ett porträtt per ansikte för att fortsätta"
multiFace.create: "Skapa"
multiFace.recreate: "Skapa igen"
multiFace.failed: "Kunde inte skapa motivet"
multiFace.creating: "Skapar ditt motiv …"
multiFace.admin.faceCount: "Antal ansikten"
multiFace.admin.slotLabel: "Etikett"
multiFace.admin.slotPosition: "Position (t.ex. left, right, front-center)"
multiFace.admin.promptHint: "Använd {{SLOTS}} där slot-mappningarna ska injiceras automatiskt."
```

Inga befintliga nycklar ändras eller tas bort. Följer projektets i18n-core-regel.

## Filer

**Nya:**
- `src/components/admin/MultiFaceInspector.tsx`
- `src/components/editor/MultiFaceUploadSection.tsx`
- `src/lib/multi-face-cache.ts`
- `supabase/functions/multi-face-swap/index.ts`

**Ändrade (minimal, strikt additiv):**
- `src/lib/template-schema.ts` — ny `aiMultiFaceLayerSchema` läggs till unionen
- `src/lib/ai-photo-prompts.ts` — ny export `DEFAULT_MULTI_FACE_PROMPT`
- `src/stores/editorStore.ts` — ny slice `multiFacePortraits` + actions
- `src/components/admin/LayerList.tsx` — nytt menyval för "AI Multi Face-Swap"
- `src/components/admin/LayerInspector.tsx` — ny `if`-gren för `aiMultiFace`
- `src/components/editor/ControlPanel.tsx` — ny filter + render-loop för `aiMultiFaceLayers`
- 11 × `src/i18n/locales/*.json` — endast nya `multiFace.*` nycklar

**Orörda:**
- `AiPhotoSection.tsx`, `PhotoUploadSection.tsx`, `AiStyleSection.tsx`
- `replicate-face-swap/index.ts`, `replicate-style/index.ts`
- `face-swap-cache.ts`, `ai-cache-storage.ts`
- `AiBusyOverlay.tsx`, `aiBusyStore.ts` (återanvänds som de är)
- Cart, print-pipeline, mockup, snapshot, 3D-preview, Shopify-sync
- DB-schema, `config.toml`, env

## Acceptanskrav

1. Alla befintliga mallar/lager fungerar identiskt — samma UI, samma generering, samma checkout. Snapshot, cart-flow, print-pipeline oförändrade.
2. Admin kan lägga till ett nytt "AI Multi Face-Swap"-lager på vilken mall som helst, ladda upp referensbild, redigera prompt, sätta antal ansikten (2–4) och konfigurera varje slots label + position.
3. Kund ser N upload-rutor i editorn (en per slot, med admin-satt label), "Skapa" disabled tills alla fyllda, AiBusyOverlay fryser editorn under generering, resultatet hamnar i samma preview/cart som idag.
4. Edge function `multi-face-swap` anropar Nano Banana 2 med referens + N porträtt i ett anrop och returnerar slutbild till `print-files`.

Säg till så bygger jag.
