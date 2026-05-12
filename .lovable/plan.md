# Stabil canvas-layout över alla storlekar

## Problem

Idag lagras `canvasLayout`-lagrens `xPct/yPct/wPct/hPct` relativt **hela editor-ytan = front + 2 × wrap (cm)**. Eftersom wrap är konstant i cm men front växer med storleken, krymper wrap-andelen procentuellt på större canvas. Resultat: ett lager som ligger 25 % från toppen på 30×40 cm hamnar visuellt på en annan plats på frontytan när kunden väljer 50×70 cm. Att kompensera per storlek (`sizeOverrides`) är ohållbart.

## Lösning – ankra canvas-lager till FRONT-ytan

Behandla `canvasLayout` på samma sätt som `defaultLayout`: koordinater är % av **frontytan** (synliga ytan), inte av hela editorn. Wrap-bandet ritas automatiskt runt frontytan vid render/print för aktuell vald djup, utan att flytta lagren. Layout blir då storleksoberoende — samma % av fronten oavsett 30×40 eller 70×100.

Bakgrund och full-bleed-media (kart-, foto-, bildlager som rör frontens kant) extenderas automatiskt ut i wrap-bandet så att kanterna inte blir tomma.

## Tekniska ändringar

### 1. Datamodell & migration
- Tolka `canvasLayout`-koordinater som **front-relativa** (samma kontrakt som `defaultLayout`).
- En engångs-migration i `template-migrate.ts` konverterar befintliga `canvasLayout` från full-area-% till front-%-koordinater med hjälp av `getCanvasDesignDepthCm(template)` och layoutens aspekt:
  ```text
  insetX = wrap / (frontW + 2*wrap)
  insetY = wrap / (frontH + 2*wrap)
  newX  = (oldX - insetX*100) / (1 - 2*insetX)
  newW  =  oldW            / (1 - 2*insetX)
  (analogt för y/h)
  ```
  Markera migrerad mall med `version`-bump eller flagga i `canvasLayout` så den inte konverteras två gånger.
- `canvasDesignDepthCm` blir endast informativt (vilket djup admin tittade på i designern); påverkar inte längre hur lager mappas.

### 2. Render – `MapPreview.tsx`
- Sätt `layersIncludeWrap = false` för canvas (eller ta bort flaggan helt). `frontInsetX/Y`-vägen finns redan och löser positionerings­problemet automatiskt.
- Lägg till **bleed-extension** för full-bleed-lager: när ett lagers rektangel rör frontens kanter (xPct ≤ 0.5 / yPct ≤ 0.5 / right ≥ 99.5 / bottom ≥ 99.5) extenderas det med `wrapCm`-motsvarande % ut i wrap-bandet i renderrutinen. Bakgrundsfärgen ritas alltid genom hela editor-ytan (redan så).

### 3. Admin – `DesignerPage.tsx` + canvas-designyta
- Visa frontytan som primär designyta. Wrap-bandet ritas runt som en streckad/halvtransparent zon (visuellt — ingen drag-yta), märkt "Wrap (extenderas automatiskt)".
- Drag/klamp av lager sker i front-koordinater (`xPct ∈ [0,100]` är frontytan). Inga manuella justeringar för bleed behövs — render/print extenderar automatiskt.
- Behåll `canvasDesignDepthCm`-väljaren bara som visualiseringshjälp (visar hur tjock wrap-zonen tecknas), inte för koordinatmatte.

### 4. Print/snapshot – `print-pipeline.ts` & `template-snapshot.ts`
- Använd samma front-inset-logik: rita lager i frontytan, extendera markerade full-bleed-lager med wrap-cm. Det Gelato-PDF-utbytet får då rätt bleed automatiskt oavsett vald canvasstorlek.
- Ta bort/uppdatera `wrapCm`-passering så koordinatomvandlingen sker centralt (en helper `withCanvasWrap(layer, frontW, frontH, wrapCm)` som returnerar print-rekt med bleed).

### 5. Editor-store
- Inget kontraktsbrott externt; `layersIncludeWrap`-prop till `MapPreview` blir false för canvas. Mirror-logik för `setOrientation`/`setConfig` är oförändrad.

## Effekt

- En canvas-mall designas en enda gång på frontytan och håller exakt samma layout visuellt på 30×40, 50×70, 70×100 osv.
- Wrap-bandet hanteras automatiskt via bleed-extension för bakgrund och kantnära media.
- Inga per-storlek-overrides krävs.

## Risker att täcka i implementation

- Befintliga publicerade canvasmallar måste migreras vid load (icke-destruktivt — original sparas inte över förrän admin sparar nästa gång, men rendering följer migrerad version).
- Lager som admin medvetet placerat **i** wrap-bandet (sällsynt, t.ex. dekoration på sidan) konverteras till frontkoordinater där `x/y < 0` eller `> 100` kan uppstå. Vi clampar dem till frontytan vid migration och loggar en varning i designern så admin kan justera.
