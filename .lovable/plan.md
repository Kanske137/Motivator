

## Fix: Font 404 — byt till stabil jsDelivr fontsource-URL

### Problem (bekräftat i loggen)

```
[generate-print-file] error: Font fetch failed 404
```

Pipeline kommer hela vägen: Mapbox → decode → cirkel-clip lyckades på 69ms totalt. Den dör först vid `loadFont()` när text ska ritas, eftersom GitHub-URL:en till Inter-fontfilen returnerar 404 (filen har flyttat i `rsms/inter`-repot).

Resultat: `generate-print-file` returnerar 500 → webhook fångar fel → ingen Gelato-order skapas.

### Lösning — bekräftad fungerande URL

Verifierat med direkta HEAD-requests:

| URL | Status | Format | Storlek |
|-----|--------|--------|---------|
| `github.com/rsms/inter/raw/.../Inter-Regular.otf` (idag) | ❌ 404 | — | — |
| `cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-ext-400-normal.ttf` | ✅ 200 | statisk TTF | 94 KB |

`latin-ext` täcker **alla** svenska/nordiska tecken (ÅÄÖ, Æ, Ø, Å). jsDelivr har 99.9% uptime + edge cache → snabbare cold-start än GitHub raw.

### Ändring

**Endast en rad** i `supabase/functions/generate-print-file/index.ts`, inuti `loadFont()`:

```ts
// FÖRE (404):
const url = "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.otf";

// EFTER (verified 200):
const url = "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-ext-400-normal.ttf";
```

Inget annat rörs. ImageScript hanterar TTF identiskt med OTF — `Image.renderText(fontBuf, ...)` bryr sig bara om att det är en giltig truetype-tabell.

### Verifiering

1. Deploya funktionen → loggen ska visa `text drawn in Xms` istället för `Font fetch failed`
2. Du lägger ny testorder via Bogus Gateway (cirkel + labels off + text)
3. `gelato_orders` → status `submitted`, `gelato_order_id` finns
4. Print-fil-URL öppnas → cirkulär karta + text syns
5. Gelato dashboard visar ordern

### Robusthet — fallback

Om jsDelivr någon gång returnerar fel kan vi enkelt lägga till en fallback-kedja senare (`try jsDelivr → unpkg → embedded base64`). Men för nu håller vi det enkelt: jsDelivr fontsource är de facto-standard för server-side font loading och har högre SLA än GitHub raw.

### Filer som ändras

- `supabase/functions/generate-print-file/index.ts` — endast font-URL-strängen i `loadFont()`

Editor, cart, webhook, store — orörda.

