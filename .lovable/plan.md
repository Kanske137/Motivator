# Strukturell conditioning för object-removal-mallar — implementerat (v2, BFL)

Status: **byggt och utrullat** på bilposter, mc, produktposter, husposter, fodelsetavla. Foto-till-konst exkluderad (separat fråga om helbild vs isolering).

## Pipeline (route `remove-bg-structural` i `replicate-face-swap`)

```
input photo
  → 851-labs/background-remover  (RGBA cutout — geometri låst av verkliga pixlar)
  → flatten över #7f7f7f (imagescript) → upload till print-files/<designId>-ctrl.png
  → BFL flux-canny-pro (eller flux-depth-pro)
      input: control_image = flatten-URL, prompt = motif + style-bridge + style,
             guidance, steps, output_format=png, safety_tolerance=2
  → 851-labs/background-remover #2  (strippar #7f7f7f-bakgrunden)
  → RGBA PNG
```

Gating: `subjectKind === "removeBackground"` AND `fluxStylePrompt` finns AND `structuralConditioning.enabled === true` AND env `FLUX_REMOVEBG_ENABLED=true`. Annars går trafiken på Route 3b (kontext-pro) eller Route 3 (Nano Banana) precis som tidigare.

## Per-mall-config (på varje aiPhoto-lager i `template.defaults`)

```json
"structuralConditioning": {
  "enabled": true,
  "controlType": "canny",
  "guidance": 30,
  "steps": 28
}
```

`controlType` kan bytas till `"depth"` via SQL för enskilda mallar om canny blir oprecist (kandidat: fodelsetavla).

## Filer

- `src/lib/template-schema.ts` — nytt `structuralConditioning`-block i `aiPhotoDefaultsSchema`.
- `supabase/functions/replicate-face-swap/index.ts` — `callFluxStructural`, `flattenOverGrey` via imagescript, ny route i `runRemoveBackground`, body-validering, log-utökning (`remove-bg-structural`).
- `src/components/editor/AiPhotoSection.tsx` — skickar `structuralConditioning` i body, cache-nyckel inkluderar `controlType` så path-byte inte serverar gammal cache.

## Cache-nyckel

`refSlotFor("removeBackground", null, styleId, controlType)` → `no-ref::style:<id>::ctrl:canny`. Tidigare cache (utan `::ctrl:`) lever kvar för kontext-pro-vägen, structural-resultat lagras separat.

## Validering att köra nu

Per mall, original + svåra fall (bil 3/4 vänster + höger, MC, hus, bebis, produkt) i Olja + Vintage:

1. Riktning/vinkel/skala identiska med original utan post-fix.
2. Stilen tydligt synlig — om svag, höj `guidance` (testa 40-50).
3. Total tid kortare än kontext-pro-vägen, ingen retry-loop.
4. Andra bg-remover-passet klipper rent när olje-/impasto-texturer "läker ut" på #7f7f7f-bakgrunden. Om kanter blir lurviga: överväg att istället använda silhuettmasken från första passet som hård cutout.
5. **Regress-vakt** hus + bebis: jämför mot dagens kontext-pro-output. Om sämre, sätt `structuralConditioning.enabled=false` på respektive mall via SQL.

## Att hålla koll på under utvärdering

- Tid: structural-vägen kör 4 modell-anrop sekventiellt (BG → flux → BG). Räkna med ~25-35 s. Om för långsamt — överväg `steps=20`.
- Per-stil-tuning är inte exponerat ännu (config sitter per mall, inte per stil). Om en mall visar att olja vill ha lösare control + högre guidance än linjekonst: utöka `AiStylePreset` med eget overrides-block.
- `flux-canny-pro` / `flux-depth-pro` slugs verifierade aktiva på Replicate vid utrullning. Om någon plötsligt 404:ar, byt till `-dev` motsvarigheten.

## SQL för att slå av structural per mall (vid regress)

```sql
UPDATE product_configs
SET template = jsonb_set(
  template,
  '{canvasLayout,portrait,layers,<index>,defaults,structuralConditioning,enabled}',
  'false'::jsonb
)
WHERE shopify_handle = '<handle>';
```

Eller använd samma DO-block-walker som vid aktiveringen och sätt `enabled=false`.
