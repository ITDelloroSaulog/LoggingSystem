-- STEP 21: Normalize activities UPDATE RLS so tracker row saves work
-- Run in Supabase SQL Editor as project owner/postgres.
-- Safe to re-run.

begin;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activities'
      and cmd = 'UPDATE'
  loop
    execute format('drop policy if exists %I on public.activities;', pol.policyname);
  end loop;
end $$;

create policy "Activities update by admin or account member"
on public.activities
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(trim(coalesce(p.role, ''))) in ('super_admin', 'admin')
  )
  or exists (
    select 1
    from public.account_members am
    where am.account_id = activities.account_id
      and am.user_id = auth.uid()
  )
)
with check (
  (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(trim(coalesce(p.role, ''))) in ('super_admin', 'admin')
    )
    or exists (
      select 1
      from public.account_members am
      where am.account_id = activities.account_id
        and am.user_id = auth.uid()
    )
  )
  and (
    created_by = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(trim(coalesce(p.role, ''))) in ('super_admin', 'admin')
    )
  )
);

commit;

