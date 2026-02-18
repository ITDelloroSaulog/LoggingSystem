-- STEP 17: Verify source congruence after running sync scripts
-- Run after STEPS 10, 11, 12, 15.

with expected as (
  select 'litigation_tracker'::text as source_key, 45::int as expected_rows
  union all select 'special_project_summary', 53
  union all select 'retainer_backlog_2025', 97
  union all select 'retainer_ope_csv', 16
),
actual as (
  select 'litigation_tracker'::text as source_key, count(*)::int as actual_rows
  from public.activities a
  where a.task_category like 'litigation_%'
    and coalesce(a.description, '') ilike '%Source: LITIGATIONS SUMMARY TRACKER.xlsx%'

  union all

  select 'special_project_summary'::text as source_key, count(*)::int as actual_rows
  from public.activities a
  where a.task_category = 'special_project'
    and coalesce(a.description, '') ilike '%Source: SPECIAL PROJECT 2026.xlsx%'

  union all

  select 'retainer_backlog_2025'::text as source_key, count(*)::int as actual_rows
  from public.activities a
  where a.task_category = 'retainer_backlog'
    and coalesce(a.description, '') ilike 'Retainer Backlog |%Source: DSLAW RETAINER2026.xlsx%'

  union all

  select 'retainer_ope_csv'::text as source_key, count(*)::int as actual_rows
  from public.activities a
  where a.task_category = 'retainer_ope_csv'
    and coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026 - %.csv%'
),
integrity as (
  select
    count(*) filter (where account_id is null) as missing_account_id,
    count(*) filter (where created_by is null) as missing_created_by,
    count(*) filter (where performed_by is null) as missing_performed_by,
    count(*) filter (where handling_lawyer_id is null) as missing_handling_lawyer
  from public.activities a
  where coalesce(a.description, '') ilike '%Source: LITIGATIONS SUMMARY TRACKER.xlsx%'
     or coalesce(a.description, '') ilike '%Source: SPECIAL PROJECT 2026.xlsx%'
     or coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026.xlsx%'
     or coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026 - %.csv%'
),
dupes as (
  select
    source_key,
    count(*)::int as duplicate_groups
  from (
    select
      case
        when a.task_category like 'litigation_%' and coalesce(a.description, '') ilike '%Source: LITIGATIONS SUMMARY TRACKER.xlsx%' then 'litigation_tracker'
        when a.task_category = 'special_project' and coalesce(a.description, '') ilike '%Source: SPECIAL PROJECT 2026.xlsx%' then 'special_project_summary'
        when a.task_category = 'retainer_backlog' and coalesce(a.description, '') ilike 'Retainer Backlog |%Source: DSLAW RETAINER2026.xlsx%' then 'retainer_backlog_2025'
        when a.task_category = 'retainer_ope_csv' and coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026 - %.csv%' then 'retainer_ope_csv'
        else null
      end as source_key,
      a.account_id,
      public.norm_key(a.matter) as matter_key,
      a.occurred_at::date as occurred_on,
      count(*) as n
    from public.activities a
    group by 1, 2, 3, 4
    having count(*) > 1
  ) z
  where source_key is not null
  group by source_key
)
select
  e.source_key,
  e.expected_rows,
  coalesce(a.actual_rows, 0) as actual_rows,
  coalesce(a.actual_rows, 0) - e.expected_rows as diff_rows,
  coalesce(d.duplicate_groups, 0) as duplicate_groups
from expected e
left join actual a on a.source_key = e.source_key
left join dupes d on d.source_key = e.source_key
order by e.source_key;

with integrity as (
  select
    count(*) filter (where account_id is null) as missing_account_id,
    count(*) filter (where created_by is null) as missing_created_by,
    count(*) filter (where performed_by is null) as missing_performed_by,
    count(*) filter (where handling_lawyer_id is null) as missing_handling_lawyer
  from public.activities a
  where coalesce(a.description, '') ilike '%Source: LITIGATIONS SUMMARY TRACKER.xlsx%'
     or coalesce(a.description, '') ilike '%Source: SPECIAL PROJECT 2026.xlsx%'
     or coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026.xlsx%'
     or coalesce(a.description, '') ilike '%Source: DSLAW RETAINER2026 - %.csv%'
)
select * from integrity;
