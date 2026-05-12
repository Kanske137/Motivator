# Plan: Automatisk iframe-höjdkommunikation

## Mål
När editorn är inbäddad i en iframe på Shopify-temat ska den automatiskt meddela föräldrafönstret om sin innehållshöjd ändras, så att föräldern kan justera iframe-höjden och eliminera intern scroll.

## Vad som byggs
En `useEffect` i `EditorPage.tsx` som:
1. Endast aktiveras när `window.self !== window.top` (appen körs i iframe).
2. Sätter upp en `ResizeObserver` på `document.documentElement`.
3. Vid varje ändring postar `{ type: 'EDITOR_RESIZE', height: <px> }` till `window.parent`.
4. Använder `document.documentElement.scrollHeight` som höjdvärde.
5. Debouncar/throttlar meddelanden till ca 100 ms intervall.
6. Skickar ett initialt meddelande vid första renderingen.
7. Kopplar ner observern vid avmontering.

## Tekniska detaljer
- Placering: i `src/pages/EditorPage.tsx`, som en ny `useEffect`-hook vid toppnivå i komponenten.
- Befintliga flöden (ADD_TO_CART, SHOP_CONTEXT) rörs ej.
- Enkel implementation — inga nya beroenden.

## Snabbtest efteråt
- Öppna editorn i vanlig flik (ej iframe): ingen ResizeObserver ska skapas, inga konsolfel.
