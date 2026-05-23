# Fix: orienteringsbyte uppdaterar inte vald AI-referens

## Root cause
`MapPreview.tsx` (rad 430) renderar AI-bildlagret från:
```ts
const src = aiResultUrl ?? selectedRefUrl ?? l.defaults.referenceImageUrl ?? null;
```
`selectedRefUrl` kommer från `editorStore.aiPhotoSelectedRefUrl[layerId]`. När kunden byter orientering körs `setOrientation` i storen — den remappar `aiPhotoSelectedRefUrl` till nya layer-ID:n men **byter aldrig själva URL:en**. Så den gamla porträtt-URL:en följer med över till landskapslagret och visas på canvasen.

Healing-logiken jag la in i `AiPhotoSection` rättar visserligen valet — men bara när komponenten är monterad (kontrollpanelen öppen för just det lagret). MapPreview hinner rendera fel innan dess.

## Fix — gör orienteringsbytet smart i storen
`src/stores/editorStore.ts` → `setOrientation` (rad 673):

Efter `const aiPhotoSelectedRefUrl = remap(state.aiPhotoSelectedRefUrl);`, lägg till en pass som för varje aiPhoto-lager i **nya** orienteringen kontrollerar att den valda refUrl:en finns bland refs som matchar nya orienteringen (`r.orientation === orientation || r.orientation === "any" || !r.orientation`). Om inte → välj första matchande ref. Om inga matchar (admin har bara taggat "any" eller listan tom) → behåll/använd `referenceImageUrl`-fallback.

```ts
for (const l of nextLayers) {
  if (l.type !== "aiPhoto") continue;
  const refs = l.defaults.referenceImages ?? [];
  if (refs.length === 0) continue;
  const matching = refs.filter((r) => {
    const o = r.orientation ?? "any";
    return o === "any" || o === orientation;
  });
  if (matching.length === 0) continue;
  const cur = aiPhotoSelectedRefUrl[l.id];
  if (!cur || !matching.some((r) => r.url === cur)) {
    aiPhotoSelectedRefUrl[l.id] = matching[0].url;
  }
}
```

## Bonus — samma robusthet i MapPreview som säkerhetsnät
`src/components/editor/MapPreview.tsx` (rad 430-435): byt resolvningen så den filtrerar refList efter `orientation` (läses från storen) innan den faller tillbaka, så att även om storen av någon anledning har en mismatchad URL ritas rätt bild:
```ts
const refList = l.defaults.referenceImages ?? [];
const orientationMatches = refList.filter((r) => (r.orientation ?? "any") === "any" || (r.orientation ?? "any") === orientation);
const activeRefUrl =
  (selectedRefUrl && orientationMatches.some((r) => r.url === selectedRefUrl) ? selectedRefUrl : null)
  ?? orientationMatches[0]?.url
  ?? l.defaults.referenceImageUrl
  ?? null;
const src = aiResultUrl ?? activeRefUrl;
```
(`orientation` är redan tillgängligt i MapPreview-scopet — annars läs via `useEditorStore`.)

## Inget annat påverkas
- Admin-canvas, AiPhotoSection-pickern, face-swap-cachen och snapshot/print: oförändrade.
- Mallar med bara "any"-taggade referensbilder beter sig exakt som idag.

## Verifiering på kundsidan
1. Öppna "husdjur i renässansporträtt" som kund i porträtt → porträttreferensen visas på canvasen.
2. Byt till landskap → landskapsreferensen ritas direkt, även utan att öppna AI-kontrollpanelen.
3. Kör face-swap i porträtt → byt till landskap → byt tillbaka → cachad porträtt-swap dyker upp.
