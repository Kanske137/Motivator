
## Sammanfattning

Fyra punkter. Alla buggar har bekräftats i koden:

1. **Linjer ser tjockare ut i print/3D & snappar inte längre** — editorn och snap-helpern använder olika referensenheter.
2. **Per-mall stående/liggande enable** — `template.orientations` finns redan men används inte som filter.
3. **"Lägg till figur"** — nytt lagertyp som ersätter "Lägg till linje" och stödjer linjer + ramar (rektangulär, oval, dubbel, dekorativ).
4. **Marginal i 3D-vyn hamnar på wrap istället för front** — `drawMarginLayer` ritar på hela tryckfilen istället för front-zonen.

---

## 1) Linje-tjocklek + snap (rotorsak)

**Problem:**
- `LineLayerView` (StaticLayers.tsx) ritar `thicknessMm * 0.5` i `cqw/cqh` av **lagrets egen box**. Lagret har drag-hitbox på 24px (`minHeight/minWidth` i LayerCanvas), vilket är mycket större än linjens visuella tjocklek. cqw/cqh räknas mot den boxen ⇒ blir ~rätt visuellt i editor men har **inget med riktiga mm att göra**.
- Print-pipelinen (`drawLineLayer`) ritar `thicknessMm * pxPerMm` ⇒ riktiga millimeter på tryckfilen. När du höjer mm för att se linjen i editor blir den **proportionellt enormt mycket tjockare i print/3D**.
- `lineThicknessPct` (snap) returnerar `thicknessMm * 0.5` % av canvasens kortsida — ännu en helt annan referens. Snap-toleransen (2%) träffar därför sällan rätt.

**Fix:**
- `LineLayerView` ändras att rita linjens tjocklek som **% av canvasens kortsida** via container-units mot canvasen (inte mot lager-boxen). Konkret: lägg `containerType: "size"` på MapPreview/LayerCanvas-roten (eller använd ett mätt pixelvärde via ResizeObserver i MapPreview/LayerCanvas och ge linjen `height: ${px}px`).
- Definiera **EN** delad konstant `lineThicknessShortSidePct(thicknessMm, sizeShortCm)` som returnerar samma % som print använder: `thicknessMm / (sizeShortCm * 10) * 100`. Editor och snap-helper använder samma funktion.
- Effekt: editor-visualen matchar print exakt; snap-toleransen (2% av kortsidan) träffar nu konsekvent.
- Behåller dock **drag-hitbox** (24px min) i Rnd så admin fortfarande kan greppa tunna linjer — det är ren CSS på Rnd-wrappern; den inre `LineLayerView` ritar fortfarande den korrekta tunna linjen flush mot ena kanten.

**Filer:** `src/components/editor/layers/StaticLayers.tsx`, `src/lib/layer-utils.ts`, `src/components/admin/LayerCanvas.tsx`, `src/components/editor/MapPreview.tsx` (lägg `containerType: "size"` på frame-elementet eller mät pixel-storlek och skicka ner via prop/context).

---

## 2) Per-mall enable för stående/liggande

**Status:** `template.orientations: ["portrait","landscape"]` finns i schemat men används inte som filter någonstans.

**Designer (admin):**
- Bredvid `Tabs` (Stående/Liggande) i `DesignerPage.tsx`: två `Switch` "Aktivera stående", "Aktivera liggande". Persisterar till `template.orientations`.
- Validering: minst en måste vara på (zod kräver redan `.min(1)`); UI förhindrar att slå av sista aktiva.
- Om aktiv tab disablas → switcha automatiskt till den andra.

**FormatSection (kund):**
- Filtrera "Orientering"-pillet på `template.orientations`. Om bara en orientering är aktiv → dölj hela pill-toggleln och tvinga den orienteringen i `editorStore` vid mount.
- Källa: editorStore behöver exponera `template.orientations` (eller `allowedOrientations`) — läses från `templateLayers()`-kontexten redan.

**Filer:** `src/pages/admin/DesignerPage.tsx`, `src/components/editor/FormatSection.tsx`, ev. `src/stores/editorStore.ts` (selector för allowed orientations).

---

## 3) "Lägg till figur" — utökad shape-layer

**Ny layer-typ** `shape` i `template-schema.ts`:
```ts
shapeKind:
  | "line-horizontal" | "line-vertical"
  | "frame-rect" | "frame-oval"
  | "frame-double" | "frame-rounded"
  | "frame-decorative-corners"
strokeMm: number      // tjocklek (mm, äkta mått som `line.thicknessMm`)
color: string
// frame-rounded: cornerRadiusPct
// frame-double: gapMm + outerStrokeMm
// frame-decorative-corners: cornerStyle ("art-deco" | "floral" | "minimal")
```

**Renderare (måste vara identisk i editor + kund-preview + print-snapshot):**
- Rektangulär ram → `strokeRect` med rätt mm-baserad linewidth
- Oval ram → `ellipse` + `stroke`
- Dubbel ram → två `strokeRect` med `gapMm`
- Rundad ram → path med `roundRect` (Canvas2D 2023+) eller manuell bezier
- Dekorativa hörn → SVG-paths inbäddade i `lib/shape-paths.ts`, både för DOM (kund/admin) och konverterade via `Path2D` i snapshot

**Pointer-events:** Hela `shape`-wrappern i MapPreview blir `pointer-events: none` (precis som dagens `line`/`margin`) — ingenting i mitten kan stjäla klick från karta/foto.

**Resize:** Rnd som vanligt. För frame-typer är alla 8 handtag aktiva, för line-typerna behåller vi dagens längd-axis-restriktion (men nu med `shapeKind === "line-horizontal" | "line-vertical"`).

**UI:** Knapp "Lägg till figur" → `DropdownMenu` med ikoner per typ. Befintlig `line`-typ behålls för bakåtkomp och migreras lazy via `template-migrate.ts` till `shape-line-h/v`.

**Filer:** 
- nya: `src/lib/shape-paths.ts`, `src/components/editor/layers/ShapeLayer.tsx`, `src/components/admin/AddShapeMenu.tsx`
- uppdaterade: `template-schema.ts`, `template-migrate.ts`, `template-snapshot.ts` (`drawShapeLayer`), `LayerCanvas.tsx`, `MapPreview.tsx`, `LayerInspector.tsx`, `LayerList.tsx`, `DesignerPage.tsx`, `layer-utils.ts` (factory)

---

## 4) 3D-canvas: marginalen ska ramma fronten, inte hela tryckfilen

**Rotorsak (bekräftad i `template-snapshot.ts:493-499`):**
```ts
} else if (layer.type === "margin") {
  const fullRect = { x: 0, y: 0, w, h };           // <-- HELA tryckfilen
  const shortPx = Math.min(w, h);                   // <-- inkl bleed+wrap
  drawMarginLayer(ctx, fullRect, layer, pxPerMm, shortPx);
}
```
För canvas är `w/h` = front + 2×wrap + 2×bleed. Marginalen ritas alltså som en ram runt **hela** tryckfilen ⇒ syns på wrap-sidorna i 3D istället för innanför streckade fronten. Asymmetrin du ser (topp/vänster vs botten/höger) kommer av att `shortPx` är hela tryckfilens kortsida — när motivet är portrait ≠ canvas-format hamnar marginal-tjockleken i fel proportion.

**Fix:**
- Byt till **front-zonens** rect och kortsida:
  ```ts
  const frontRect = { x: frontPxX, y: frontPxY, w: frontPxW, h: frontPxH };
  const shortPx = Math.min(frontPxW, frontPxH);
  drawMarginLayer(ctx, frontRect, layer, pxPerMm, shortPx);
  ```
- Effekt: marginalen ritas exakt innanför den streckade "synlig framsida"-rektangeln. I 3D-vyn syns vit marginal endast på frontfacet; wrap-facets får canvas bakgrundsfärg (motivet bakom marginalen sträcker sig som tidigare ut i wrap, vilket är rätt enligt Gelato).
- Sanitycheck för `Canvas3DPreview`: nuvarande UV-mappning är redan symmetrisk; när tryckfilen är symmetrisk runt fronten kommer alla fyra wrap-strippar matcha hörnen sömlöst.

**Filer:** `src/lib/template-snapshot.ts` (1 funktion), inga ändringar i `Canvas3DPreview.tsx` förväntas.

---

## Implementationsordning

1. **Punkt 4** (snabbast, isolerad fix i en funktion) — verifiera 3D direkt.
2. **Punkt 1** (rendering+snap) — viktig grundlogik som "Lägg till figur" bygger på.
3. **Punkt 2** (orienteringar) — UI + schema-användning, isolerat.
4. **Punkt 3** (figurer) — bygger på #1; störst diff. Migration av befintliga `line`-lager skrivs så ingen produkt går sönder.

Inga DB-migrationer behövs — allt lagras inuti `template` jsonb som redan finns.

## Frågor innan jag startar

Inga blockerande. Jag använder default-set av figurer (rect, oval, double, rounded, decorative-corners). Säg till om du vill exkludera/lägga till någon innan vi rullar ut.
