## Mål
Dölj de streckade linjerna runt tomma bildbehållare i kund-editorn när formen INTE är rektangel/kvadrat (cirkel, hjärta, stjärna), eftersom de då klipps av clip-pathen och ser trasiga ut. Behåll dem som vanligt för rektangulära former.

## Ändringar

**`src/components/editor/MapPreview.tsx`**

1. **Tom foto-platshållare (rad ~862, inuti `PhotoLayerView`)**
   - Komponenten har redan `shape: "rect" | "circle" | "heart" | "star"`.
   - Visa `border-2 border-dashed border-foreground/30` endast när `shape === "rect"`.
   - För övriga former: behåll `bg-muted/40` och texten "Ladda upp en bild" centrerad, men utan border.

2. **Tom AI-bild-platshållare (rad ~502-510)**
   - `effectiveShape` finns redan i scope.
   - Visa `border-2 border-dashed border-primary/40 rounded` endast när `effectiveShape === "rect"`.
   - För övriga former: behåll `bg-accent/30` + ikon/text, men utan border.

Inga ändringar i admin-editorn, ingen logikförändring, ingen i18n (befintlig text behålls).
