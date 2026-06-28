# Fix: "Visa som kund" kraschar editorn

## Orsak
Senaste ändringen (cart-hint badge) lade till `const { activeHintSection } = useOnboarding();` på rad 422 i `src/pages/EditorPage.tsx` — *efter* den tidiga returneringen `if (loading || !config) return <Loader2 …/>` på rad 403.

Vid första render är `loading=true` → komponenten returnerar innan `useOnboarding()` anropas. När configen sedan laddats körs en hook till än föregående render. React kastar "Rendered more hooks than during the previous render" och hela editorn avmonteras — vilket är exakt det "inget visas"-beteende du ser när du öppnar `/editor?handle=…&preview=draft` via *Visa som kund*.

## Åtgärd
Flytta `useOnboarding()` och `showCartHint`-beräkningen upp till de andra top-level hooks (bredvid `useShopifyPriceMap`, `useCartStore` osv), så att alla hooks alltid körs i samma ordning oavsett `loading`/`config`-state. `ctaNode` kan fortsätta byggas efter early-return — det är bara hook-anropet som måste flyttas.

## Tekniska detaljer
- Fil: `src/pages/EditorPage.tsx`
- Ta bort raderna nära 422:
  ```ts
  const { activeHintSection } = useOnboarding();
  const showCartHint = activeHintSection === null;
  ```
- Lägg in dem tidigt i komponenten, t.ex. direkt efter `const { map: shopifyPriceMap, derivedFx } = useShopifyPriceMap();`.
- Inga övriga ändringar krävs — `StickyCta`-anropet behåller `showCartHint={showCartHint}`.

## Verifiering
1. Öppna `/editor?handle=<handle>&preview=draft` i ny flik → editorn renderar normalt.
2. Konsolen ska inte längre visa "Rendered more hooks than during the previous render".
3. Cart-hint-badgen på mobil fungerar som tidigare när alla onboarding-steg är klara.
