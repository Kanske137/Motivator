# Fix: Uppladdning av AI-referensbild misslyckas

## Problem
När admin försöker ladda upp en referensbild i LayerInspector returnerar Supabase Storage `403 / "new row violates row-level security policy"`. Bucketen `ai-references` skapades som public men saknar INSERT/UPDATE/DELETE-policies på `storage.objects`. Public-flaggan styr endast läsning — skrivningar kräver explicita RLS-policies.

## Lösning
Skapa en migration som lägger till storage-policies för bucketen `ai-references`. Eftersom admin-gränssnittet idag inte har ett auth-skikt (samma mönster som `cart-previews` och `print-files`) tillåter vi uppladdning för alla roller, identiskt med befintliga buckets för designer-flödet.

### SQL (migration)
```sql
-- Läsning: alla (bucket är redan public, men policy gör beteendet explicit)
create policy "Public read ai-references"
on storage.objects for select
using (bucket_id = 'ai-references');

-- Uppladdning: tillåt anon + authenticated (samma som cart-previews/print-files)
create policy "Anyone can upload ai-references"
on storage.objects for insert
with check (bucket_id = 'ai-references');

-- Uppdatering (för upsert/byte av bild)
create policy "Anyone can update ai-references"
on storage.objects for update
using (bucket_id = 'ai-references');

-- Borttagning (för admin "ta bort referensbild")
create policy "Anyone can delete ai-references"
on storage.objects for delete
using (bucket_id = 'ai-references');
```

## Verifiering
1. Ladda upp en PNG i Layer-inspektorn för en `aiPhoto`-layer → 200 OK, public URL sparas i `defaults.referenceImageUrl`.
2. Byt referensbild → ny fil laddas upp utan fel.
3. Bilden visas i admin-canvasen.

## Sidoanteckning (ingen ändring nu)
Långsiktigt bör admin-uppladdningar gatas bakom en `has_role(auth.uid(), 'admin')`-policy när auth införs. Det är ett separat spår och berör även `cart-previews`/`print-files`, så vi gör inget med det här.

## Filer som ändras
- Ny migration: `supabase/migrations/<timestamp>_ai_references_policies.sql`

Inga kodändringar i frontend behövs — `uploadAiReferenceImage` är redan korrekt.
