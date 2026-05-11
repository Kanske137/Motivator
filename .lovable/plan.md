## Plan: Bekräftelsedialog vid Shopify-synk

Lägg till en `AlertDialog` i `src/pages/AdminConfigs.tsx` som visas när användaren klickar "Synka till Shopify" — synken körs först när användaren bekräftar.

### Ändringar

**`src/pages/AdminConfigs.tsx`**
- Importera `AlertDialog`-komponenter från `@/components/ui/alert-dialog`.
- Lägg till state `confirmSyncOpen`.
- Ändra "Synka till Shopify"-knappen så den öppnar dialogen istället för att direkt anropa `syncToShopify`.
- Dialoginnehåll:
  - Titel: "Synka alla mallar till Shopify?"
  - Beskrivning: visar antal mallar som kommer synkas (`configs.length`) och varnar att befintliga produkter i Shopify uppdateras.
  - Avbryt-knapp + Bekräfta-knapp ("Ja, synka") som anropar `syncToShopify()` och stänger dialogen.

Ingen ändring av själva sync-logiken eller edge functions.
