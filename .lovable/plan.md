# Fix: tomma textrutor återställs till mall-placeholder i printfil & preview

## Problem
När kunden raderar all text i en textruta:
- Editorns canvas (live `MapPreview`) → tom ✅
- Mockup-galleriet + printfilen + cart-thumbnail → visar fortfarande mallens default-text ❌

## Rotorsak
`src/lib/template-snapshot.ts` rad 302:

```ts
const text = liveText || d.text;
```

`||` behandlar `""` som "saknas" och faller tillbaka på `d.text` (template-placeholder). Den efterföljande guarden `if (!text.trim()) return;` på rad 310 hinner aldrig kicka in.

Anroparen på rad 762–764 bygger redan effektiv text via `buildEffectiveTextWithSpans(layer.defaults, place, overrideText)` som korrekt returnerar `""` när `overrideText === ""`. Snapshot-funktionen skriver alltså över ett korrekt tomt resultat.

## Fix (Del 1 — minimal, säker)

I `drawTextLayer` (snapshot-pipeline):

```ts
// Före
const text = liveText || d.text;

// Efter
const text = liveText; // caller har redan resolverat (override "" = medvetet tomt)
```

Detta är säkert eftersom enda anroparen alltid skickar in resultatet från `buildEffectiveTextWithSpans`, som garanterar en sträng.

Efter ändringen: `if (!text.trim()) return;` (rad 310) — som redan finns — gör att inget ritas, ingen bakgrund/dekoration heller (vi flyttar `hasBg`-blocket nedanför guarden så att tom textruta inte lämnar tomt bakgrundsblock i tryck).

## Verifiering
1. Öppna en bilposter-mall i editorn.
2. Radera all text i en textruta → editorn blir tom (oförändrat beteende).
3. Vänta in mockup-galleriets uppdatering → previewbilderna ska nu också vara tomma på den rutan.
4. Lägg i varukorg → öppna cart-thumbnail + verifiera printfile-URL (öppna den i ny flik) → texten ska saknas.
5. Skriv tillbaka något → texten dyker upp igen i alla tre vyer.
6. Karttavla-flödet: sök ny stad → auto-text fylls i på nytt (regression-skydd för "kartan vinner alltid").

## Filer som ändras
- `src/lib/template-snapshot.ts` — `drawTextLayer`: byt `liveText || d.text` mot `liveText` och flytta `hasBg`-blocket under `if (!text.trim()) return;`.

## Inget annat rörs
- `MapPreview.tsx`, `TextLayerView.tsx`, `ControlPanel.tsx`, `editorStore.ts`, `text-typography.ts` är redan korrekta — ingen ändring behövs.
- Edge-funktionen `generate-print-file/index.ts` används inte längre av huvudflödet (print-pipeline går klient-sida via `renderHiresTemplateSnapshotSafe`).
