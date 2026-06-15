# Fri mall (freeform) — kunden bygger själv

Mål: En ny mall-typ där kunden själv lägger till, flyttar, skalar, roterar och tar bort lager (bild, AI-stiliserad bild, karta, text, former, linje, marginal). Befintliga mallar påverkas inte.

## Lösning i korthet

Vi inför en **flagga** `is_freeform` på `product_configs` + ett nytt **"Lager"-steg** i editorns NavRail som bara visas när flaggan är på. Steget innehåller en lagerlista + "Lägg till lager"-meny. Vid val av lagertyp läggs ett nytt lager in i `editorStore` med vettiga defaults (centrerat, 50% bredd) — exakt samma TemplateLayer-typer som admin-designern redan använder. All resterande renderings-, snapshot-, print-, mockup- och pris-pipeline fungerar oförändrad eftersom den redan jobbar på "vilka lager som än finns i state".

## Steg

1. **DB (migration)**
   - `ALTER TABLE public.product_configs ADD COLUMN is_freeform boolean NOT NULL DEFAULT false;`
   - Inga nya tabeller, ingen RLS-ändring (befintliga policies täcker).

2. **Schema/typer**
   - `ProductConfig` (`src/lib/product-config.ts`) får `is_freeform?: boolean`.
   - `Template` (zod) får `isFreeform: z.boolean().optional()`.

3. **Editor — nytt "Lager"-steg**
   - Ny komponent `LayersSection.tsx` (mobile-first lista) med:
     - **"Lägg till"-knapp** → bottom sheet med val: Bild, AI-stiliserad bild, Karta, Text, Form (rektangel/cirkel/triangel/stjärna), Linje, Marginal.
     - **Lager-lista** (drag-handle för ordning, ögon-knapp dölj, papperskorg, dubbeltryck = byt namn).
     - **Markerat lager** öppnar redan befintlig `LayerInspector`-light (position, storlek, rotation, lager-specifika fält).
   - NavRail i `EditorShell` visar "Lager"-fliken **endast** när `config.is_freeform`. Övriga flikar (Bild/Karta/Text/Stil/Format) är kvar som genvägar och fungerar mot det aktivt valda lagret.

4. **Onboarding-tips**
   - Vid första öppningen visas en liten tooltip ovanför FAB: "Börja med att lägga till en bild eller karta". Stängs permanent via `localStorage`.

5. **`editorStore` — nya actions**
   - `addLayer(type)`, `removeLayer(id)`, `duplicateLayer(id)`, `reorderLayers(ids[])`, `setLayerVisibility(id, bool)`.
   - Defaults per typ (center 50/50, 60% bredd, font = templatets defaultFont, karta = templatets defaultStyle, etc.).
   - **Validering** inför `add-to-cart`: minst ett map/photo/aiPhoto-lager måste finnas (annars knappen disabled + toast). Säkrar `print-pipeline.ts`.

6. **Admin**
   - I `AdminConfigs` / designern: checkbox **"Fri mall (kunden bygger själv)"**. När på döljs designerns layer-canvas eller visas i "starttillstånd"-läge (det layer-set som finns blir kundens utgångspunkt — vill du ha tomt, lämnar du bara bakgrunden).
   - Konsoliderad produkt (alla 4 produkttyper) precis som vanliga mallar — använder existerande `is_consolidated` + `enabled_product_types`.

7. **i18n**
   - Alla nya texter i `sv.json` + översatta till `en/de/no/da/fi/fr/es/it/nl/pl`. Nycklar: `layers.title`, `layers.add`, `layers.add.image|aiPhoto|map|text|shape|line|margin`, `layers.empty`, `layers.onboarding`, `layers.delete.confirm`, `layers.validation.needDesign`, m.fl.

8. **Snapshot/print/mockup**
   - Ingen ändring. Pipeline iterar redan över `layers[]`. Verifieras med dummy-order.

## Vad som INTE ändras

- Befintliga mallar (`is_freeform=false`) ser och beter sig exakt som idag — Lager-fliken visas inte, ingen ny UI dyker upp.
- Shopify-sync, Gelato-SKU-mappning, prislogik, face-swap, AI-stilar, karttext-länkning — oförändrat.

## Tekniska detaljer

- **Flagga-driven UI:** `EditorShell` läser `config.is_freeform` och renderar `LayersSection` + ändrar NavRail-listan. Allt annat (FormatSection, AiStyleSection, …) återanvänds som de är och agerar på det "markerade lagret" i store.
- **Lager-IDs:** `crypto.randomUUID()` vid skapande.
- **Defaults-fabrik:** `src/lib/freeform-defaults.ts` exporterar `makeDefaultLayer(type, ctx)` så både `addLayer`-action och initial onboarding kan använda samma defaults.
- **Limit:** mjuk gräns 12 lager (toast vid försök till fler) för att hålla ned röran och perf.
- **Shape-bibliotek:** vi återanvänder `ShapeLayerView` (rect, circle, triangle, star, m.fl. som redan finns).
- **Text-lager:** alla fonter i `font-catalog.ts` exponeras (drop-down), storlek 8–120 px, färg-picker, justering vänster/center/höger.

## Risker & mitigeringar

| Risk | Mitigering |
|------|------------|
| Kund glömmer designkälla → tom print | `add-to-cart`-validering blockerar |
| Mobil UX rörig vid många lager | Lager-drawer + ordning via drag, mjuk maxgräns 12 |
| Snapshot långsamt med många lager | Befintlig kö i `editor-snapshot.ts` räcker; vi mäter |
| Befintliga mallar påverkas | All ny logik bakom `is_freeform`-flagga — default off |

## Leverabel ordning

1. Migration `is_freeform` + admin-checkbox.
2. `editorStore`-actions + defaults-fabrik.
3. `LayersSection` + NavRail-flik.
4. Validering + onboarding-tooltip.
5. i18n (alla 11 språk).
6. Skapa första fri-mallen via admin och testa flöde → Shopify → Gelato dummy.
