

## Steg 4b: 3D-Canvas Polish — fixar & vardagsrumsscen

### Problem att lösa

1. **Auto-rotate krockar in i väggen** → duken roterar och försvinner in i vägg-planet bakom.
2. **Zoom avstängd** → `enableZoom={false}` blockerar både scroll-zoom på desktop och pinch-zoom på mobil.
3. **Bakgrundsfärgsändringar syns inte i 3D** → tryckfilen som genereras till 3D-vyn cachar/regenererar inte när `posterBgColor` ändras.
4. **Saknas vardagsrumskontext** → idag bara en platt vägg.

### Lösning

**1. Statisk duk + orbiterande kamera**
- Ta bort `meshRef.current.rotation.y += dt * 0.25` helt. Duken står still.
- Aktivera `OrbitControls.autoRotate={true}` + `autoRotateSpeed={0.8}` i 4 sekunder vid mount, stoppas vid första interaktion.
- Kameran roterar då runt duken istället för att duken roterar in i väggen.
- Behåll `min/maxAzimuthAngle ±45°` så användaren aldrig ser baksidan eller in i väggen.

**2. Återaktivera zoom**
- `enableZoom={true}` på `OrbitControls` (fungerar för både scroll och pinch).
- Sätt `minDistance={2.5}` och `maxDistance={5.5}` så användaren inte kan zooma in i duken eller ut till tomheten.
- `zoomSpeed={0.6}` för mjukare scroll-känsla.

**3. Vardagsrumsscen**
Bygg en enkel low-poly miljö i Three.js (inga externa GLB-filer):
- **Vägg bakom duken** (befintlig, men gjord större: 16×10).
- **Golv** under duken (`PlaneGeometry` 16×8, ljus ek-färg `#d4b896`, roterad −90°, position y=−1.6).
- **Soffa** (förenklad: tre `BoxGeometry` — bas + ryggstöd + två armstöd, mörkgrå `#3a3f4a`, position framför nedre delen av väggen, skalad så den syns under duken).
- **Sidobord + lampa** (cylinder + sfär, varmt ljus från sfären via `pointLight` med samma position → ger naturlig "rumsljus"-känsla).
- **Tavelram-kant runt duken** (subtil kant via tunn `BoxGeometry`-frame om vi vill — hoppar över för att inte krocka med wrap-rendringen).
- Allt ligger så långt bak/ner att duken förblir hjälte; rummet är bara kontext i bakgrunden.

Aktiveras via en ny prop `scene?: "minimal" | "livingroom"` (default `"livingroom"` för canvas, `"minimal"` om vi vill behålla nuvarande look någon annanstans).

**4. Bakgrundsfärgs-bug**

Roten till problemet finns i hur 3D-tryckfilen genereras. Inspektera:
- `MapPreview.tsx` (3D-läge) → vilken `printUrl` skickas till `Canvas3DPreview`?
- `template-snapshot.ts` → används `livePosterBgColor`?
- Om `printUrl` cachas i en ref/state utan `posterBgColor` i dependency → fix: lägg till `posterBgColor` i useEffect-deps som regenererar 3D-snapshot.

Förmodad fix: i `MapPreview.tsx`s 3D-snapshot-effekt, lägg till `posterBgColor` (och `livePosterBgColor`) i dependency-arrayen så snapshot regenereras vid färgbyte. Verifierar exakt under implementationen.

### Filer

| Fil | Ändring |
|---|---|
| `src/components/editor/Canvas3DPreview.tsx` | Ta bort mesh-rotation, aktivera autoRotate på OrbitControls, aktivera zoom, lägg till `LivingRoomScene`-komponent (golv + soffa + lampa + pointLight) |
| `src/components/editor/MapPreview.tsx` | Lägg till `posterBgColor` i 3D-snapshot useEffect deps så bakgrundsfärg propagerar |

### Verifiering

1. Öppna canvas-produkt → duken står still mitt i vyn, kameran cirklar runt långsamt i 4s.
2. Scrolla med musen → zoom in/ut fungerar smidigt.
3. Pinch på mobil → zoom fungerar.
4. Drag → roterar runt duken, kan aldrig se in i väggen eller baksidan av duken.
5. Bakgrundsmiljö: golv + soffa + lampa syns under/runt duken, varmt ljus från lampan på dukens högra sida.
6. Ändra bakgrundsfärg i editorn → 3D-vyn uppdateras inom ~1s med ny färg på fronten och sidornas wrap.
7. Inga regressioner i wrap-mappning eller mobilprestanda.

