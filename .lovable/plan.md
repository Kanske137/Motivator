## Mål
1. Gör flikarnas onboarding-badge ("Börja här" / "Fortsätt här") mjukt pulserande (skalar lätt upp/ned).
2. På mobil: lägg en pulserande badge ovanför cart-knappen i `StickyCta` med texten "Är du nöjd? Lägg till i kundvagnen" — visas bara när onboardingen är klar.

## Min åsikt (UX)
Pulserande badges drar blicken bra, men för många samtidigt blir det stressigt. Därför:

- **Cart-badgen visas bara när `activeHintSection === null`** (alla flik-steg är klara/dismissade). Då tar den naturligt över rollen som "nästa steg" istället för att tävla med flik-badgarna.
- **Pulsen ska vara subtil** (skala ~1.0 → ~1.06, ~1.6 s, ease-in-out), inte aggressiv som `animate-ping`. Stora hopp eller snabb takt upplevs som en felnotis.
- **Endast en badge åt gången på mobil**: när cart-badgen syns finns inga flik-badgar kvar, så det blir aldrig dubbel-blink.
- Cart-badgen göms automatiskt så fort kunden trycker "Lägg i varukorg" (loading/disabled) eller har lagt till — driver vi via `loading`-prop som redan finns.

Rekommendationen: ja, det är klokt under dessa villkor. Om vi visade cart-badgen hela tiden eller med kraftig animation skulle det kännas "spammy" och tappa effekt.

## Ändringar

### 1. `tailwind.config.ts`
Lägg till en mjuk pulserande skala-animation som inte krockar med Tailwinds inbyggda `animate-pulse` (opacity):

```ts
keyframes: {
  "pulse-scale": {
    "0%, 100%": { transform: "scale(1)" },
    "50%":      { transform: "scale(1.06)" },
  },
},
animation: {
  "pulse-scale": "pulse-scale 1.6s ease-in-out infinite",
},
```

### 2. `src/components/editor/NavRail.tsx`
Lägg `animate-pulse-scale` på badge-spannet (behåller `animate-fade-in` vid mount via en yttre wrapper, eller byter helt till `animate-pulse-scale` — enklast: byt klassen). `transform-origin: center` är default, så skalningen blir centrerad.

### 3. `src/components/editor/StickyCta.tsx`
- Lägg till en valfri prop `showCartHint?: boolean`.
- När true: rendera en absolut positionerad badge ovanför komponenten (t.ex. `absolute -top-3 right-4` eller centrerad över knappen), endast på mobil (`md:hidden`), med samma stil som flik-badgen (primary bg, vit text, liten uppercase, `animate-pulse-scale`, `animate-fade-in`).
- Text via i18n-nyckel `cart.readyHint` ("Är du nöjd? Lägg till i kundvagnen").
- Gör `StickyCta`-roten `relative` så badgen kan position:absolute mot den.

### 4. EditorShell (callsite för `StickyCta`)
Beräkna `showCartHint`:
```ts
const { activeHintSection } = useOnboarding();
const showCartHint = activeHintSection === null && !loading;
```
Skicka `showCartHint` till `StickyCta`. (Gäller både onboard- och "skapa själv"-flödena — i "skapa själv" finns ingen nav-rail-onboarding, så `activeHintSection` är null direkt och badgen visas så fort något är tillagt — det är önskvärt.)

### 5. i18n
Lägg till i alla 11 locales under `cart`:
```
cart.readyHint
```
Översättningar:
- sv: "Är du nöjd? Lägg till i kundvagnen"
- en: "Happy with it? Add to cart"
- de: "Zufrieden? In den Warenkorb"
- no: "Fornøyd? Legg i handlekurven"
- da: "Tilfreds? Læg i kurven"
- fi: "Tyytyväinen? Lisää ostoskoriin"
- fr: "Satisfait ? Ajouter au panier"
- es: "¿Te gusta? Añadir al carrito"
- it: "Soddisfatto? Aggiungi al carrello"
- nl: "Tevreden? In winkelwagen"
- pl: "Zadowolony? Dodaj do koszyka"

## Oförändrat
- Logiken i `useOnboarding`, `useOnboardingStore`, dwell-timer, OnboardingHint-bubblan, "skapa själv"-dialogen.
- Cart-knappens funktion och layout — bara en ny badge ovanför, ingen layout-shift (absolut positionerad).

## Verifiering
- Mobil-preview: badge "Börja här" pulserar mjukt på första fliken. Ladda upp bild → flyttas till nästa flik som "Fortsätt här", fortsatt mjuk puls.
- Slutför alla steg → flik-badgar försvinner, cart-badge "Är du nöjd? Lägg till i kundvagnen" tonar in ovanför knappen och pulserar.
- Klicka "Lägg i varukorg" → cart-badge försvinner under loading.
- Desktop: ingen cart-badge (md:hidden), flik-badgarna i sidorailen pulserar som tidigare.
