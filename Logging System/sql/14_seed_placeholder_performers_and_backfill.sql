-- STEP 14: Seed placeholder performer profiles (no email from source) + backfill performed_by
-- Safe to re-run.
-- Notes:
-- 1) If public.profiles.id has an FK to auth.users(id), placeholder profile insertion is skipped automatically.
-- 2) performed_by backfill still runs using whatever matching profiles already exist.

create extension if not exists pgcrypto;

begin;

create temp table if not exists tmp_import_people (
  name text primary key
) on commit drop;

truncate tmp_import_people;

insert into tmp_import_people(name)
select distinct clean_name
from (
  select nullif(trim(x.name), '') as clean_name
  from (
    values
      ('Mediante'),
      ('Chavez'),
      ('Brioso'),
      ('Epong'),
      ('Dionela'),
      ('Arce'),
      ('Oliveros'),
      ('NTF'),
      ('MVB'),
      ('MLM')
  ) as x(name)

  union all

  select nullif(trim(substring(a.description from 'Assignee:\s*([^|]+)')), '')
  from public.activities a
  where a.description is not null

  union all

  select nullif(trim(substring(a.description from 'Handling:\s*([^|]+)')), '')
  from public.activities a
  where a.description is not null
) s
where clean_name is not null
  and lower(clean_name) not in ('-', 'n/a', 'na', 'to scan');

do $$
declare
  has_auth_fk boolean;
begin
  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'profiles'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) ilike '%references auth.users%'
  )
  into has_auth_fk;

  if has_auth_fk then
    raise notice 'Skipping placeholder profile insert: public.profiles references auth.users.';
  else
    insert into public.profiles (id, email, full_name, role)
    select
      gen_random_uuid(),
      lower(regexp_replace(tp.name, '[^a-zA-Z0-9]+', '_', 'g'))
        || '.'
        || substr(md5(lower(tp.name)), 1, 8)
        || '@import.local',
      tp.name,
      'staff_encoder'
    from tmp_import_people tp
    where not exists (
      select 1
      from public.profiles p
      where lower(trim(coalesce(p.full_name, ''))) = lower(trim(tp.name))
         or lower(trim(coalesce(p.email, ''))) = lower(trim(tp.name))
    );
  end if;
end $$;

with picked as (
  select
    a.id as activity_id,
    trim(
      coalesce(
        substring(a.description from 'Assignee:\s*([^|]+)'),
        substring(a.description from 'Handling:\s*([^|]+)')
      )
    ) as person_name
  from public.activities a
  where a.description ~* '(Assignee:|Handling:)'
),
mapped as (
  select
    p.activity_id,
    (
      select pr.id
      from public.profiles pr
      where lower(trim(coalesce(pr.full_name, ''))) = lower(trim(p.person_name))
         or lower(trim(coalesce(pr.email, ''))) = lower(trim(p.person_name))
      order by pr.created_at asc nulls last
      limit 1
    ) as profile_id
  from picked p
  where p.person_name is not null
    and p.person_name <> ''
),
updated_performed as (
  update public.activities a
  set
    performed_by = m.profile_id,
    updated_at = now()
  from mapped m
  where a.id = m.activity_id
    and m.profile_id is not null
    and (a.performed_by is null or a.performed_by = a.created_by)
  returning a.id
),
handling_alias as (
  select
    a.id as activity_id,
    trim(substring(a.description from 'Handling:\s*([^|]+)')) as alias
  from public.activities a
  where a.description ~* 'Handling:\s*'
),
matched_lawyer as (
  select
    h.activity_id,
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.role, ''))) = 'lawyer'
          and (
            lower(trim(coalesce(p.full_name, ''))) = lower(trim(h.alias))
            or lower(trim(coalesce(p.email, ''))) = lower(trim(h.alias))
          )
        order by p.created_at asc nulls last
        limit 1
      ),
      (
        select p2.id
        from public.profiles p2
        where lower(trim(coalesce(p2.role, ''))) = 'lawyer'
          and regexp_replace(
                (
                  select string_agg(substr(token, 1, 1), '')
                  from regexp_split_to_table(lower(coalesce(p2.full_name, '')), '\s+') token
                  where token <> ''
                ),
                '[^a-z]',
                '',
                'g'
              ) = regexp_replace(lower(coalesce(h.alias, '')), '[^a-z]', '', 'g')
        order by p2.created_at asc nulls last
        limit 1
      )
    ) as lawyer_id
  from handling_alias h
  where coalesce(h.alias, '') <> ''
),
updated_handling as (
  update public.activities a
  set
    handling_lawyer_id = ml.lawyer_id,
    updated_at = now()
  from matched_lawyer ml
  where a.id = ml.activity_id
    and ml.lawyer_id is not null
    and a.handling_lawyer_id is distinct from ml.lawyer_id
  returning a.id
)
select
  (select count(*) from tmp_import_people) as source_names_count,
  (select count(*) from updated_performed) as performed_by_backfilled,
  (select count(*) from updated_handling) as handling_lawyer_backfilled;

commit;
