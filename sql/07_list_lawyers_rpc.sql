-- STEP 7: Firm-wide Handling Lawyer list (RPC, security definer)
-- Run in Supabase SQL Editor as project owner/postgres.
--
-- Goal:
-- Any authenticated user can choose a "Handling Lawyer" from ALL lawyers,
-- even if they are not members of the selected account.
--
-- This avoids UI breakage caused by RLS on public.profiles/public.account_members.

create or replace function public.list_handling_lawyers()
returns table (
  id uuid,
  full_name text,
  email text,
  role text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.email,
    p.role
  from public.profiles p
  where lower(trim(coalesce(p.role, ''))) = 'lawyer'
  order by
    lower(coalesce(p.full_name, p.email, p.id::text)) asc;
$$;

revoke all on function public.list_handling_lawyers() from public;
grant execute on function public.list_handling_lawyers() to authenticated;

notify pgrst, 'reload schema';
