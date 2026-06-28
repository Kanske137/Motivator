## Mål
Behåll exakt samma logik för vilken flik som är "nästa steg" (drivs redan av `useOnboarding` → `activeHintSection`). Byt bara ut den blinkande pricken i `NavRail` mot en liten textetikett:

- Första oklara fliken i ordningen → "Börja här"
- Alla efterföljande oklara flikar (när tidigare är klara/dismissade) → "Fortsätt här"

Inget annat beteende ändras: dismiss, auto-complete, dwell-timer och `OnboardingHint`-bubblan inuti panelen behålls oförändrade.

## Ändringar

### 1. `src/components/editor/NavRail.tsx`
- Ta bort den blinkande prick-noden (`animate-ping` + `bg-primary`) som renderas när `showHint` är true.
- Lägg istället till en liten text-badge ovanför/under ikonen när `showHint` är true. Texten kommer från i18n-nyckel:
  - `onboarding.startHere` när det är första fliken i `sections`-listan (index 0)
  - `onboarding.continueHere` annars
- Stil: mycket liten (text-[9px] eller text-[10px]), uppercase tracking, `text-primary`, ev. mjuk `animate-fade-in`. Placeras så att den inte bryter rail-layouten (absolut positionerad ovanför ikonen, eller som extra rad under labeln). Förslag: absolut positionerad badge `top-1` (vertikal rail) / motsvarande på horisontell, så befintlig ikon+label-layout inte rubbas.
- Horisontell mobile-rail: samma badge, positionerad t.ex. `top-0.5 right-1`.

Note: vi behöver veta vilken position fliken har för att välja text. Enklast: skicka in `sections`-indexet, eller jämför `s.id` med `sections[0].id` inne i map-callbacken (vi har redan `sections` i scope).

Detalj för "Börja här vs Fortsätt här": det är inte flikens position i `sections` som avgör — det är om kunden har slutfört/dismissat tidigare flikar. Bättre regel:
- Om INGEN annan flik har `completed[id]` true → "Börja här"
- Annars → "Fortsätt här"

Det matchar kundupplevelsen: helt orörd editor visar "Börja här" på bild-fliken; efter att man laddat upp en bild flyttas hinten till nästa flik och visar "Fortsätt här".

### 2. `useOnboarding` (`src/hooks/useOnboarding.ts`)
Lägg till en härledd flagga `hasAnyCompleted` (true om något i `completed` är true) och exportera den, så `NavRail` kan välja rätt etikett utan att duplicera logik. Alternativt: exportera `isFirstStep: boolean` direkt.

### 3. i18n
Lägg till nycklar i alla locales (`sv` källa + `en/de/no/da/fi/fr/es/it/nl/pl`):

```
onboarding.startHere     // sv: "Börja här"
onboarding.continueHere  // sv: "Fortsätt här"
```

Översättningar per språk (förslag):
- en: Start here / Continue here
- de: Hier starten / Hier weiter
- no: Start her / Fortsett her
- da: Start her / Fortsæt her
- fi: Aloita tästä / Jatka tästä
- fr: Commencer ici / Continuer ici
- es: Empieza aquí / Continúa aquí
- it: Inizia qui / Continua qui
- nl: Begin hier / Ga verder hier
- pl: Zacznij tutaj / Kontynuuj tutaj

### 4. Oförändrat
- `OnboardingHint` (bubblan i panelen) – ingen ändring.
- `useOnboardingStore`, auto-complete-effekter, dwell-timer – ingen ändring.
- "Skapa själv"-flödet (layers-onboarding-dialog) – ingen ändring.

## Verifiering
- Öppna editor på en standardmall: bild-fliken visar "Börja här" istället för prick.
- Ladda upp en bild → bild-fliken tappar badge, nästa flik visar "Fortsätt här".
- Dismiss-knappen i `OnboardingHint` fortsätter dölja både bubblan och nav-rail-badgen för den fliken.
- Inget visuellt ändras för flikar utan aktiv hint.
