# Plan: Textstorleks-dropdown per textlager (endast Skapa själv)

På Skapa själv-mallar:
- **Ta bort** lagerstorleks-slidern (`<LayerTransformControls>`) från textlagrets textflik.
- **Lägg in** en dropdown för **textstorlek (pt)** i stället, separat per textlager.
- **Behåll** resize-handtaget i previewen oförändrat (det justerar lager-rect:en wPct/hPct, inte typsnittet).
- Allt annat (font-väljare, visible-toggle, textfält, decoration, vanliga mallar) helt orört.

## Datamodell — kund-override av fontSizePt

`src/stores/editorStore.ts`:
- `TextLayerValue` får `fontSizePt: number | null` (null = följer admin-default).
- Init till `null` på alla skapande-vägar (mall-load runt rad 420, override-konvertering runt rad 966, addCustomLayer text-fall runt rad 1487).
- Ny setter `setLayerTextFontSizePt(id, pt | null)` (mönster: `setLayerTextFont`).

## Render-pipeline (override vinner när satt)

- `src/components/editor/layers/TextLayerView.tsx`: ny prop `effectiveFontSizePt?: number`. När satt → `resolveFontPx({ fontSizePt: effectiveFontSizePt }, canvasShortPx)`. Annars nuvarande beteende.
- `src/components/editor/MapPreview.tsx` text-grenen: skicka `effectiveFontSizePt={tv?.fontSizePt ?? undefined}`.
- `src/lib/template-snapshot.ts` `drawTextLayer`: ny param `liveFontSizePt`; använder den i `fontPx`-beräkningen när satt. Anroparen (rad 757) skickar `tv?.fontSizePt ?? null`.

Detta garanterar att override:n syns identiskt i preview, mockup och print-fil.

## UI: dropdown i textfliken (endast freeform)

`src/components/editor/ControlPanel.tsx` → `TextLayerSection` (rad 685–795):

```tsx
const isFreeform = !!config.is_freeform;
const effectivePt = Math.round(value?.fontSizePt ?? layer.defaults.fontSizePt ?? 24);

// Predefinierade Word-liknande punktstorlekar
const PT_OPTIONS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80, 96, 120, 144];
// Om aktuellt värde inte finns i listan, lägg in det överst så Select visar rätt
const ptOptions = PT_OPTIONS.includes(effectivePt) ? PT_OPTIONS : [effectivePt, ...PT_OPTIONS].sort((a,b)=>a-b);
```

Renderas efter font-väljaren, **i stället för** `<LayerTransformControls>` när `isFreeform`:

```tsx
{isFreeform ? (
  <div className="space-y-2">
    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
      {t("text.fontSize")}
    </Label>
    <Select
      value={String(effectivePt)}
      onValueChange={(v) => setLayerTextFontSizePt(layer.id, Number(v))}
    >
      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
      <SelectContent>
        {ptOptions.map((pt) => (
          <SelectItem key={pt} value={String(pt)}>{pt} pt</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
) : (
  <LayerTransformControls layer={layer} />
)}
```

- Ingen explicit reset-knapp behövs — dropdownen visar alltid effektiv pt (default ärvs initialt eftersom override är `null`).
- Resize-handtaget i previewen är fortsatt aktivt (`MapPreview` text-grenen har redan move + resize handtag från förra leveransen) och påverkar bara wPct/hPct.

## i18n

`src/i18n/locales/sv.json` (källa) + översätt till `en/de/no/da/fi/fr/es/it/nl/pl`:
- `text.fontSize` = "Textstorlek"

## Filer som ändras

- `src/stores/editorStore.ts` — `TextLayerValue.fontSizePt`, init, `setLayerTextFontSizePt`.
- `src/components/editor/layers/TextLayerView.tsx` — `effectiveFontSizePt`-prop.
- `src/components/editor/MapPreview.tsx` — skicka `effectiveFontSizePt`.
- `src/lib/template-snapshot.ts` — `drawTextLayer` honourar override.
- `src/components/editor/ControlPanel.tsx` — `TextLayerSection`: dropdown istället för `LayerTransformControls` när freeform.
- `src/i18n/locales/*.json` — `text.fontSize`.

## Vad som INTE rörs

- Vanliga (ej freeform) mallar — `LayerTransformControls` finns kvar exakt som idag.
- Foto-, AI-foto-, karta-, form- och linjelagrens transformkontroller — orörda.
- Admin-designern, span-baserade per-token-pt, decoration (box/side-rules) — orörda.
- Resize-handtaget för textlager i previewen — orört (kvar som det infördes i förra leveransen).
- `pricing.ts`, Shopify-sync, AI-flöden, övriga komponenter — orörda.
