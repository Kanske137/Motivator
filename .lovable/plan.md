

## Plan: Modulärt design-system för admin (drag & drop) + multi-lager kund-editor

### Vision i en mening

Ni (admin) ritar en **mall** med fritt placerade lager (karta, bild, text, linje, marginal) i en drag & drop-editor, väljer vilka produkter/storlekar/varianter mallen säljs som, och publicerar. Kunden får en publik editor som visar exakt samma layout men kan bara ändra det ni tillåter per lager och välja bland de produktvarianter ni godkänt.

### Arkitektur

```text
ADMIN (ny route /admin/designer/:handle)
   │  1. Produkt & varianter: poster/canvas + tillåtna sizes/frames/depths
   │  2. Drag & drop lager på canvas (% av FRONT-zonen)
   │     snap-to-grid + alignment-guides
   │     per lager: locks + defaults + zIndex
   │  3. "Visa som kund" preview-läge
   ▼
product_configs.template (jsonb, versioned)  ──►  Shopify produkt sync
   ▼
KUND (befintlig /editor utökad)
   │  Format-sektion filtreras av template.productOptions
   │  Renderar template-lager i zIndex-ordning
   │  Defaults förifyllda, endast unlocked properties interaktiva
   ▼
renderArtworkSnapshot(template, layerValues)
   │  Tecknar varje lager sekventiellt på offscreen canvas
   ▼
preview (cart) + hires print-fil → Gelato
```

### Datamodell — `product_configs.template` (ny jsonb-kolumn)

Position i **% av FRONT-zonen**. Marginal/linje-tjocklek i **mm**. `productOptions` ersätter tidigare `supports`-block.

```jsonc
{
  "version": 1,
  "publishedAt": "2026-04-22T...",
  "productOptions": {
    "poster": {
      "enabled": true,
      "allowedSizes": ["30x40", "50x70", "70x100"],   // subset av config.sizes
      "allowedFrames": ["Ingen", "Vit", "Ek"]          // subset av variants
    },
    "canvas": {
      "enabled": true,
      "allowedSizes": ["30x40", "50x70"],
      "allowedDepths": ["4cm"]                         // subset av variants
    }
  },
  "orientations": ["portrait", "landscape"],
  "defaultLayout": {
    "portrait":  { "aspect": "3:4", "background": { "color": "#EFE7D6" }, "layers": [/* … */] },
    "landscape": { "aspect": "4:3", "background": { "color": "#EFE7D6" }, "layers": [/* … */] }
  },
  "sizeOverrides": {
    "30x40": { "portrait": { "layers": [/* … */] } }
  }
}
```

**Layer-bas (alla typer):**
```jsonc
{
  "id": "layer_abc123",
  "type": "map" | "image" | "text" | "line" | "margin",
  "name": "Karta Stockholm",
  "xPct": 10, "yPct": 8, "wPct": 80, "hPct": 60,
  "rotation": 0,
  "zIndex": 2,
  "defaults": { /* type-specifikt */ },
  "locks": {
    "position": true, "size": true, "shape": false,
    "content": false, "font": true, "visibility": false, "style": false
  }
}
```

**Default-värden per typ** (admin sätter, kund ser förifyllt, kan ändra om motsvarande lock = false):

| Type | `defaults` | Kund-interaktion (om unlocked) |
|---|---|---|
| `map` | `{ shape, styleId, center, zoom, showLabels }` | Sök plats, panorera, byt stil |
| `image` | `{ url?, fit, shape }` | Ladda upp foto |
| `text` | `{ text, font, fontSizePct, align, color }` | Skriv egen text, byt font |
| `line` | `{ orientation, thicknessMm, color }` | (sällan unlocked) |
| `margin` | `{ thicknessMm, color }` | (sällan unlocked) |

Schemat valideras med **zod** i `template-schema.ts` — defaults är obligatoriska per lager-typ; `productOptions` valideras mot global `config.sizes` och variants.

### Leveransfaser

#### Fas 1 — MVP: produktval + karta + text + admin-grunden

1. **Migration**: lägg till `template jsonb` på `product_configs`. Skript översätter befintliga `layouts` → `template` (inkl. default `productOptions` som speglar nuvarande config).
2. **Admin-editor `/admin/designer/:handle`** — sektioner uppifrån och ned:
   - **A. Produkt & varianter** (ny sektion överst):
     - Toggles: Poster ✅ / Canvas ✅ (minst en måste vara på).
     - Per aktiverad produkt: multi-select-checkboxar för tillåtna storlekar (från `config.sizes`).
     - Per aktiverad produkt: multi-select för tillåtna ramar (poster) / djup (canvas).
   - **B. Designyta**:
     - Canvas med valbar aspect (3:4 / 4:3 / 1:1).
     - Verktygspalett: "Lägg till karta", "Lägg till text".
     - Drag & drop med `react-rnd` — snap-to-grid (5%) + alignment-guides (centrum, edges, mellan lager) under drag.
   - **C. Lager-lista** (sidopanel): drag-sortera zIndex, ögon-ikon för dölj, hänglås för låst.
   - **D. Properties-panel** för valt lager: defaults + per-lager locks-checkboxar.
   - **"Visa som kund"** → `/editor?handle=...&preview=draft&token=...` i ny flik, respekterar locks och `productOptions`.
   - **"Spara draft"** vs **"Publicera"** (sätter `publishedAt`, synkar till Shopify).
3. **Versioning**: drafts vs published. Live-orders läser alltid senaste publicerade. `previewToken` i URL för draft.
4. **Publicerings-validering** — admin kan inte publicera om:
   - Ingen produkt har `enabled: true`.
   - En aktiverad produkt har tom `allowedSizes`.
   - En vald storlek saknar Gelato-UID-mappning i `gelato_sku_map`.
   - Något lager hamnar utanför FRONT-zonen eller överlappar margin-lager.
5. **Kund-editor refaktor**:
   - `editorStore` blir per-lager: `layerValues: Record<string, LayerValue>` initialiseras från `template.layers[].defaults`.
   - `MapPreview` loopar `template.layers` i zIndex-ordning, varje lager renderas av egen komponent (`MapLayer`, `TextLayer`).
   - `ControlPanel` listar bara lager där minst en lock är `false`.
   - **`FormatSection`** filtrerar `config.sizes` och variants genom `template.productOptions[type].allowedSizes/Frames/Depths`. Om bara en produkttyp är `enabled` → "Produkt"-pillen döljs helt.
6. **Snapshot-pipeline**:
   - `renderArtworkSnapshot(template, layerValues, { hires })` ritar lager i zIndex-ordning.
   - Map-lager renderas **sekventiellt** (en Mapbox-instans i taget) för WebGL context-budget.
   - Print-fil = en JPEG, alla lager komponerade. Ram exkluderas vid `hires:true` (befintlig logik).

#### Fas 2 — Bilder (egen upload, ingen AI än)

1. Image-lager i admin: ladda upp default-bild eller markera "kund laddar upp".
2. Kund-editor: per image-lager → upload-knapp om `locks.content === false`. `photoSourceByLayerId` i store.
3. Snapshot: `ImageLayer` tecknar med rätt fit/shape-clipping.
4. Print-pipeline: multi-lager → alltid `source: "composite"` (hi-res komposit). Pass-through behålls bara för rena single-image-mallar.
5. Validering: per upload-lager — min 1500 px på shortest side räknat på lagrets pixelyta i print-fil.

#### Fas 3 — Linjer + vita marginaler

1. Line-lager: Canvas2D `strokeRect`, tjocklek mm → px via `PX_PER_CM`.
2. Margin-lager: ritas sist, fyller ram runt motivet.
3. Admin-UI: tjocklek + färg-input.

#### Fas 4 (efter admin-config klar) — AI-modifiering på kundsidan

Per image-lager: kund klickar "AI-stil" → `replicate-style` edge function tar emot `layerId` + prompt → resultat ersätter `layerValues[layerId].url`. Ren kund-feature.

### Filer som skapas / ändras

| Fil | Roll |
|-----|------|
| `supabase/migrations/<ts>_product_template.sql` | Lägg till `template jsonb` + översätt befintliga layouts (default `productOptions` från nuvarande config) |
| `src/lib/template-schema.ts` (ny) | TS-typer + zod-schema (template, layer, locks, defaults, productOptions) |
| `src/lib/template-migrate.ts` (ny) | Översätt gamla `layouts` → `template` (engångskörning + runtime-fallback) |
| `src/pages/admin/DesignerPage.tsx` (ny) | Drag & drop-editor inkl. produkt/variant-sektion |
| `src/components/admin/ProductOptionsSection.tsx` (ny) | Toggles + multi-select för poster/canvas/sizes/frames/depths |
| `src/components/admin/LayerCanvas.tsx` (ny) | react-rnd-canvas med snap-to-grid + alignment-guides |
| `src/components/admin/LayerList.tsx` (ny) | Sorterbar lager-lista (zIndex), dölj/lås-toggles |
| `src/components/admin/LayerInspector.tsx` (ny) | Defaults + locks per valt lager |
| `src/components/admin/AlignmentGuides.tsx` (ny) | Visar guides under drag |
| `src/components/editor/layers/MapLayer.tsx` (ny) | EN map-instans (extraherad från `MapPreview`) |
| `src/components/editor/layers/TextLayer.tsx` (ny) | EN text-block |
| `src/components/editor/layers/ImageLayer.tsx` (Fas 2) | EN bild |
| `src/components/editor/layers/LineLayer.tsx` (Fas 3) | EN linje |
| `src/components/editor/layers/MarginLayer.tsx` (Fas 3) | Vita kanter |
| `src/components/editor/MapPreview.tsx` | Refaktor: loopar `template.layers` i zIndex-ordning |
| `src/components/editor/ControlPanel.tsx` | Refaktor: visar unlocked lager + relevanta kontroller |
| `src/components/editor/FormatSection.tsx` | Filtrera sizes/variants via `template.productOptions`; dölj produkt-pill om bara en typ enabled |
| `src/stores/editorStore.ts` | `layerValues`, `setLayerValue(id, partial)`, init från defaults |
| `src/lib/editor-snapshot.ts` | Tar `template + layerValues`, sekventiell map-render |
| `src/lib/print-pipeline.ts` | Ny `source: "composite"` för multi-lager |
| `src/pages/AdminConfigs.tsx` | "Skapa ny mall" + "Redigera mall" → /admin/designer, mall-thumbnails |
| `supabase/functions/shopify-inject-editor/index.ts` | Synka template-titel/handle vid publicering |

### Inbyggt redan från start (ej uppskjutet)

1. **Produkt & variant-skoping per mall**: `productOptions`-block styr exakt vilka produkttyper, storlekar, ramar och djup mallen säljs som. Filtreras både i admin-validering och kund-editor.
2. **Default-värden vs kund-värden**: schema kräver `defaults` per lager. Kund-store initialiseras från defaults; UI markerar "förifyllt av admin".
3. **Z-index + omorganisering**: lager-lista i admin är drag-sorterbar; `zIndex` skrivs om vid ändrad ordning. Snapshot ritar i `zIndex`-ordning.
4. **Snap-to-grid + alignment-guides**: 5%-grid alltid på, guides visas under drag (centrum, edges, andra lagers kanter).
5. **"Visa som kund" preview-läge**: knapp i admin → öppnar publik editor mot draft-template via `previewToken`. Visar exakt vad som är låst/unlocked OCH vilka produktvarianter kunden kan välja.
6. **Versioning**: draft vs published, live-orders läser alltid senaste `publishedAt`.
7. **GPU-budget**: sekventiell map-render i snapshot, adaptiv `pickHiresMaxPx` utökas att räkna antal kartor.
8. **Aspect-validering**: admin kan inte spara om lager hamnar utanför FRONT-zon eller överlappar margin-lager.
9. **Cart-properties**: dagens platta `_map_center` ersätts av `_layers` (JSON-string per-lager-värden). Webhook använder fortfarande bara `_print_file_url` + `_preview_image`.
10. **Mall-thumbnails** i `AdminConfigs.tsx`: autogenereras från defaults.

### Medvetet uppskjutet

- AI-modifiering av bilder per lager (Fas 4, kundsidan).
- Animationer / interaktiva mallar.
- Kund-konton ("spara design för senare").
- Cleanup-cron för gamla drafts (efter 30 dagar, lågt prio).

### Verifiering per fas

**Fas 1**: Skapa mall i admin — aktivera bara Poster med sizes [30x40, 50x70] och frames [Ingen, Vit]. Lägg 2 kartor + 1 text, drag/snap fungerar, omorganisera zIndex, lås text-position. "Visa som kund" → produkt-pill dold, bara 2 sizes och 2 frames syns, text inte flyttbar, kartor pannerbara. Publicera → /editor → "Lägg i varukorg" → cart-preview = båda kartor + text → Gelato print-fil = samma layout, ingen ram.

**Fas 2**: Mall med karta + bild-upload → kund laddar upp foto → preview kombinerar → print-fil är hi-res komposit.

**Fas 3**: Mall med 5 mm vit marginal + 2 mm svart linje → fysisk Gelato-sample matchar exakt.

**Fas 4**: Per image-lager kan kund köra AI-stil utan att övriga lager påverkas.

