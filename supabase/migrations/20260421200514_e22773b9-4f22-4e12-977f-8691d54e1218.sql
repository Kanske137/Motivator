
-- Configure print-files bucket: 15 MB limit, allow JPEG/PNG/WebP, public read
update storage.buckets
set public = true,
    file_size_limit = 15728640,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'print-files';

-- Public read policy
drop policy if exists "Public read print-files" on storage.objects;
create policy "Public read print-files"
  on storage.objects for select
  using (bucket_id = 'print-files');

-- Allow anyone (incl. anon Shopify iframe users) to upload print files.
-- Files use random UUID names so collisions are impossible.
drop policy if exists "Anyone can upload print-files" on storage.objects;
create policy "Anyone can upload print-files"
  on storage.objects for insert
  with check (bucket_id = 'print-files');

drop policy if exists "Anyone can update print-files" on storage.objects;
create policy "Anyone can update print-files"
  on storage.objects for update
  using (bucket_id = 'print-files');
