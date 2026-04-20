

# Fixa Gelato Mockup — fel API-host

## Rotorsak (bekräftad i loggar)
`gelato-mockup` edge function anropar `https://mockup.gelatoapis.com/v1/mockups` → DNS lookup misslyckas. Subdomänen existerar inte. Gelatos Mockup Generator ligger på samma host som deras övriga API, inte på en separat `mockup.`-subdomän.

## Fix

### 1. `supabase/functions/gelato-mockup/index.ts`
- Byt `MOCKUP_BASE` från `https://mockup.gelatoapis.com/v1` till `https://order.gelatoapis.com/v1` (Gelatos officiella API-host).
- Lägg till en kort host-fallback: om första anropet får DNS/connect-fel, prova `https://api.gelatoapis.com/v1` som sekundär.
- Behåll: API-key header `X-API-KEY`, body `{ productUid, files: [{ type: "default", url }] }`, polling mot `/mockups/{taskId}`.
- Lägg till logg av faktisk URL och HTTP-status så vi snabbt ser om hosten fortfarande är fel.
- Behåll graceful fallback (200 + `fallback: true`) så klienten inte kraschar.

### 2. Inga klientändringar behövs
`MockupGallery` och `src/lib/gelato.ts` fungerar redan — de fick rätt `productUid` (`flat_product_pf_130x180-mm_...`) och rätt print-URL. Det enda som felade var själva edge-anropet ut mot Gelato.

### 3. Verifiering efter deploy
- Loggarna ska visa `[gelato-mockup] create response: 200 ...` istället för DNS-fel.
- Första thumbnailen i galleriet ska visa en riktig miljöbild från Gelato istället för tryckfilen med "Förhandsgranskning"-badge.
- Om Gelato svarar med `taskId` ser vi `[gelato-mockup] poll status: completed` inom ~3-10 sek.

## Filer som ändras
- `supabase/functions/gelato-mockup/index.ts` (endast `MOCKUP_BASE` + host-fallback + lite mer logging)

## Inte med
- Inga ändringar i `MockupGallery.tsx`, `gelato.ts`, eller `generate-print-file`.
- Inga DB-ändringar.

