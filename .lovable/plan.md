## Mål
I "fri mall"-läget ska kunden kunna:
1. Välja **vilken form** som läggs till (rektangel, oval, rundad, dubbel ram, hörn).
2. Välja **riktning på linje** (horisontell/vertikal) — och byta efteråt.
3. **Flytta och resiza** form- och linjelager direkt i previewen.

Inget annat beteende rörs — texter, bilder, karta, AI-bild, margin och admin-låsta lager fungerar exakt som idag.

## Ändringar

### 1. Val av form vid skapande (`LayersSection.tsx`)
När kunden väljer "Form" i bottensheeten öppnas ett extra steg i samma sheet med 5 ikon-knappar (Rektangel / Oval / Rundade hörn / Dubbel ram / Hörn). Klick → skapar lagret med rätt `defaults.kind`.

Tillägg i `createFreeformLayer` (`src/lib/freeform-layers.ts`): acceptera valfri `shapeKind`-parameter, default fortfarande `frame-rect` (bakåtkompatibelt).

För linje samma mönster: i sheeten visas två val (Horisontell / Vertikal) innan lagret skapas. `createFreeformLayer("line", { lineOrientation })`.

### 2. Per-lager mini-inspector (ny: `LayerQuickSettings.tsx`)
Liten popover-knapp (kugghjul-ikon) i varje rad i `LayersSection` — visas endast för custom shape/line-lager. Innehåll:
- **Shape**: 5 form-knappar (byter `defaults.kind`), färgväljare, tjocklek-slider (`strokeMm`, 0.5–6).
- **Line**: orientering-toggle (horisontell/vertikal), färg, tjocklek (`thicknessMm`).

Skriver via befintlig `mutateActiveLayoutBlock` genom ny store-action `updateLayerDefaults(id, partial)`.

### 3. Move + resize i kundpreview (`MapPreview.tsx`)
Utöka `movable`-villkoret (rad 492-494) så `shape` och `line` också är dragbara när `!l.locks.move`. Sätt `pointerEvents: 'auto'` för dessa via `isInteractiveLayer`-utvidgningen så grip-knappen fungerar (utan att blockera bakomliggande klick — wrappern behåller `pointer-events:none`, bara handtag och resize-grepp är klickbara).

**Resize-handtag** (nytt, scope: shape + line custom-lager): en liten kvadrat i nedre högra hörnet (likt move-knappen som finns idag). Pointer-drag → uppdaterar `wPct`/`hPct` via samma `setLayerTransform` + `clampLayerRect`. För linjer låses kortsidan (height för horisontell, width för vertikal) så bara längden ändras.

### 4. Store (`editorStore.ts`)
- Ny: `updateLayerDefaults(id, partial)` — typad union per lagertyp, ren shallow-merge av `defaults`.
- Befintligt `setLayerTransform` används oförändrat för move/resize.

### 5. i18n (`sv.json` källa + 10 språk)
Nya nycklar:
```
layers.shape.pickTitle, layers.shape.rect/oval/rounded/double/corners
layers.line.pickTitle, layers.line.horizontal/vertical
layers.settings (kugghjul-tooltip)
layers.stroke, layers.color, layers.thickness
```

## Tekniska detaljer

- `template-schema.ts` rörs **inte** — alla fält finns redan (`kind`, `orientation`, `strokeMm`, `thicknessMm`, `color`).
- Print/snapshot-pipeline rörs **inte** — lagren skrivs tillbaka via `mutateActiveLayoutBlock` precis som dagens add/remove.
- Admin-låsta (template) shape/line-lager påverkas inte: `locks.move`/`locks.size` respekteras; quick-settings visas bara för `isCustomLayerId`.
- Drag-reorder, visibility-toggle, onboarding och CTA-validering från förra ronden lämnas orörda.

## Filer
- `src/components/editor/LayersSection.tsx` (utöka sheet-flöde, ny quick-settings popover per rad)
- `src/components/editor/LayerQuickSettings.tsx` (ny)
- `src/components/editor/MapPreview.tsx` (movable + nytt resize-handtag)
- `src/lib/freeform-layers.ts` (acceptera `shapeKind`/`lineOrientation`)
- `src/stores/editorStore.ts` (ny `updateLayerDefaults`)
- `src/i18n/locales/*.json` (11 filer, nya nycklar)
