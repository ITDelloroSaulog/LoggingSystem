-- STEP 18: Realign imported activities to the correct account category
-- Use this when older imports attached rows to wrong-category accounts.
-- Safe to re-run.

with scoped as (
  select
    a.id as activity_id,
    a.account_id as old_account_id,
    acc.title as old_title,
    lower(trim(coalesce(acc.category, ''))) as old_category,
    case
      when a.task_category like 'litigation_%'
        and coalesce(a.description, '') ilike '%Source: LITIGATIONS SUMMARY TRACKER.xlsx%' then 'litigation'
      when a.task_category = 'special_project'
        and coalesce(a.description, '') ilike '%Source: SPECIAL PROJECT 2026.xlsx%' then 'special_project'
      when a.task_category in ('retainer_backlog', 'retainer_ope_csv')
        and (
          coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026.xlsx%'
          or coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026 - %.csv%'
        ) then 'retainer'
      else null
    end as expected_category
  from public.activities a
  join public.accounts acc
    on acc.id = a.account_id
),
needs_realign as (
  select *
  from scoped s
  where s.expected_category is not null
    and s.old_category is distinct from s.expected_category
),
candidate as (
  select
    n.activity_id,
    n.old_account_id,
    n.expected_category,
    n.old_title,
    (
      select acc2.id
      from public.accounts acc2
      where public.norm_key(acc2.title) = public.norm_key(n.old_title)
        and lower(trim(coalesce(acc2.category, ''))) = n.expected_category
      order by acc2.created_at asc nulls last, acc2.id
      limit 1
    ) as new_account_id
  from needs_realign n
),
updated as (
  update public.activities a
  set
    account_id = c.new_account_id,
    updated_at = now()
  from candidate c
  where a.id = c.activity_id
    and c.new_account_id is not null
    and a.account_id is distinct from c.new_account_id
  returning a.id
)
select
  (select count(*) from needs_realign) as rows_needing_realign,
  (select count(*) from updated) as rows_realigned,
  (select count(*) from candidate where new_account_id is null) as rows_without_target_account;
