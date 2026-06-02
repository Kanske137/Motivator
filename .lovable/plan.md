## Felanalys

Jag har jämfört nuvarande kod med historiken där fotopan infördes/ändrades:

- `b5ee826` införde kund-pan för fotolager och lät drag alltid skriva `offsetX/offsetY` när `fit="cover"`.
- `48d28d7` lade till naturliga bildmått, pan-bounds och clampning så bilden inte kan dras utanför sin behållare.
- `11a0d67` ändrade renderingen till att rita bilden i faktisk cover-storlek, vilket behövs för att editorn och print-snapshot ska matcha.
- Nuvarande kod stoppar drag helt när `maxX === 0 && maxY === 0`, och all pan är beroende av att `ResizeObserver` + `naturalWidth/naturalHeight` hinner ge overflow. Det gör att panning upplevs som trasig när overflow blir 0, mycket liten, eller när pointer-händelser tappas vid rerender/capture.

## Plan

1. **Behåll befintlig funktionalitet och ändra bara fotopan**
   - Ingen ändring av mallar, admin-layout, uppladdning, AI-flöde, priser, textlager, kartor, ramrendering eller Shopify/Gelato-flöden.
   - Fokus endast på `photo`-lagrets interaktion och matchande snapshot-rendering.

2. **Gör pan-interaktionen robust igen i `MapPreview.tsx`**
   - Låt pointer-down alltid starta drag för uppladdade foton i `cover`-läge.
   - Lägg `preventDefault()` och `stopPropagation()` på fotodrag så drag inte krockar med layer-flytt, textlager eller scroll.
   - Flytta drag tracking till `window`-baserade `pointermove/pointerup` under aktiv dragning, så drag inte tappas om React rerenderar medan offset uppdateras.
   - Fortsätt clampa mot verkliga bildkanter när det finns overflow, så bilden aldrig kan lämna tomma ytor.
   - Om en axel saknar overflow låses bara den axeln, inte hela draget.

3. **Säkerställ att editorns visuella pan och print/cart-preview använder samma matematik**
   - Behåll nuvarande cover-crop-princip: `scale = max(layerW/imgW, layerH/imgH)`.
   - Säkerställ att `offsetX/offsetY` betyder samma sak i DOM-preview och `template-snapshot.ts`.
   - Om en liten helper behövs för att undvika framtida regression skapas den minimalt och används bara av fotolager/snapshot.

4. **Lägg till en snäv regressionskontroll**
   - Testa med en bred bild i ett stående fotolager: horisontell pan ska fungera.
   - Testa med en stående bild i ett brett fotolager: vertikal pan ska fungera.
   - Testa bild med samma aspekt som lagret: ingen falsk pan ska skapas eftersom inget är beskuret.
   - Kontrollera att uppladdning, AI-stilresultat och cart-preview fortfarande läser samma `offsetX/offsetY`.

## Förväntat resultat

Kunden ska kunna dra/panna uppladdade foton i fotolager igen när bilden faktiskt beskärs av `cover`, utan att vi ändrar hur andra lager, layoutval, admininställningar eller print-pipeline fungerar.