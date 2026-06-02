Jag hittade orsaken: pan av själva bilden är inte kopplad till `move`-låset. `move` styr bara om hela lagrets position kan flyttas via det lilla flytt-handtaget. Bild-pan fungerar i `PhotoLayerView` när lagret är `cover`, bilden faktiskt har overflow, och pekaren når fotolagret.

Det som sannolikt stoppar det nu är lagerstack/pointer-events: ovanpåliggande lager som text/shape/image kan ligga över fotolagret och fånga klick/drag, även när de är kund-låsta. I den aktuella `brollopskarta`-mallen finns flera lager med samma/överliggande `zIndex`, och sådana låsta dekor-/textlager kan därmed blockera pan på bilden.

Plan:

1. Uppdatera kundpreviewn i `MapPreview.tsx` så att låsta, icke-interaktiva lager inte fångar pointer-events.
   - Textlager ska bara fånga klick när de faktiskt är redigerbara i kundvyn.
   - Statiska bild-/shape-/line-/margin-dekorationer ska inte blockera underliggande foto/map-lager.
   - Map/foto/AI-foto behåller interaktion när deras respektive interaktion är tillåten.

2. Gör fotopan oberoende av fel lås-tolkning.
   - För vanliga `photo`-lager ska uppladdad bild kunna pannas när `defaults.fit === "cover"` och bilden är större än behållaren i minst en riktning.
   - `contain` ska fortfarande inte gå att panna eftersom inget beskärs.
   - `move` fortsätter bara betyda “flytta hela lagret”, inte “panna bilden inuti lagret”.

3. Förtydliga adminlåsen visuellt/semantiskt där det behövs.
   - Låset du tänker på för att ändra kartans pan/zoom är `Position (karta pan/zoom)`.
   - För bildlager är pan av uppladdad bild egentligen `Innehåll`/uppladdningsytan + `cover`, inte `Move`.
   - Jag lägger till/justerar intern kommentar eller UI-hjälptext om det behövs så detta inte blandas ihop igen.

4. Validering.
   - Kontrollera att en uppladdad bild i fotolager kan dras igen i kundvyn.
   - Kontrollera att kartpan fortfarande fungerar där `position` är upplåst.
   - Kontrollera att flytta-lager-handtaget fortfarande bara visas när `move` är upplåst.