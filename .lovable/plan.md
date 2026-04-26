## Problemet (root cause)

I databasen finns två rader för "Mitt hjärta": `mitt-hjarta-poster` (product_type=`posters`) och `mitt-hjarta-canvas` (product_type=`canvas`). Båda har samma `template_slug=mitt-hjarta`.

I `src/pages/admin/DesignerPage.tsx` (`persistTemplate`) propagerar vi **hela** `template`-objektet — inklusive `productOptions` — till syskonraden via `template_slug`. Det betyder:

- När du på canvas-raden disablar `poster` och enablar `canvas`, sparas `productOptions = { poster: { enabled: false, allowedSizes: [] }, canvas: { enabled: true, ... } }`.
- Den raden propageras sedan **över** poster-raden, så även poster-produkten får `poster.enabled: false`.
- I `src/components/editor/FormatSection.tsx` används `productOptions.poster` (om `product_type === 'posters'`) eller `productOptions.canvas` för att beräkna `visibleSizes`/`visibleVariants`. Om blocket är `enabled: false` eller har tomma `allowedSizes`, blir hela editorn tom — ingen storlek, ingen ram, inget pris, inget mockup-galleri.

DB bekräftar detta: `mitt-hjarta-poster` har just nu `poster.enabled: true` med 6 storlekar OCH `canvas.enabled: true` med 8 storlekar — alltså en delad konfig som matchar exakt vad du beskriver. När du gjorde din senaste ändring på canvas-raden gick poster-raden tom.

## Lösningen

`productOptions` är **per-produkt** (en posters-rad äger `poster`-blocket; en canvas-rad äger `canvas`-blocket). Den ska inte propageras blint mellan syskon. Det enda som faktiskt ska delas är layout + dekor + AI-/karta-stilar.

### Ändringar

1. **`src/pages/admin/DesignerPage.tsx` — `persistTemplate`**
   - När vi skriver till syskonraden: bygg en `siblingTemplate` som behåller syskonets **egna** `productOptions` men tar resten (`layouts`, `orientations`, `aiStyles`-listan, `mapStyles`-listan, dekor, etc.) från det aktuella templatet.
   - Konkret: läs syskonradens nuvarande template innan update, slå ihop `{ ...finalTemplate, productOptions: sibling.template.productOptions }`, skriv tillbaka.

2. **`src/pages/admin/DesignerPage.tsx` — UI för ProductOptionsSection**
   - Visa bara det relevanta produktblocket per rad: en posters-rad ska bara visa "Poster"-sektionen, en canvas-rad bara "Canvas"-sektionen. Det är vad användaren förväntar sig — den andra produkten redigeras på sin egen rad.
   - Detta görs genom att skicka in `config.product_type` till `ProductOptionsSection` och dölja motsatt block (`poster` resp. `canvas`). Inget skrivs då in i fel block och vi undviker att admin av misstag skapar dubletter av produktinställningar.

3. **Engångs-DB-fix för "Mitt hjärta"-raderna (migration)**
   - `mitt-hjarta-poster.template.productOptions.canvas.enabled = false` (samt `allowedSizes/allowedDepths` rensas), och `poster.enabled = true` med korrekta storlekar/ramar.
   - `mitt-hjarta-canvas.template.productOptions.poster.enabled = false` (rensa allowedSizes/allowedFrames), `canvas.enabled = true` med korrekta storlekar/djup.
   - Detta återställer produkterna till "ren" delad/icke-delad form direkt så du slipper rensa manuellt i admin.

4. **Säkerhetsnät i `FormatSection` (UX)**
   - Om `visibleSizes.length === 0` (alltså admin har inte enablat något för den här produkttypen), visa en tydlig text i editorn: *"Den här produkten har inga aktiva storlekar konfigurerade."* istället för en tom panel utan mockups. Förhindrar framtida "tomma sidor" om någon glömmer enable-knappen.

### Filer som påverkas
- `src/pages/admin/DesignerPage.tsx` — per-rad propagering + skicka `product_type` vidare.
- `src/components/admin/ProductOptionsSection.tsx` — dölj motsatt block (poster på canvas-rad, canvas på poster-rad).
- `src/components/editor/FormatSection.tsx` — placeholder vid tom konfiguration.
- Ny migration — fixar `mitt-hjarta-poster`/`mitt-hjarta-canvas`.

### Resultat
- Du kan ha poster- och canvas-produkter som separata Shopify-produkter utan att de skriver över varandras storlekar/ramar/djup.
- Admin-UIt visar bara det block som är relevant för respektive rad.
- Sparar du ändringar på canvas påverkar det inte poster-radens storlekar längre — bara delade saker (layout, dekor, AI-stilar, kartstilar) syncas.
