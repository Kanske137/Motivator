
## Bakgrund

Gelatos posterhängare (per [supportartikel](https://support.gelato.com/en/articles/8996216)) består av två trälister à **21 mm breda × 9 mm tjocka**, som monteras **direkt på posterns fram-/baksida** vid topp och botten. Listerna **täcker alltså 21 mm av tryckytan** — de sitter inte utanför posterns kant.

Vår nuvarande implementation ritar listerna *utanför* motivets ramar i alla tre previews, vilket inte stämmer med Gelatos faktiska preview/produkt.

Tryckfilen (`renderHiresTemplateSnapshotSafe`) sätter redan `hangerColor: undefined` (template-snapshot.ts rad 849), så **print-pipen är redan korrekt** och rörs inte.

## Vad som ändras

Tre filer, alla på samma princip: list-rektangeln flyttas från *utanför* motivet till *innanför* motivets topp- respektive botten-kant. Listhöjden räknas från Gelatos faktiska 21 mm (inte 14 mm som idag).

### 1. `src/components/editor/MapPreview.tsx` — `HangerOverlay`

- Ändra `slatPct`-formel: `2.1 / motifHeightCm * 100` (21 mm istället för nuvarande 14 mm).
- Topplistens `top: -slatPct%` → `top: 0%` (sitter på motivets överkant, går nedåt).
- Bottenlistens `bottom: -slatPct%` → `bottom: 0%` (sitter på underkant, går uppåt).
- Bredden behålls med liten överhäng (`left: -2%`, `right: -2%`) — i verkligheten är listen lite bredare än posterns bredd så den syns från sidan; behåller den visuella karaktären.
- Snörets fästpunkt `top` justeras eftersom topplisten nu sitter inne i motivet, inte ovanför. Snöret ska börja vid topplistens *överkant* — som nu är posterns överkant. Snöret ritas alltså utanför/ovanför motivet (oförändrat beteende).
- z-index behålls (46) så listen ligger över text- och bildlager.

### 2. `src/lib/template-snapshot.ts` — hängar-blocket (rad 742–821)

- Idag: skapar en *större* canvas och blittar motivet med `padTop`/`padBottom` så listerna ritas i padding-zonen utanför motivet.
- Nytt: behåll motivets storlek `w × h`. Lägg bara till `padTop = cordRise + slatH * 0.3` (för snöret), inget `padBottom`, och inget extra `padX` för listens överhäng (eller mycket mindre — bara för snörets ankarpunkter).
- Listerna ritas *inuti* motivets område: `topSlatY = motifY` (precis innanför överkanten) och `botSlatY = motifY + motifH - slatH` (precis innanför underkanten).
- `slatH` höjs till `2.1 cm * PX_PER_CM * scale` (Gelato 21 mm).
- Snöret behåller sin position ovanför topplisten (= ovanför motivet).
- Eftersom motivet inte längre växer i bredd kan vi förenkla `padX` till bara det som behövs för snörets ankare.

### 3. `src/lib/mockup-composite.ts` — hängar-blocket (rad 231–286)

- Samma flytt: `topSlatY = py` (innanför motivets topp), `botSlatY = py + posterH - slatH` (innanför botten).
- `slatH`-formel uppdateras till `2.1 / scene.referenceWidthCm * area.w`.
- Snöret är oförändrat (sitter ovanför topplisten = ovanför posterns visuella topp i scenen).

### 4. Print-filen

Inga ändringar. `renderHiresTemplateSnapshotSafe` sätter redan `hangerColor: undefined` så hängar-blocket aldrig körs vid generering av tryckfilen. Verifierat i `template-snapshot.ts` rad 843–853.

## Påverkar ramar (frame)?

Nej. Ram-overlayen är ett separat kodflöde (`frameColor`, `frameWidthCm`) och rör inte hängar-koden. Posters med ram (Vit/Svart/Ek/Valnöt) ser likadana ut som idag.

## Test efter implementation

1. Öppna editorn, välj en poster + variant "Hängare Ek". Listerna ska nu ligga *ovanpå* motivets översta och nedersta ~21 mm — du ska tydligt se att de täcker en del av kartan/texten närmast kanten.
2. Lägg i varukorgen → cart-thumbnail ska visa samma sak (lister inne i motivet, snöret ovanför).
3. Mockup-galleriet → hängar-postrarna i interiörscener ska också visa lister över motivets ytterkanter.
4. Genomför testorder → Gelatos preview ska nu matcha vår preview.
