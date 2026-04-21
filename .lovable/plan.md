

## Två cart-fixar

### 1. Ramen syns inte i preview-bilden

**Problem:** `editor-snapshot.ts` renderar bara karta + text + bakgrund. Ramen (poster) och canvas-wrap ritas separat i `MapPreview` via CSS/3D — alltså inte med i snapshoten som laddas upp till `cart-previews`.

**Fix:** Utöka `renderArtworkSnapshot` i `src/lib/editor-snapshot.ts` så den även ritar ramen ovanpå artwork:
- Acceptera nya parametrar: `frameColor` (hex/hsl-sträng), `frameWidthCm`, `wrapCm` (canvas-djup)
- Efter att karta+text är ritat: lägg på en ram runt hela motivet med `ctx.fillStyle = frameColor` + `ctx.fillRect` på fyra sidor (top/bottom/left/right) skalat efter bildens DPI
- För canvas: rita en mörkare "wrap-skugga" på sidorna istället för fast färg, så det visuellt ser ut som en duk
- Skippa rambana när `frameColor === ""` (Ingen ram) — då ser snapshoten ut precis som idag

I `EditorPage.handleAddToCart` skickar vi med `frameColor`, `FRAME_WIDTH_CM`, `canvasDepthCm` till `renderArtworkSnapshot`.

### 2. Bild återgår till standardproduktbild när cart uppdateras

**Problem:** Vår `cart-preview-override.liquid` körs bara på `DOMContentLoaded` + `cart:refresh` + `cart:updated` events. När Horizon byter ut DOM-noderna efter quantity-change/remove kommer den nya `<img>`-noden tillbaka med Shopifys default-URL och våra event-listeners triggas inte alltid (Horizon emittar egna custom events).

**Fix:** Skriv om snippet:en till att använda en `MutationObserver` som permanent övervakar cart-containern. När som helst en ny `<img>` dyker upp i en line item som har `_preview_image`-property, byts `src` ut omedelbart. Detta är robust mot:
- Horizon's egna section-rerenders efter quantity-update
- AJAX-byten av cart-rader
- Drawer-cart som öppnas/stängs

Mappning: vi cachar `key → previewUrl` från `/cart.js` och re-fetchar bara när cart-totalen ändras (lyssnar på `cart:updated` + fallback-poll var 2s när observer triggar).

**Du får uppdaterad `cart-preview-override.liquid` att klistra in (ersätter nuvarande).**

### Tekniska detaljer

**Filer som ändras:**
- `src/lib/editor-snapshot.ts` — utöka signatur + rita ram/wrap
- `src/pages/EditorPage.tsx` — skicka frame-params till snapshot

**Shopify-snippet:**
- `snippets/cart-preview-override.liquid` — ersätts med MutationObserver-version

### Ordning

1. Utöka snapshot-rendering med ram + wrap
2. Uppdatera `EditorPage` att skicka frame-data
3. Leverera ny `cart-preview-override.liquid`

