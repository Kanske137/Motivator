## Problem

De streckade linjerna som markerar var fronten slutar och wrap/sidan börjar syns inte i praktiken på canvas-mallar — varken i admin-designern eller i kund-editorn. I admin-designern täcks markören av kart-/bildlager (markören saknar z-index, layer-Rnd har `zIndex: layer.zIndex + 1`). I kund-editorn finns markören med `zIndex: 9999` men kontrasten är så låg (`border-foreground/40`, ingen bakgrundsskugga) att den försvinner mot kartan.

Detta gäller endast designytorna — preview, thumbnails och tryckfil ska förbli orörda.

## Fix

### 1. `src/components/admin/LayerCanvas.tsx`
- Sätt `zIndex: 9998` på den skuggade wrap-bandet och `zIndex: 9999` på den streckade ramen så den ALLTID hamnar ovanpå alla layer-Rnd-element.
- Byt rambygden till tydligare färg: `border-2 border-dashed` med `borderColor: hsl(var(--primary))` och en `boxShadow: 0 0 0 1px hsl(var(--background) / 0.9)` så den syns mot både ljus och mörk bakgrund (kartor m.m.).
- Höj label "Synlig framsida" till `zIndex: 10000`, gör den till en solid primary-pill (`bg-primary text-primary-foreground`) så den läses tydligt.

### 2. `src/components/editor/MapPreview.tsx` (kund-editorn)
- Behåll `zIndex: 9999` men gör den streckade fronten tydligare: `border-2 border-dashed` med `borderColor: hsl(var(--primary))` och samma `boxShadow` outline-trick.
- Lyft labeln "Synlig framsida · innehållet här viks om på sidorna" till `zIndex: 10000` med solid primary-pill.

### Inga andra filer ändras
Snapshot-/print-pipeline, thumbnails, mockups och 3D-preview ska inte få markören — de är redan korrekta.

## Resultat
Den streckade ramen som visar gränsen mellan synlig front och wrap-zon är alltid synlig ovanpå alla lager i både admin-designern och kund-editorn på canvas-mallar.
