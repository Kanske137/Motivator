# Plan: Personlig design-preview i orderbekräftelse-mejl

## Bakgrund
- Editorn skickar redan med line-item-property `_preview_image` (publik URL från `cart-previews`-bucket, samma bild som kunden ser i cart-thumbnailen).
- Shopifys default Order confirmation-template ignorerar property:n och visar standard-produktbilden.
- **Ingen kodändring i Lovable-projektet** — endast Liquid-edits i Shopify Admin (`Settings → Notifications → Order confirmation → Edit code`) + en dokumentationsuppdatering i `SHOPIFY_SETUP.md`.

## Mönstret vi använder överallt
Innan varje befintlig `<img>` introducerar vi `{% assign preview = ... %}` som plockar property:n, sedan villkor på `preview`:

```liquid
{%- assign preview = line.properties._preview_image -%}
{% if preview != blank %}
  <img src="{{ preview }}" align="left" width="60" height="60" class="order-list__product-image"/>
{% elsif line.image %}
  <img src="{{ line | img_url: 'compact_cropped' }}" align="left" width="60" height="60" class="order-list__product-image"/>
{% endif %}
```

Variabelnamn beror på loopen — `line`, `child_line`, `component`, `parent_line_item` eller `line_item_group`. För grupper letar vi i `parent_line_item.properties._preview_image` först.

## Ställen att ändra (exakta rader i din uppladdade fil)

### A. Legacy `subtotal_line_items`-loop
- **Rad 363-366** och **rad 373-376** — `line.image` → använd `line.properties._preview_image` först, fallback till `line | img_url`.
- **Rad 451-454** (child_line) → `child_line.properties._preview_image` med fallback.
- **Rad 607-610** (child_line, andra varianten) → samma.

### B. `line_item_groups` (bundles / parent items)
- **Rad 691-696** — kolla `parent_line_item.properties._preview_image`, sen `line_item_group.parent_sales_line_item.properties._preview_image`, fallback till befintliga bilder.
- **Rad 806-808** (component) → `component.properties._preview_image` med fallback.
- **Rad 920-922** (component) → samma.

### C. Moderna `delivery_agreement`-spåret (det som troligen körs idag)
- **Rad 1053-1056** och **rad 1063-1066** → `line.properties._preview_image` med fallback.
- **Rad 1141-1144** (child_line) → samma.
- **Rad 1297-1300** (child_line, andra varianten) → samma.
- **Rad 1379-1384** (parent_line_item / line_item_group inom delivery_agreement) → samma logik som B.

### D. Dölj tekniska `_`-prefix-properties i mejlet
I property-loopen runt **rad 494-495** (och motsvarande rad ~1184-1185):
```liquid
{% for property in line.properties %}
  {%- assign first_char = property.first | slice: 0 -%}
  {%- unless first_char == '_' -%}
    {{ property.first }}: {{ property.last }}
  {%- endunless -%}
{% endfor %}
```
Detta gömmer `_preview_image`, `_print_file_url`, `_design_id` etc. från kunden men de finns kvar i ordern.

## Leveranssätt
1. **Uppdatera `SHOPIFY_SETUP.md`** med nytt **Steg 7 — Orderbekräftelse-mejl visar designens preview**. Innehåller:
   - Var i Admin man hittar templaten
   - Sök-och-ersätt-mönstret (universal snippet)
   - Lista över alla ~10 ställen att patcha (med rad-hänvisningar som referens men sökstrings-baserat så det fungerar även om Shopify uppdaterar standard-templaten)
   - Tips att gömma `_`-properties
2. **Klistra in i chatten åt dig**: ett färdigt unified diff / sök-ersätt-set du kan applicera direkt i Shopify code editor (jag listar varje block: "Hitta detta → Ersätt med detta").
3. **Test-instruktion**: gör en testorder via Bogus Gateway, kolla att mejlet visar tavla-previewen istället för default-produktbilden.

## Det jag INTE rör
- Ingen ändring i Lovable-koden (`useCartSync.ts`, `upload-preview.ts`, edge functions) — `_preview_image` skickas redan korrekt.
- Inga andra Shopify-mejl (Shipping confirmation, Refund, etc.) — kan göras i samma stil senare om du vill.
- Inga ändringar på Gelato-flödet (`_print_file_url` är opåverkat).

## Risk
- Låg. Vi lägger till villkor *innan* befintliga `<img>`-rader → om `_preview_image` saknas (gamla ordrar, vanliga produkter utan editor) faller den tillbaka på dagens beteende.
