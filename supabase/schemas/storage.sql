insert into storage.buckets (id, name, public)
values ('email-assets', 'email-assets', true)
on conflict (id) do update
set public = excluded.public;

create policy "Email Assets Public Read"
on storage.objects for select
using (bucket_id = 'email-assets');

create policy "Email Assets Authenticated Upload"
on storage.objects for insert
with check (bucket_id = 'email-assets' and auth.role() = 'authenticated');

create policy "Email Assets Authenticated Update"
on storage.objects for update
using (bucket_id = 'email-assets' and auth.role() = 'authenticated')
with check (bucket_id = 'email-assets' and auth.role() = 'authenticated');

create policy "Email Assets Authenticated Delete"
on storage.objects for delete
using (bucket_id = 'email-assets' and auth.role() = 'authenticated');