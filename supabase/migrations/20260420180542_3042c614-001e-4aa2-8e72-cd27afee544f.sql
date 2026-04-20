
drop policy if exists "Public read print-files" on storage.objects;
-- Med public bucket räcker det att Gelato hämtar via direkt URL; vi behöver ingen list-policy.
-- Bucket public-flag styr direkt-URL-läsning, inte storage.objects SELECT.
