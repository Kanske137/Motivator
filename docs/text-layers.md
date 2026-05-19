---
name: Textlager (länkade & fria)
description: Fullständig modell för textrutor i editorn — overrideText, auto-text från karta, span-arv, maxLength för länkade texter
type: feature
---

# Textrutor — så fungerar de

Textlager (`type: "text"`) i en `Template` har TVÅ källor till sitt visade innehåll:

1. **Auto-text** (admin-kontrollerad, deterministisk)
   - Byggs av `buildLinkedText(template, tokens, place)` i `src/lib/text-typography.ts`.
   - Källa: `defaults.text` (kan innehålla `[[city]]`, `[[country]]`, `[[coords]]`) ELLER `linkedTokens`/`linkedMapFields` när templaten saknar placeholders.
   - Beror på det länkade kartlagrets aktuella `place` (`placeName`, `city`, `country`, `center`).
   - Saknas länkad karta → `defaults.text` används direkt.

2. **Customer override** (per-session i `editorStore`)
   - `TextLayerValue.overrideText: string | null`. `null` = "följ auto-text".
   - Tom sträng `""` är en giltig override (kunden har medvetet rensat fältet).
   - Speglas i legacy `TextLayerValue.text = overrideText ?? autoText` för cart/snapshot.

## Kärnregel: KARTAN VINNER ALLTID

Vid varje `applyPlaceInternal` (sökning av ny plats ELLER pan/zoom som ändrar place) rensas `overrideText` till `null` för alla textlager med `linkedMapLayerId === mapId` och `text` skrivs om till ny auto-text.

Detta får aldrig ändras. Kunden får tillbaka redigerbar auto-text efter varje kartuppdatering.

## Render-pipeline

ALLA tre renderingsvägar går genom samma helper:
- `MapPreview.tsx` (live editor preview)
- `TextLayerPreview.tsx` (admin designer preview)
- `template-snapshot.ts drawTextLayer` (cart/print/mockup snapshot)

```ts
const { text, spans } = buildEffectiveTextWithSpans(layer.defaults, place, overrideText);
```

`buildEffectiveTextWithSpans`:
- `overrideText === null` → returnerar auto-text + admin-spans direkt.
- Icke-länkad layer + override → ren textersättning, admin-spans klipps till ny längd.
- Länkad layer + override → line-baserad alignment mot auto-text:
  - Identiska rader → ärver tokenens spans oförändrat.
  - Modifierade rader → ärver första spanens stil och applicerar på HELA den nya radens text (så `[[coords]]`-stilen följer med när kunden skriver "Hemma" istället).
  - Borttagna rader hoppas över.

## ControlPanel.tsx — kundens textfält

`TextLayerSection` är den ENDA platsen där kunden redigerar text:

```ts
const committedText = value?.overrideText ?? autoText;
const [draft, setDraft] = useState<string | null>(null); // lokal buffert under fokus
const text = draft !== null ? draft : committedText;
```

- `onFocus`: `setDraft(committedText)` — hindrar caret-hopp vid store-rerender.
- `onChange`: `setDraft(e.target.value)` + `setLayerText(layer.id, e.target.value)`.
- `onBlur`: `setDraft(null)`.

`setLayerText` → `setLayerOverrideText` i editorStore. Om `raw === autoText` sätts `overrideText: null` (då följer fältet auto igen).

### maxLength — kritisk fälla

För länkade karttexter MÅSTE maxLength alltid rymma aktuell auto-text + redigeringsmarginal, annars blockerar browsern ny inmatning på andra rader så snart totalen överskrider gränsen (kunden upplever att t.ex. `coords` "måste raderas först" innan `country` kan ändras).

```ts
maxLength={
  linked
    ? Math.max(config.text_config.maxChars, autoText.length + 120)
    : config.text_config.maxChars
}
```

Icke-länkade textlager behåller produktens `text_config.maxChars` oförändrat.

## Admin: spans (rich-text overrides)

I `LayerInspector.tsx > TextLayerDefaults`:
- Spans lagras på `defaults.spans: TextSpan[]` med `start`/`end` mot RAW template-text (inkl. `[[coords]]`-placeholder).
- `substituteTokensWithSpans` mappar offsets från raw → renderad text så en span på `[[coords]]` följer med över hela koordinatsträngen.
- Inheritance till kundens override hanteras automatiskt av `buildEffectiveTextWithSpans` (se ovan).

## Förbjudna mönster

- ❌ Lägg INTE tillbaka `isCustom`-flaggan. Modellen är nu `overrideText: string | null`.
- ❌ Hoppa INTE över `buildEffectiveTextWithSpans` i någon render-pipeline (skulle förlora span-arv eller token-substitution).
- ❌ Ta INTE bort rensningen av `overrideText` i `applyPlaceInternal` — kartan måste vinna.
- ❌ Sätt INTE `maxLength={config.text_config.maxChars}` rakt av på länkade textfält.
- ❌ Hårdkoda aldrig kundsynlig UI-text — använd i18n (se Core-regel).

## Verifieringsflöde (`/admin/designer/karttavla`)

1. Markera `[[coords]]` i admin → annan font/storlek/färg.
2. Som kund: ändra `country` ensamt — ska gå direkt utan att röra `coords`.
3. Ändra `city` ensamt — ska gå.
4. Ta bort `coords`-raden, skriv "Hemma" — "Hemma" renderas i samma röda större font.
5. Sök ny stad → alla tre rader uppdateras, kundens edits försvinner.
6. Töm hela fältet, byt karta → auto-text fyller i igen.
