# Face-swap fix + UI-förbättringar på kundsidan

## Varför misslyckades skapandet?

Edge function-loggen säger:
```
[face-swap] error: Replicate succeeded but produced no output URL
subjectKind=dog
```

Modellen vi använder (`cdingram/face-swap`) är **enbart tränad på mänskliga ansikten**. När den får en hund eller katt — eller en bild där den inte hittar ett tydligt mänskligt ansikte — returnerar den `null` istället för en bild, och vi kastar ett fel.

Det är alltså inte ett buggat anrop, utan fel modell för djur. För människor fungerar den bra; för katt/hund behövs en annan strategi.

## Vad jag föreslår att vi gör

### 1. Byt till en mer kapabel modell (huvudfix)
Använd `flux-kontext-apps/face-swap` (eller motsv. Kontext-baserad modell på Replicate) som styrs av prompten admin redan skriver. Den:
- accepterar prompt + två bilder
- klarar djur betydligt bättre eftersom den inte är låst till ansiktsdetektor
- respekterar instruktioner som "behåll kläder/miljö, byt bara ansiktet på hunden"

Adminens prompt (`Replace only the dog's face…`) skickas in direkt — det är precis det som behövs.

### 2. Bättre felmeddelanden
- Om Replicate returnerar tom output → visa kunden "Vi kunde inte hitta ett tydligt ansikte i din bild. Prova en annan bild med bra ljus."
- Returnera 200 med `{ error, fallback: true }` istället för 500, så frontend kan visa ett vänligt felmeddelande utan att krascha.
- Validera att uppladdad bild är < 10 MB innan vi ringer Replicate.

### 3. Kund-UI-städning (det du bad om)

I `src/components/editor/AiPhotoSection.tsx`:
- **Ta bort hela "Stilreferens"-blocket** (raderna med admin-bilden + "Visa referensbilden istället"-knappen). Kunden ser bara sin egen uppladdning + slutresultatet.
- **Knapp**: `"Skapa AI-bild" / "Skapa AI-bild igen"` → `"Skapa nu" / "Skapa igen"`.
- Toast-texter: `"AI-bild skapad"` → `"Bilden är klar"`, `"Kunde inte skapa AI-bild"` → `"Kunde inte skapa bilden"`.

I `src/components/editor/ControlPanel.tsx`:
- **Flikens namn** `"AI-bild"` → välj ett av förslagen nedan.

## Förslag på nytt namn för fliken (välj ett)

| Förslag | Känsla |
|---|---|
| **Porträtt** | Klassiskt, passar både människor och djur |
| **Karaktär** | Lekfullt, fungerar för "kungar/prinsessor"-temat |
| **Förvandling** | Beskriver vad som händer (du blir en kung osv) |
| **Din bild** | Neutralt, väldigt tydligt vad fliken gör |
| **Motiv** | Kort, snyggt, generiskt |

Min favorit givet konceptet (riddare/prinsessa/husdjur som kung): **Förvandling** eller **Karaktär**. Säg till vilket du vill ha så använder jag det — annars defaultar jag till **Förvandling**.

## Filer som ändras

- `supabase/functions/replicate-face-swap/index.ts` — byt modell, bättre felhantering
- `src/components/editor/AiPhotoSection.tsx` — ta bort stilreferens-block, ändra knapptexter och toasts, hantera `fallback`-svar
- `src/components/editor/ControlPanel.tsx` — byt fliknamn (default: "Förvandling")

Adminsidan rörs inte — där behåller vi all info inkl. referensbild och prompt.
