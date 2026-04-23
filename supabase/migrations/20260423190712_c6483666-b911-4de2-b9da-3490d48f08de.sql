insert into storage.buckets (id, name, public)
values ('mockup-cache', 'mockup-cache', true)
on conflict (id) do nothing;

create policy "Public read mockup-cache"
on storage.objects for select
to public
using (bucket_id = 'mockup-cache');