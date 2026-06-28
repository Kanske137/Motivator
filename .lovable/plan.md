## Problem
På mobil renderas Format-flikens innehåll i drawerns scroll-container (`EditorShell.tsx`, raden `<div className="px-5 pb-6 overflow-y-auto" ...>`). Orienterings­knapparna ligger sist i listan, men `pb-6` (24 px) räcker inte — på iOS/Safari äter hem-indikatorn + browser-UI upp botten, så de sista pillsen hamnar precis vid kanten och kan inte scrollas in i synfältet.

## Lösning
Endast ett ställe behöver röras: scroll-containerns bottenpadding i `src/components/editor/EditorShell.tsx` (rad 167–170).

- Ändra `pb-6` → `pb-24` så det alltid finns ~96 px luft under sista elementet på mobil.
- Lägg till `paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)'` i `style`-objektet så vi respekterar iOS safe-area utöver de 6rem.

Inget annat påverkas: gäller bara mobil-drawerns innehåll (desktop-aside har egen layout), och alla flik-innehåll får samma extra utrymme — vilket även hjälper om någon annan flik råkar ligga nära kanten.

## Fil
- `src/components/editor/EditorShell.tsx` — uppdatera className + style på scroll-divet i `DrawerContent`.
