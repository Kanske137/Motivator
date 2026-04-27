Ja, jag förstår alla fyra punkter. Här är planen:

## 1. Större designyta i mall-editorn

I `src/components/admin/LayerCanvas.tsx` byts wrappern `w-full max-w-md mx-auto` (≈448px) till en bredare container, t.ex. `w-full max-w-2xl mx-auto` (≈672px) så designytan blir markant större på desktop, men fortfarande responsiv på mobil. Aspect-ratio-logik och alla %-baserade beräkningar är oförändrade — endast den maximala renderade bredden ökar.

## 2. Finare rutnät för enklare positionering

Idag används `SNAP_PCT = 5` på två ställen:
- `src/lib/layer-utils.ts` — används av flera helpers (lines etc).
- `src/components/admin/LayerCanvas.tsx` — används både för snap och för det visuella rutnätet.

Ändring: sätt `SNAP_PCT = 1.25` (4× tätare än 5%) i `LayerCanvas.tsx`, så både snap-stegen och bakgrundsrutnätets `backgroundSize` blir 1.25%. `snapPct()` i `layer-utils.ts` accepterar redan en parameter, så den fungerar oförändrat när vi skickar in det nya värdet via `LayerCanvas`. Default-värdet i `layer-utils.ts` (5) kan stå kvar för backwards compatibility i andra helpers, alternativt sänkas till 1.25 om det visuellt ger bäst resultat — vi sänker det också för konsistens.

Det som uttryckligen INTE ändras:
- `GUIDE_TOLERANCE_PCT` (alignment guides) — kvar på 1.5.
- Edge-snap för linjer, corner-extend, line-thickness — orörd logik.
- Preview, tryckfil, snapshot — alla läser %-värden direkt; de blir bara mer finupplösta men annars identiska.

## 3. Admin-configs som standardstartsida i Lovable-editor

I `src/App.tsx` ändras `<Route path="/" element={<Index />} />` till att rendera `AdminConfigs` på rotvägen. Två alternativ — vi väljer det enklaste:
- Ändra `path="/"` till `element={<AdminConfigs />}` och flytta `Index` till `/home` (eller ta bort den helt om den inte används publikt).
- Lägg en `<NavLink>` "Mallar" / "Editor" i headern på AdminConfigs så man enkelt kommer vidare till `/admin/designer/:handle` (redan finns via "Redigera"-knappen) och till `/editor` (redan finns via "Editor"-knappen). Inget mer behövs där.

Notera: detta påverkar bara hur admin-projektet i Lovable ser ut — den publicerade Shopify-storefronten är opåverkad eftersom den inte konsumerar denna React-router.

## 4. Korrekt utseende på mall-thumbnails (frames inte gråa)

`src/components/admin/TemplateThumbnail.tsx` hanterar idag bara `map`, `text`, `line`, `margin` korrekt. Alla andra typer — inklusive `shape` (där frames ligger) och `image`/`photo` — ritas som en grå box (`background: hsl(var(--muted))`). Det är orsaken till den helgrå rutan inuti ramarna.

Ändring:
- Lägg till en `shape`-gren som renderar en mini-version av ramen via samma `ShapeLayerView` (med `canvasShortPx = Math.min(width, height)`), så rect/oval/rounded/double/corners/lines visas korrekt och hollow center är transparent.
- Lägg till en `image`/`photo`-gren: visa `defaults.url` / `defaults.placeholderUrl` om sådan finns, annars en mycket ljus placeholder (`bg-muted/40`) istället för full grå — så innehåll bakom syns.
- Sortera fortfarande efter zIndex så frames hamnar överst utan att täcka allt.

Resultat: thumbnailen i `/admin/configs`-korten matchar designytans verkliga utseende — ramar är tomma i mitten, kartor/text syns under, och photo-platshållare ser ut som platshållare istället för att maskera hela mitten.

---

## Berörda filer
- `src/components/admin/LayerCanvas.tsx` (bredd + snap-värde)
- `src/lib/layer-utils.ts` (sänka default `SNAP_PCT`)
- `src/App.tsx` (ny standardstartsida)
- `src/pages/AdminConfigs.tsx` (ev. mindre headerjustering om Index tas bort)
- `src/components/admin/TemplateThumbnail.tsx` (shape + photo/image)
