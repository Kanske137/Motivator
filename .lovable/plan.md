## Mål
Lägg på en global blockerande overlay (ljus blur + minimal centrerad spinner/procent/stage-text) över hela editorn så fort en AI-process pågår — oavsett vilken sektion som startat den (AI-stil på foto, face-swap, object-swap, remove-background, m.fl.). Overlayen ersätter den lokala `AiProgress` i panelen så länge den är aktiv, och på mobil stängs den öppna bottom-sheet/drawern automatiskt så kunden ser själva editorn under tiden.

## Användarupplevelse
- En AI-knapp trycks → overlay tonas in över hela editor-shellen inom 100 ms.
- All interaktion blockeras: panel, flikar i `NavRail`, preview, sticky CTA. `Esc` och bakåt-swipe stängs av medan overlay är aktiv.
- Mobil: om bottom-sheet (`Drawer` i `EditorShell`) är öppen → stäng den automatiskt vid start, så preview syns bakom blur.
- Lokal `AiProgress` i panelen göms när overlay är aktiv (en `isAnyAiBusy`-flagga).
- När processen är klar (success/fel) tonas overlay ut, panelen återgår till normal.

## Teknisk lösning

### 1. Ny global store: `src/stores/aiBusyStore.ts` (Zustand)
Spårar pågående AI-processer från valfri sektion. Multipla samtidiga jobb hanteras via Map (id → state); overlay visas om Map.size > 0.

```ts
type AiJob = { id: string; label: string; stage: string | null; expectedSeconds: number; startedAt: number };
state: { jobs: Record<string, AiJob> }
actions: startAiJob(id, {label, expectedSeconds}), updateAiJobStage(id, stage), endAiJob(id)
selectors: useIsAnyAiBusy(), usePrimaryAiJob() // det jobb som visas i overlay (senast startat)
```

### 2. Ny komponent: `src/components/editor/AiBusyOverlay.tsx`
- Fixed `inset-0`, `z-[60]` (över Drawer som är z-50), `bg-background/40 backdrop-blur-md`.
- Centrerat minimal-kort: liten `Loader2`-spinner + label + `XX %` + liten stage-rad under.
- Procent beräknas time-based (samma ramp-logik som dagens `AiProgress`: 90 % vid `expectedSeconds`, snap till 100 % vid stäng, fade out 300 ms).
- `role="status"`, `aria-live="polite"`, `aria-busy="true"` på editorroten.
- Pointer-events blockas i hela overlayen (inga klick går igenom).
- Renderas en gång globalt i `EditorShell`; läser från `aiBusyStore`.

### 3. Frysning av editorn
I `EditorShell.tsx`:
- Lyssna på `useIsAnyAiBusy()`.
- När busy: lägg `pointer-events-none select-none` + `aria-hidden="true"` på `.editor-body`-wrappern + sticky CTA-wrappern (overlayen själv ligger utanför).
- När busy: om `mobileOpen === true` → `setMobileOpen(false)` (useEffect på busy-flaggan).
- Förhindra Drawer-öppning: i `onSelectMobile` ignorera klick om busy (defensivt — flikarna är ändå pointer-events-none).

### 4. Wire-up i existerande sektioner
Tre platser där AI-jobb körs idag — samtliga ska byta från endast lokal `setBusyId/setStage` till att även anropa `startAiJob/updateAiJobStage/endAiJob`:

- `src/components/editor/AiStyleSection.tsx` (`applyStyle`) — `id = "ai-style:${layerId}"`, label = `t("ai.creatingImage")`, expectedSeconds = 12.
- `src/components/editor/AiPhotoSection.tsx` (huvudflödet runt rad 231–304) — id beroende på preset-typ (face-swap / object-swap / remove-bg / style), label hämtas från befintliga i18n-nycklar, expectedSeconds matchar befintliga värden (typ 25–40 s för face-swap).
- Eventuella andra ställen där `<AiProgress active=...>` används — sök och uppdatera (rg visar bara de två sektionerna idag).

Den lokala `<AiProgress>` i panelerna behålls i koden men renderas villkorat: `{!isAnyAiBusy && <AiProgress ... />}` så den gömts medan overlayen visas, och fungerar som fallback om overlay-rendering någon gång skulle hoppas över.

### 5. i18n
Nya nycklar i `src/i18n/locales/sv.json` (källa), översatta till `en/de/no/da/fi/fr/es/it/nl/pl`:
- `ai.overlay.title` → "Skapar din bild"
- `ai.overlay.subtitle` → "Det här tar bara en stund …"
- (Stage-texter återanvänds från befintliga `ai.stagePrep`, `ai.stageUpload`, `ai.stageCreate`, `ai.stageFetch`.)

### 6. Edge-fall
- Om ett jobb felar (`catch`) körs `endAiJob(id)` i `finally` → overlay stängs alltid.
- Om sidan unmountas mitt i: `endAiJob` triggas i en cleanup-effect.
- Flera samtidiga jobb (osannolikt men möjligt om kunden hinner trycka snabbt på två lager): overlay visar det senast startade; alla räknas i Map.size så overlayen ligger kvar tills alla är klara.

## Påverkade filer
- `src/stores/aiBusyStore.ts` (ny)
- `src/components/editor/AiBusyOverlay.tsx` (ny)
- `src/components/editor/EditorShell.tsx` (overlay-mount, pointer-events-frysning, auto-close Drawer)
- `src/components/editor/AiStyleSection.tsx` (wire-up + gömma lokal AiProgress)
- `src/components/editor/AiPhotoSection.tsx` (wire-up + gömma lokal AiProgress)
- `src/i18n/locales/{sv,en,de,no,da,fi,fr,es,it,nl,pl}.json` (nya nycklar för overlay-titel)

## Ej i scope
- Ingen ändring av edge-funktionerna (`replicate-style`, `replicate-face-swap`).
- Ingen ändring av cache-/upload-logik.
- Inga visuella ändringar utanför AI-flödet.
- Den lokala `AiProgress`-komponenten ändras inte — den göms bara villkorat.
