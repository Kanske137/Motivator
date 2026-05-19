
## Vad jag faktiskt ser på arthena.se/products/karttavla

Jag öppnade produktsidan i webbläsaren och hämtade också rå-HTML. På den live-renderade sidan finns **ingen riktig `<iframe>`** för editorn. Istället finns det här (förkortat):

```html
<div id="lovable-editor-iframe-karttavla"
     src="https://artful-create-studio-87.lovable.app/editor?..."
     data-original-tag="iframe">
   <title>Lovable App</title>
   <link rel="preconnect" href="https://fonts.googleapis.com/">
   ...
   <div id="root"></div>
</div>
```

Det är ett `<div>` (inte `<iframe>`), med `data-original-tag="iframe"` som markör, och inuti ligger Lovable-appens egen `index.html` ihopslagen rakt in i Shopify-sidan med `<div id="root">` som mountpunkt. Skärmavbilden bekräftar det: editorn renderas direkt i produkt-sidans DOM och tar hela sidbredden.

### Vad det betyder

1. **`EDITOR_RESIZE`-meddelandena spelar ingen roll här.** `postEditorResize()` har en korrekt early-return på `window.self === window.top`. Eftersom det inte finns någon iframe är `self === top` i appen, alltså skickas inga meddelanden — och det är inte ett fel, det är korrekt. All tidigare felsökning kring "höjdrapporteringen är avstängd" har jagat fel spår: det finns ingen iframe att sätta höjd på.
2. **"Iframen är låst till 894 px" / "scrollar i iframen"** är symtom på att Shopify-temat (Kopia av Arthena 3.0) ger wrapper-div:en `#lovable-editor-iframe-karttavla` en fast/begränsad höjd och ett internt `overflow` — inte att Lovable rapporterar fel höjd. Temat behöver antingen återgå till en äkta `<iframe>` med din mottagar-snutt, eller släppa höjden helt på wrapper-div:en när editorn renderas inline (då flödar editorn naturligt i sidan utan scroll och utan tomt utrymme — vilket är exakt vad du vill ha enligt punkt 1).
3. **Storleksproblemet (punkt 2)** är helt på Lovable-sidan: `MapPreview` cappar postern till `DESKTOP_MAX_H = 820px` även när den får ett 1700px brett område, och `EditorShell` ger sidopanelen fast `w-[340px]`. Därför blir motivet litet och panelen smal på desktop, oavsett skärmstorlek.

## Plan

### 1. Lovable: gör editorn naturligt självsizad och responsivt större

**`src/components/editor/EditorShell.tsx`**
- Wrappa hela `.editor-root` i en yttre `max-w-[1400px] mx-auto` så editorn håller en respektabel men inte sprawlande bredd på stora skärmar och fyller hela bredden på mindre.
- Sidopanelen: byt `w-[340px]` mot responsiv `w-[320px] xl:w-[380px] 2xl:w-[420px]` så panelen växer på större skärmar.
- Behåll `items-start min-h-0` (ingen fast höjd, ingen `overflow-y-auto` på panelen) — det är redan korrekt och får stå kvar.

**`src/components/editor/MapPreview.tsx`**
- Ersätt det hårda taket `DESKTOP_MAX_H = 820` med ett dynamiskt tak baserat på preview-container­ens faktiska storlek (mät via `ResizeObserver` på `.preview-area`, ge postern `maxHeight` ≈ `containerHeight - padding`, fortsatt `aspectRatio` + `width:100%`).
- Effekt: postern växer när omgivande yta växer, men respekterar fortfarande aspect-ratio och cappas av tillgänglig bredd.
- Mobil-vyn ändras inte (den är redan width-driven utan höjdtak).

### 2. Shopify-temat: vad du behöver göra (jag rör det inte)

Wrapper-div:en `#lovable-editor-iframe-karttavla` är roten till "låst höjd"-känslan. Två alternativ — välj ett:

**Alternativ A (rekommenderat): låt det fortsätta vara inline-mountad SPA.**
I `sections/personlig-karta-editor.liquid`, ta bort allt som sätter `height`, `min-height`, `max-height` eller `overflow` på `#lovable-editor-iframe-karttavla`. Plocka även bort `EDITOR_RESIZE`-lyssnaren — den behövs inte när det inte är en iframe. Editorn flödar då helt naturligt i produktsidan, växer/krymper med innehållet, har ingen scroll, inget tomrum.

**Alternativ B: gå tillbaka till en äkta `<iframe>`.**
Ändra wrapper i Liquid till `<iframe src="…" style="width:100%; border:0; display:block;"></iframe>`, behåll din befintliga `EDITOR_RESIZE`-lyssnare som sätter `iframe.style.height`. Då börjar `postEditorResize()` i Lovable-koden skicka meddelanden igen (den early-return:ar bara när `self === top`, vilket inte gäller i en riktig iframe).

Jag kan inte se eller redigera tema-filer härifrån — du behöver göra ändringen i Shopify-admin > Themes > Edit code > `sections/personlig-karta-editor.liquid`.

### 3. Verifiering

- Öppna preview, växla flikar i editorn. Postern ska nu fylla väsentligt större yta på desktop och sidopanelen ska se märkbart bredare ut på ≥1280px-skärmar. Mobil oförändrad.
- På arthena.se: efter tema-fixen (alt A eller B) ska sidan inte ha scrollbar inuti editor­blocket och inget stort tomt utrymme nedanför motivet.
- I konsolen på arthena.se: `window.addEventListener('message', e => e.data?.type==='EDITOR_RESIZE' && console.log('H:', e.data.height))` — vid alt A loggas inget (förväntat, ingen iframe). Vid alt B loggas `H:` vid varje flikbyte.

## Tekniska detaljer

- `EditorShell.tsx` ändringar: yttre wrapper `<div className="editor-root mx-auto w-full max-w-[1400px] flex flex-col">`, panel `w-[320px] xl:w-[380px] 2xl:w-[420px] shrink-0 border-r bg-background min-h-0`.
- `MapPreview.tsx` ändringar: lägg `previewRef` på en ny prop eller mät via närmsta `.preview-area` ancestor; håll en `containerH` state; ersätt `maxWidth: min(100%, ${posterAspect * DESKTOP_MAX_H}px)` med `maxHeight: ${containerH - 24}px` plus oförändrad `width:100%` + `aspectRatio`.
- Ingen ändring i `iframe-resize.ts`, `EditorPage.tsx` eller `NavRail.tsx`.

## Frågor till dig innan jag bygger

1. **Tema-väg**: vill du köra alternativ A (släpp höjd-CSS på wrappern, ingen iframe) eller alternativ B (gå tillbaka till äkta iframe)? Båda fungerar — A är enklare och mer robust, B isolerar editorn från temats CSS.
2. **Maxbredd på editorn**: är 1400px ok, eller vill du ha bredare (1600/1760) respektive smalare (1240)?

