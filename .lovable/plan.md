## Sammanfattning av dina fyra punkter

Ja, jag är med på allt. Här är planen — 3 åtgärder + svar/åtgärd på fråga 4.

---

### 1. Snöret — från båge till trekant

Just nu ritas snöret med `quadraticCurveTo` (mjuk båge). Jag byter till två räta linjer som möts i en topp-punkt med en liten spik/prick där, så det ser ut som att snöret hänger på en spik — precis som i Gelato-bilden.

**Fil:** `src/lib/mockup-composite.ts` (rad ~262–270)

Pseudo:
```text
moveTo(vänster fästpunkt)
lineTo(mittpunkt, py - cordRise)   ← spetsen
lineTo(höger fästpunkt)
+ liten cirkel på spetsen = spiken
```

Samma uppdatering görs i `HangerIcon`-SVG:n i `FormatSection.tsx` (rad 42) så miniatyren i variantväljaren matchar.

---

### 2. Visa hängarval på 13x18 men inaktiverade

Idag filtreras varianter bort helt om priset saknas i `POSTER_PRICES["13x18"]` (där hängare inte finns). Jag ändrar så att hängarvarianterna ALLTID visas i listan när produkttypen är poster, men:

- Om vald storlek saknar pris för varianten → knappen renderas `disabled`, dimmad (~40% opacity), inte klickbar.
- Prisetiketten ersätts med texten **"Ej för denna storlek"** (liten, muted).
- Tooltip/hover-hint: *"Hängare finns inte i 13x18 — välj 21x30 eller större."*

**Filer:**
- `src/components/editor/FormatSection.tsx` — släpp filtreringen för hängar-varianter, skicka `disabled`-prop.
- `src/components/editor/FrameOption.tsx` — stöd för `disabled` (visuellt + `pointer-events-none`).

Säkerhetsnät: om någon ändå har "Hängare …" som vald variant och byter till 13x18, auto-hopp till `Ingen` (redan halva logiken finns för orientering).

---

### 3. Ny ek-textur (för både ram och hängare)

Den uppladdade bilden (`image-13.png`) är en ren ljus ek-träfiber. Jag:

1. Sparar den som `src/assets/textures/wood-oak.jpg` (ramminiatyr finns redan i `frameOak`, men den är annan stil — jag ersätter den med den nya så hela appen blir konsistent).
2. Ändrar `HANGER_HEX["Hängare Ek"]` från flat `#c8a371` till en bildbaserad fyllning. I canvas-rendern (`mockup-composite.ts` `drawSlat`) byter jag `ctx.fillStyle = hangerColor` mot en `createPattern(oakImage, "repeat")` när varianten är ek. Samma för ramen i `frame`-renderingen.
3. För variantväljarens svg-ikon (`HangerIcon` / ramminiatyr) använder jag bilden som bakgrund i en `<image>`-tagg inom SVG:n.

Valnöt, svart, vit förblir solida hex-färger som idag (de matchar redan bra). Endast ek byts till textur eftersom det är där flatfärgen sticker ut mest.

**Filer:**
- `src/assets/textures/wood-oak.jpg` (ny, från upload)
- `src/lib/mockup-composite.ts` — pattern-fill för ek-slat & ek-ram
- `src/components/editor/FormatSection.tsx` — `HangerIcon` använder texturen för ek
- Ev. `src/assets/frames/frame-oak.jpg` ersätts

---

### 4. Frågan — täcker hängaren motivet?

Bra observation. Svaret: **i verkligheten ligger trälisten ovanpå pappret men inte ovanpå motivet**, eftersom Gelato trycker hela A4/storleken med vit marginal i topp och botten där listen klämmer fast pappret. Pappret sticker alltså inte ut förbi listen — listen sitter på pappret — men motivet är centrerat innanför listen med ~1–1.5 cm whitespace över/under.

**Vår mockup gör fel idag**: den lägger listen direkt ovanpå motivets över- och nederkant utan whitespace, så det ser ut som att motivet kapas. Åtgärd:

- I `compositeMockup`, när `hangerColor` är satt, krymp motivets effektiva höjd med ~`slatH * 1.2` i topp + botten och rita motivet centrerat innanför. Listerna ritas sedan på papprets ytterkanter (samma position som idag), och en svag papper-vit rektangel (`#fafaf7`) ritas mellan motivets kant och listen så det ser ut som om hela arket är vitt papper med motivet centrerat.
- Resultat: motivet kapas inte längre, listen ligger på "papper", precis som Gelato-bilden.

**Fil:** `src/lib/mockup-composite.ts` (rad ~72–95 + ~232–260)

---

### Teknisk ordning

1. Spara ny ek-textur → `src/assets/textures/wood-oak.jpg`
2. Uppdatera `mockup-composite.ts`: snöre-trekant, ek-pattern-fill, paper-margin runt motiv vid hängare
3. Uppdatera `FrameOption.tsx`: `disabled` state
4. Uppdatera `FormatSection.tsx`: visa alla hängarvarianter alltid, disabled på 13x18, ny `HangerIcon` med trekantsnöre + ek-textur, auto-fallback till "Ingen" om inkompatibel kombination väljs

Inga DB-ändringar, inga prisändringar, inga nya Gelato-UIDs.
