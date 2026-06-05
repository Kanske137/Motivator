# Plan: Stabilare removeBackground (bakgrund, position, färg)

## Bakgrund

`runRemoveBackground` i `supabase/functions/replicate-face-swap/index.ts` (rad 475–568) bygger en lång prompt där **steg 2** hårdkodar "PURE WHITE #FFFFFF backdrop" och **steg 5** tvingar "FILL THE FRAME 90–95%" — vilket aktivt skalar om och flyttar subjektet. `adminPromptLine` ligger sist och kan därför inte överstyra detta. Det är troligen huvudorsaken till att bilen flyttas/zoomas och att bakgrundsfärgen ibland avviker (modellen försöker väga ihop motstridiga instruktioner).

Idag är allt hårdkodade strängar i edge-funktionen — varken backdrop-färg eller fill-frame går att styra per mall.

## Mål

- Subjektet behåller uppladdad position, storlek och proportioner.
- Bakgrunden blir exakt den färg admin anger per mall (default vit, bakåtkompatibelt).
- Subjektets grundfärg/nyans bevaras även när konststil läggs på (stilen = ytbehandling).
- Vi kan se exakt vilken prompt modellen får för en given körning.

## Ändringar

### 1. Schema: nya, valfria fält på aiPhoto-lagret
Fil: `src/lib/template-schema.ts` (`aiPhotoDefaultsSchema`)

Lägg till tre nya valfria fält (alla bakåtkompatibla — om de saknas faller vi tillbaka på dagens beteende):

- `backdropColor?: string` — hex, t.ex. `#FFFFFF`. Default = `#FFFFFF`.
- `fillFrame?: boolean` — om `false` instrueras modellen att bevara subjektets ursprungliga position och storlek istället för att skala upp till 90–95%. Default = `true` för att inte ändra befintliga mallar.
- `preserveSubjectColors?: boolean` — när `true` läggs en stark färgbevarande instruktion in **tidigt** i prompten. Default = `true`.

### 2. Admin-UI: exponera fälten
Fil: `src/components/admin/LayerInspector.tsx` (sektionen för `aiPhoto` när `subjectKind === "removeBackground"`):

- Färgväljare för `backdropColor`.
- Toggle "Fyll ramen (skala upp subjektet)" → `fillFrame`.
- Toggle "Bevara subjektets originalfärger" → `preserveSubjectColors`.

### 3. Klient skickar fälten vidare
Fil: `src/components/editor/AiPhotoSection.tsx` — utöka `supabase.functions.invoke("replicate-face-swap", { body: ... })` med `backdropColor`, `fillFrame`, `preserveSubjectColors` från `layer.defaults`.

### 4. Edge-funktion: parametrisera prompten
Fil: `supabase/functions/replicate-face-swap/index.ts`

a) `Deno.serve` (rad 570+): läs de tre nya fälten från `body`, validera och skicka in i `runRemoveBackground`.

b) `runRemoveBackground` (rad 475–568):
- **Steg 2 (backdrop)**: använd `params.backdropColor ?? "#FFFFFF"`. Om färgen ≠ vit, skriv om instruktionen så den anger den exakta hex-färgen och tar bort referenser till "pure white web page" (annars motsäger sig prompten själv).
- **Steg 5 (fill frame)**: om `params.fillFrame === false`, ersätt hela `fadeInstruction` med en "PRESERVE EXACT FRAMING"-instruktion: subjektets position, skala, rotation och beskärning i utdata ska vara identiska med inmatningen — endast bakgrunden bytas ut. Annars: behåll dagens text.
- **Ny tidig identitets-/färginstruktion** (placeras som steg 1.5, före backdrop): om `preserveSubjectColors !== false`, lägg in en explicit regel: "Preserve the subject's original colors, hue, saturation and material/paint tone exactly as in the input. Any artistic style mentioned below is a surface treatment only and must NOT shift the subject's base colors." Denna kommer alltså tidigt och inte sist.
- **Flytta `adminPromptLine` tidigare**: lägg den direkt efter identitets-/färginstruktionen (före backdrop och fill-instruktionerna) så admin kan överstyra defaultbeteendet utan att hamna sist i kön. `styleBlock` ligger kvar i nuvarande position.
- **Aspect-instruktionen** måste också bli villkorlig: när `fillFrame === false` ska den inte säga "scaled up to fill"; den ska bara ange aspect.

c) **Logga den faktiska prompten**: precis före `callNanoBanana(...)` lägg till `console.log("[runRemoveBackground] prompt", { designIdOrLayer, length: promptText.length, promptText })`. Lägg också till en logg-rad för `params` (utan bilden) så det är enkelt att läsa körningen i edge-loggarna.

### 5. Verifiering

- Deploya `replicate-face-swap`.
- Kör en testkörning från preview på bilposter-mallen med (a) default-värden, (b) `fillFrame=false`, (c) `backdropColor="#0F172A"`. Läs edge-loggarna och bekräfta att den loggade prompten matchar konfigurationen och att resultatet bevarar position/färg enligt önskemål.

## Tekniska detaljer

**Promptordning efter ändring** (alla `Boolean`-filtrerade):
1. `Edit the input photo:`
2. Isolera subjekt (oförändrad)
3. **NY**: Preserve subject base colors (om `preserveSubjectColors`)
4. **FLYTTAD**: `adminPromptLine` (admin har nu hög prioritet)
5. Backdrop (parametriserad med `backdropColor`)
6. `ringInstruction` (oförändrad logik)
7. `edgeInstruction` (oförändrad)
8. `fadeInstruction` ELLER ny "preserve framing" (beroende på `fillFrame`)
9. Identitetsraden ("Keep subject identity…")
10. `styleBlock`
11. `aspectInstruction` (villkorlig variant när `fillFrame=false`)

**Bakåtkompatibilitet**: alla nya fält är optional med defaults som motsvarar dagens beteende, så befintliga mallar fortsätter rendera identiskt tills admin aktivt ändrar något.

**Inga ändringar i**: `pricing.ts`, `print-pipeline.ts`, cache-nycklar (resultatet cachas redan per `(face, style)` och påverkas inte av nya prompt-fält — vill du att backdrop-färgsbyte ska ge ny cache-slot lägger vi till det, men det är inte föreslaget här).

## Frågor jag vill svara på i förväg (från ditt meddelande)

- **Var hämtas styleBlock/adminPromptLine?** Båda byggs lokalt i `runRemoveBackground` (rad 492–506) av `params.stylePrompt` (kommer från `aiStyles`-preset, valt av kund) respektive `params.adminPrompt` (kommer från `aiPhoto`-lagrets `swapPrompt`).
- **Hårdkodat?** Ja: "#FFFFFF" och "90-95%" är fasta strängar i rad 510, 513–518, 549, 554. Inget kommer från config.
- **Vad händer om adminPromptLine flyttas tidigare?** Generativa modeller ger tidigare instruktioner högre vikt vid konflikt. Att flytta admin-raden uppåt (tillsammans med att göra fill-frame valfri) bör ge admin reell kontroll utan att vi måste skriva om hela scaffolden per mall.
