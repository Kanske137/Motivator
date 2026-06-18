# Mål

Bilposter + mc: byt fordonsmotorn från `flux-depth-pro`/`flux-canny-pro` (text-stil drunknar) till `fofr/sdxl-multi-controlnet-lora` på Replicate. Geometrin låses med depth-controlnet, stilen kommer från en per-stil LoRA. Hus/bebis/produkt rörs inte.

Två oberoende reglage: `controlnet_conditioning_scale` (geometri) och `lora_scale` (stilstyrka).

## Arkitektur

```
input
 -> 851-labs/background-remover           (cutout, behåller geometri)
 -> control-prep: depth → ren cutout, ingen posterize/blur, max 1024 px,
                 flatten över #7f7f7f (inget alfa till modellen)
                 canny → behåll nuvarande prep
 -> fofr/sdxl-multi-controlnet-lora:
      controlnet_1                    = "depth" | "canny"  (från mall)
      controlnet_1_image              = cutout
      controlnet_1_conditioning_scale = mallens controlnetScale  (default 0.7)
      lora_weights                    = stilens loraUrl
      lora_scale                      = stilens loraScale         (default 0.85)
      prompt                          = stilens prompt + ev. trigger-ord
      negative_prompt                 = "photo, photograph, photorealistic, 3d render"
      num_inference_steps             = 30
      guidance_scale                  = 6.5
      seed                            = deterministisk (samma som idag)
 -> 851-labs/background-remover -> RGBA-tryckfil
```

Exakta fältnamn på `fofr/sdxl-multi-controlnet-lora` verifieras live mot Replicate-schemat när edge-funktionen byggs — namnen ovan följer modellsidans dokumentation men kan ha `controlnet_1_*` eller `controlnet1_*`-stavning. Edge-funktionen loggar hela payload + svar vid första körningen.

## Ändringar

### 1. `src/lib/template-schema.ts`

**a) `structuralConditioning` (mall-nivå):** lägg till engine-värdet och en geometri-styrka.

```ts
engine: z.enum(["bfl-canny", "bfl-depth", "sdxl-controlnet-lora"]).default("bfl-canny"),
controlType: z.enum(["canny", "depth"]).default("canny"),
controlnetScale: z.number().min(0).max(2).default(0.7),  // NY
```

Backwards-compatible: gamla rader utan `engine` defaultar till `bfl-canny`, `controlnetScale` ignoreras av flux-spåren.

**b) `aiStylePresetSchema` (stil-nivå):** koppla LoRA-vikter per stil, eftersom kunden väljer stilen — inte mallen.

```ts
loraUrl: z.string().url().optional(),
loraScale: z.number().min(0).max(2).optional().default(0.85),
loraTrigger: z.string().optional(),
```

Saknas `loraUrl` på en stil körs den genom befintligt flux-spår (oförändrat fallback), så vi kan rulla ut LoRA per stil i takt med att de tränas.

### 2. `supabase/functions/replicate-face-swap/index.ts`

**a) Body-validering** (~rad 1446–1463): utöka `engine`-enumen med `sdxl-controlnet-lora`, läs `controlnetScale`, samt nya stilfält `loraUrl`, `loraScale`, `loraTrigger`. Skicka vidare i `structuralConditioning`-objektet och `callFluxStructural`-params (eller en ny `callSdxlControlnetLora` — se c).

**b) `prepareControlImage`:** depth-grenen redan klar (ingen posterize/blur, flatten över #7f7f7f, max 1024). Samma prep återanvänds för SDXL-depth. Canny-grenen behålls för SDXL-canny.

**c) Engine-routing i runner:** lägg till en ny gren parallellt med `callFluxStructural`:

```
engine === "sdxl-controlnet-lora" → callSdxlControlnetLora({
  model: "fofr/sdxl-multi-controlnet-lora",
  controlType, controlnetScale, loraUrl, loraScale, loraTrigger,
  prompt, negativePrompt, steps: 30, guidance: 6.5, seed
})
```

Reuse befintlig Replicate poll-loop. Kräver `loraUrl` — saknas det loggar vi varning och faller tillbaka på flux-spåret (per stil).

**d) Prompt-bygge för SDXL:** `prompt = [stylePrompt, loraTrigger, motifShort].join(", ")`. Stil-bridges (Olja/Skiss/…) som vi lade in för depth-pro stannar — de hjälper när LoRA är svag, skadar inte när LoRA är stark.

**e) Loggning `[sdxl-controlnet-lora]`:** `engine`, `model`, `controlType`, `controlnetScale`, `loraUrl`, `loraScale`, `loraTrigger`, `prompt`, `controlImageBytes`, `controlImageDims`, `seed`, `styleId`.

### 3. `src/components/editor/AiPhotoSection.tsx`

Cache-nyckel: utöka `refSlotFor` med engine + LoRA-id så SDXL-resultat inte krockar med flux-cache:

```
no-ref::style:<id>::ctrl:<canny|depth>::eng:<engine>::lora:<sha8(loraUrl)|none>
```

Skicka `loraUrl`, `loraScale`, `loraTrigger` (från `AiStylePreset`) och `controlnetScale` (från `structuralConditioning`) i body till edge-funktionen.

### 4. Admin-UI (`src/components/admin/ProductOptionsSection.tsx` eller där `aiStyles` editeras)

Per stilpreset: tre fält — `loraUrl` (text), `loraScale` (slider 0–2, default 0.85), `loraTrigger` (text, valfritt). Visa som "Avancerat" kollapsbart block för att inte stöka i grundvyn. Ingen ändring i hur stilarna används av andra produkter — saknas `loraUrl` är allt som idag.

### 5. Vad Lovable INTE gör

- Ingen SQL-patch. Granskaren sätter på bilposter+mc: `engine="sdxl-controlnet-lora"`, `controlType="depth"`, `controlnetScale=0.7`.
- Ingen LoRA-träning från koden. LoRA-URL:er (Replicate file-storage / HF / R2) klistras in av admin per stil när de är klara.
- Ingen ändring på hus/bebis/produkt.
- Ingen kommersiell licens-koll i kod — det är admins ansvar att bara klistra in LoRA:er med godkänd licens.

## Tekniskt — filer som rörs

- `src/lib/template-schema.ts` — `engine`-enum + `controlnetScale` + `loraUrl/loraScale/loraTrigger` på `aiStylePresetSchema`.
- `supabase/functions/replicate-face-swap/index.ts` — body-validering, engine-routing, `callSdxlControlnetLora`, prompt-bygge, loggning.
- `src/components/editor/AiPhotoSection.tsx` — cache-nyckel + body-payload.
- Admin-editor för `aiStyles` — tre nya fält per stil.

## Valideringsplan (efter SQL-patch + första LoRA tillgänglig)

1. Schema-sanity: en körning per fordonsmall med `engine="sdxl-controlnet-lora"`, depth, känd kommersiell LoRA, default scales. Logga svar; verifiera URL ut.
2. Per fordon (bil 3/4 vänster + höger, MC), samma original, stilarna Olja / Vintage / Skiss / Pop-art / Linjekonst / Akvarell. Svep `lora_scale` 0.7→1.0 och `controlnet_conditioning_scale` 0.5→0.8.
3. Pass: stilarna tydligt olika varandra och tydligt inte ett foto med färgton; vinkel/rotation/skala oförändrad; tid ~ canny-flödet idag (~10 s).
4. Vid stel output: sänk `controlnet_conditioning_scale`. Vid svag stil: höj `lora_scale` eller byt `controlType` till `canny` (LoRA bär ändå stilen).
