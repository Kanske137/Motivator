
insert into storage.buckets (id, name, public)
values ('print-files', 'print-files', true)
on conflict (id) do nothing;

create policy "Public read print-files"
on storage.objects for select
using (bucket_id = 'print-files');

create policy "Anyone can upload print-files"
on storage.objects for insert
with check (bucket_id = 'print-files');
