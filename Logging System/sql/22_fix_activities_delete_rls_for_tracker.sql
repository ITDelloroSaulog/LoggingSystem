-- STEP 22: Allow tracker row delete for admins and account members
-- Run in Supabase SQL Editor as project owner/postgres.
-- Safe to re-run.

begin;

drop policy if exists "Activities delete by admin or account member" on public.activities;
create policy "Activities delete by admin or account member"
on public.activities
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(trim(coalesce(p.role, ''))) in ('super_admin', 'admin')
  )
  or (
    exists (
      select 1
      from public.account_members am
      where am.account_id = activities.account_id
        and am.user_id = auth.uid()
    )
    and lower(trim(coalesce(activities.status, ''))) in ('draft', 'pending', 'rejected')
  )
);

commit;

