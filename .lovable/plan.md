## Problem

När du sparar ett kartlager med formen **"Fyll lager (rektangel)"** så återgår det till **cirkel** vid omladdning. Övriga former (cirkel, hjärta, stjärna) sparas korrekt.

## Orsak

Schemat `mapShapeSchema` accepterar redan `"rect"` (det lade vi till tidigare), så själva sparningen till databasen lyckas. Men vid **inläsning** kör `src/lib/template-migrate.ts` en gammal "legacy-coercion" som skriver om allt som inte är `circle`/`heart`/`star` till `circle`. Det finns på två ställen:

1. `migrateLayer()` (rad 64–73) — körs på varje inläst template via `migrateTemplate()`.
2. Pre-parse fallback-blocket (rad 197–211) — säkerhetsnät för gamla templates.

Båda blocken skrevs när `"rect"` var en ogiltig form för kartor. Nu när vi tillåter den måste de uppdateras, annars "äts" valet upp varje gång templaten läses från databasen — vilket ser ut som att sparningen inte gick igenom.

Fotolager påverkas inte eftersom ingen migration rör `photo`-formen.

## Lösning

Uppdatera `src/lib/template-migrate.ts`:

- I `migrateLayer()`: inkludera `"rect"` i listan över giltiga map-shapes så att den inte coercas till `"circle"`.
- I pre-parse fallback-blocket: samma uppdatering så att rect bevaras även där.

### Ändring (kortfattat)

```ts
// migrateLayer():
if (s !== "rect" && s !== "circle" && s !== "heart" && s !== "star") {
  // coerce till "circle"
}

// pre-parse fallback:
if (s !== "rect" && s !== "circle" && s !== "heart" && s !== "star") {
  l.defaults.shape = "circle";
}
```

## Filer som ändras

- `src/lib/template-migrate.ts`

Inga schemaändringar, inga DB-migreringar, inga andra filer behövs.
