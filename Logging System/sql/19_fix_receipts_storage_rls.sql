-- STEP 19: Fix receipt upload RLS for storage bucket "receipts"
-- Run in Supabase SQL Editor as project owner/postgres.
-- Safe to re-run.

begin;

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "Receipts read for authenticated users" on storage.objects;
create policy "Receipts read for authenticated users"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'receipts'
  and split_part(name, '/', 1) = 'activities'
  and (
    split_part(name, '/', 2) = auth.uid()::text
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(trim(coalesce(p.role, ''))) in ('super_admin', 'admin')
    )
  )
);

drop policy if exists "Receipts upload to own folder" on storage.objects;
create policy "Receipts upload to own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and split_part(name, '/', 1) = 'activities'
  and split_part(name, '/', 2) = auth.uid()::text
);

drop policy if exists "Receipts delete from own folder" on storage.objects;
create policy "Receipts delete from own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and split_part(name, '/', 1) = 'activities'
  and split_part(name, '/', 2) = auth.uid()::text
);

commit;
