## Mål

I `Stilar`-väljaren — både i admin (`DesignerPage` → `StylesSection`) och i kundens flik `stil` (`ControlPanel`) — ska varje stil-thumbnail:

1. Få samma **aspektratio som stilens layout** (3:4 / 4:3 / 1:1, baserat på aktuell orientering på kundsidan, portrait i admin) så inget innehåll beskärs bort.
2. **Som standard** visa en **live-render** av stilens layout (samma komponent som `TemplateThumbnail` redan använder för mall-kort). Då blir den alltid synkad när admin ändrar lagren — ingen manuell "Generera thumbnail" behövs.
3. Endast om admin **explicit laddat upp** en egen `thumbnailUrl` ska den overrida live-renderingen.

## Ändringar

### `src/pages/admin/DesignerPage.tsx` (`StylesSection`)
- Byt `aspect-square` på stil-korten (rad 986) till `aspect-[W/H]` beräknat från `sourceBlock.defaultLayout.portrait.aspect` (`"3:4" | "4:3" | "1:1"`).
- Om `it.thumbnailUrl` saknas → rendera `<TemplateThumbnail template={tempTemplateForStyle} productType={productType}/>` istället för "Ingen thumbnail"-texten. `tempTemplateForStyle` byggs på samma sätt som i `generateThumbnail` (mall med stilens `defaultLayout`/`canvasLayout` inlagd som default).
- Om `it.thumbnailUrl` finns → visa bilden men i `object-contain` på fältet med rätt aspect (så bilden inte beskärs hårt) ELLER behåll `object-cover` men på rätt aspect-ratio (kortet matchar nu bildens form). Default: `object-cover` mot layout-aspekten — då matchar admins egna uppladdningar exakt slutproduktens form.
- Behåll `generateThumbnail`-knappen (för att kunna "frysa" en bild om man vill) men gör "Sätt thumbnail"-knappen mer tydlig: tom = auto-live, uppladdad = override. Visa liten `↺ Auto`-badge när thumbnailUrl saknas.

### `src/components/editor/ControlPanel.tsx` (case `"stil"`, rad 226-254)
- Importera `useEditorStore` orientation + hämta varje stils `defaultLayout[orientation].aspect`.
- Byt `aspect-square` (rad 242) till `aspect-[W/H]` beräknat från den enskilda stilens layout för aktuell orientering. (Olika stilar kan teoretiskt ha olika aspekt — varje kort styrs av sin egen layout.)
- Om `l.thumbnailUrl` saknas → rendera `<TemplateThumbnail template={...stylesTemplate} />` med stilens layout som `defaultLayout` så kunden ser en mini-preview av faktiska lagren (samma som admin).
- Om `l.thumbnailUrl` finns → behåll `<img>` men i den nya aspect-ratio-rutan.
- Grid `grid-cols-3 gap-2` behålls; korten är nu olika höga om orientering byter — det är OK och förväntat.

### `src/components/admin/TemplateThumbnail.tsx`
- Nuvarande signatur tar `width`/`height` props med default `120x160`. Lägg till möjlighet att rendera med `className`/auto-storlek (fylla container) så `StylesSection` och `ControlPanel` kan släppa in det i en flex/aspect-ratio-ruta utan att hårdkoda px. Konkret: om `width`/`height` ej anges → använd `w-full h-full` och läs `canvasShortPx` från `clientHeight` (eller bara ett rimligt default på 200). Behåll bakåtkompabiliteten.
- Lägg till `layoutOverride?: { defaultLayout, canvasLayout }` så samma komponent kan rendera vilken stil som helst utan att vi bygger ett temporärt template-objekt vid varje render.

## Tekniska noter

- Aspect-mapping:
  - portrait `"3:4"` → `aspect-[3/4]`
  - landscape `"4:3"` → `aspect-[4/3]`
  - `"1:1"` → `aspect-square`
- `TemplateThumbnail` renderar idag bara `portrait`. För kundsidan måste vi läsa store-`orientation` och plocka rätt block. Lägg till `orientation?: Orientation` prop med default `"portrait"`.
- Live-renderingen är billig (statisk Mapbox-bild + DOM-lager), så att rendera 3-12 stilar samtidigt går bra. Mapbox-tile cachas redan av webbläsaren.
- Inga ändringar i schema (`thumbnailUrl` förblir optional). Inga DB-migrationer.
- i18n: nya småtexter ("Auto"-badge, tooltip "Auto-genererad förhandsvisning av stilen") läggs i `sv.json` + översätts till en/de/no/da/fi/fr/es/it/nl/pl enligt projekt-regeln.

## Verifiering

1. Admin `/admin/designer/husdjur-i-renassansportratt`: stil-korten är nu i 3:4, lagren syns live, ändrar man ett lager uppdateras kortet direkt utan klick.
2. Ladda upp en custom thumbnail → kortet visar bilden i 3:4 utan beskärning.
3. Kundsidan flik `stil`: kort i 3:4 i portrait, växla till landscape → kort blir 4:3 och visar landscape-layouten. Inga klippta delar.
