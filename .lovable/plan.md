

## Fix: Ram exkluderas från printfil (men kvar på cart-preview)

### Problem

I `src/lib/editor-snapshot.ts` ritas ramen (eller canvas-wrap-skuggan) på den slutliga canvasen oavsett om snapshoten används som **printfil** (skickas till Gelato) eller som **cart-thumbnail** (visas i kundvagn). Gelato trycker hela bilden, så ramen hamnar med på själva trycket — fel.

### Lösning

Ramen ska **bara** ritas i preview-läge, aldrig i hires/print-läge. En enrads-villkorsändring i `editor-snapshot.ts`.

**`src/lib/editor-snapshot.ts`** — i frame/canvas-wrap-overlay-blocket (~rad 220–260):

Ändra villkoret från:
```ts
if (extraCm === 0 && hasFrame && (input.frameWidthCm ?? 0) > 0) {
```
till:
```ts
if (!input.hires && extraCm === 0 && hasFrame && (input.frameWidthCm ?? 0) > 0) {
```

Och samma sak för canvas-wrap-skugg-grenen:
```ts
} else if (!input.hires && input.canvasWrap && extraCm === 0) {
```

### Resultat

| Användning | Anrop | Ram syns? |
|---|---|---|
| Cart-thumbnail | `renderArtworkSnapshot(...)` (utan `hires`) | ✅ Ja |
| Printfil till Gelato | `renderHiresSnapshotSafe(...)` (sätter `hires:true`) | ❌ Nej |
| 3D mockup-textur | `renderArtworkSnapshot(...)` (utan `hires`) | ✅ Ja |

### Fil som ändras

- `src/lib/editor-snapshot.ts` — två villkor utökas med `!input.hires`.

### Verifiering

1. Lägg ny order med ram (t.ex. "Vit").
2. Öppna `_preview_image`-URL från cart → ram syns. ✅
3. Öppna `_print_file_url`-URL från cart → **ingen ram**, bara motiv + ev. text. ✅
4. Gelato dashboard: print-fil visar motiv utan ram, ramen läggs till fysiskt av Gelato baserat på variant-SKU.

