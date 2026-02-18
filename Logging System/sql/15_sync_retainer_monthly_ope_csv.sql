-- STEP 15: Sync retainer monthly OPE rows from CSV (insert missing only)
-- Source: DSLAW RETAINER2026 - *.csv
-- Parsed rows: 16
-- Safe to re-run.

create extension if not exists pgcrypto;

begin;

with source_rows (
  row_no,
  source_file,
  client_name,
  occurred_on,
  matter,
  billing_status,
  billable,
  workflow_status,
  invoice_no,
  performed_by_name,
  handling_name,
  amount,
  activity_type,
  task_category,
  source_note
) as (
  values
    (1, 'DSLAW RETAINER2026 - FEB 2026.csv', 'BAC HOLDING', '2026-02-04', 'PUBLIC NOTARIZATION FOR GIS2026', 'billable', true, 'pending', '', 'CHAVEZ', '', 775.00, 'appearance', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: CHAVEZ | Location: KAPITOLYO PASIG'),
    (2, 'DSLAW RETAINER2026 - FEB 2026.csv', 'CABREBALD CORP', '2026-02-04', 'PUBLIC NOTARIZATION FOR GIS2026', 'billable', true, 'pending', '', 'CHAVEZ', '', 775.00, 'appearance', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: CHAVEZ | Location: KAPITOLYO PASIG'),
    (3, 'DSLAW RETAINER2026 - FEB 2026.csv', 'PHILCARE PHARMA INC.', '2026-02-04', 'LALAMOVE (SEC CERT)', 'billable', true, 'pending', '', 'MEDIANTE', '', 332.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: MEDIANTE | Location: 3 MAHOGANY AGAPITO SANTOLAN PASIG'),
    (4, 'DSLAW RETAINER2026 - FEB 2026.csv', 'FOREST PARK', '2026-02-10', 'LBC FILING OF DEMAND FOR TRANSFER CERTIFICATE OF OWNERSHIP (DOCUMENTS PROVIDED BY FOREST PARK, LBC ONLY, NO PRINTING EXPENSE INCURRED)', 'billable', true, 'pending', '', 'OLIVEROS', '', 315.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: OLIVEROS | Location: 91 RIVERA ST. 12TH AVE BIGLANG AWA SOUTH CALOOCAN'),
    (5, 'DSLAW RETAINER2026 - FEB 2026.csv', 'CBL (CARLITA LUNA)', '2026-02-10', 'PUBLIC NOTARIZATION OF AFFIDAVIT OF LOSS OF DRIVER''S LICENSE', 'billable', true, 'pending', '', 'EPONG', '', 500.00, 'appearance', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: KAPITOLYO PASIG'),
    (6, 'DSLAW RETAINER2026 - FEB 2026.csv', 'FROILAN CASER', '2026-02-16', 'LBC FILING (DEMAND LETTER DATED 16 FEB 2026', 'billable', true, 'pending', '', 'EPONG', '', 350.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: KAPITOLYO PASIG'),
    (7, 'DSLAW RETAINER2026 - FEB 2026.csv', 'ANC CCC HOLDING CORP', '2026-01-14', 'PROCESS OF RENEWAL OF BUSINESS PERMIT (FAILED)', 'billable', true, 'pending', '', 'EPONG', '', 1254.00, 'appearance', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: PASIG'),
    (8, 'DSLAW RETAINER2026 - FEB 2026.csv', 'ACHELOUS CORP', '2026-01-14', 'PROCESS OF RENEWAL OF BUSINESS PERMIT (FAILED)', 'billable', true, 'pending', '', 'EPONG', '', 1254.00, 'appearance', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: PASIG'),
    (9, 'DSLAW RETAINER2026 - FEB 2026.csv', 'ANC CCC HOLDING CORP', '2026-01-15', 'ASSESSMENT OF BUSINESS PERMIT', 'billable', true, 'pending', '', 'EPONG', '', 10928.80, 'pleading_major', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: PASIG'),
    (10, 'DSLAW RETAINER2026 - FEB 2026.csv', 'ACHELOUS CORP', '2026-01-15', 'ASSESSMENT OF BUSINESS PERMIT', 'billable', true, 'pending', '', 'EPONG', '', 10928.80, 'pleading_major', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: PASIG'),
    (11, 'DSLAW RETAINER2026 - FEB 2026.csv', 'ANC CCC HOLDING CORP', '2026-01-16', 'PAYMENT OF BUSINESS PERMIT', 'billable', true, 'pending', '', 'EPONG', '', 0.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: PASIG'),
    (12, 'DSLAW RETAINER2026 - FEB 2026.csv', 'ACHELOUS CORP', '2026-01-16', 'PAYMENT OF BUSINESS PERMIT', 'billable', true, 'pending', '', 'EPONG', '', 2063.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - FEB 2026.csv | Assignee: EPONG | Location: PASIG'),
    (13, 'DSLAW RETAINER2026 - JAN 2026.csv', 'CABREBALD CORP', '2026-01-13', 'SEC CERT THRU GRAB', 'billable', true, 'pending', 'INV-0975', 'MEDIANTE', 'NTF', 258.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - JAN 2026.csv | Assignee: MEDIANTE | Location: FORD COMMONWEALTH | Handling: NTF'),
    (14, 'DSLAW RETAINER2026 - JAN 2026.csv', 'PHILCARE PHARMA INC.', '2026-01-16', 'GIS 2026 NOTARY', 'billable', true, 'pending', 'INV-0966', 'BRIOSO', 'NTF', 650.00, 'appearance', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - JAN 2026.csv | Assignee: BRIOSO | Location: PASIG | Handling: NTF'),
    (15, 'DSLAW RETAINER2026 - JAN 2026.csv', 'ANC CAR DEALERSHIPS', '2026-01-16', 'PICK UP OF COLLECTIONS', 'billable', true, 'pending', 'INV-0983', 'EPONG', '', 599.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - JAN 2026.csv | Assignee: EPONG | Location: FORD COMMONWEALTH'),
    (16, 'DSLAW RETAINER2026 - JAN 2026.csv', 'ANNALYN PATRICINIO', '2026-01-20', 'NOTARY OF SPA', 'billable', true, 'pending', 'INV-0972', 'ARCE', '', 510.00, 'communication', 'retainer_ope_csv', 'Source File: DSLAW RETAINER2026 - JAN 2026.csv | Assignee: ARCE | Location: PASIG')
),
actor as (
  select coalesce(
    (select p.id from public.profiles p where lower(trim(coalesce(p.role,''))) in ('super_admin','admin') order by p.created_at asc nulls last limit 1),
    (select p.id from public.profiles p order by p.created_at asc nulls last limit 1)
  ) as actor_id
),
default_lawyer as (
  select coalesce(
    (select p.id from public.profiles p where lower(trim(coalesce(p.role,'')))='lawyer' order by p.created_at asc nulls last limit 1),
    (select actor_id from actor)
  ) as lawyer_id
),
ensure_accounts as (
  insert into public.accounts (title, category, status, created_by)
  select distinct s.client_name, 'retainer', 'active', a.actor_id
  from source_rows s
  cross join actor a
  where not exists (
    select 1 from public.accounts x
    where public.norm_key(x.title) = public.norm_key(s.client_name)
      and lower(trim(coalesce(x.category,''))) = 'retainer'
  )
  returning id
),
target_accounts as (
  select a.id, a.title
  from public.accounts a
  where lower(trim(coalesce(a.category,''))) = 'retainer'
    and public.norm_key(a.title) in (select public.norm_key(client_name) from source_rows)
),
resolved as (
  select
    s.row_no,
    s.source_file,
    ta.id as account_id,
    s.matter,
    s.occurred_on::date as occurred_on,
    s.billing_status,
    s.billable,
    case when s.workflow_status='draft' then 'draft' else 'pending' end as status,
    s.invoice_no,
    s.performed_by_name,
    s.handling_name,
    s.source_note,
    greatest(coalesce(s.amount,0::numeric),0::numeric) as amount,
    (select actor_id from actor) as actor_id,
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.full_name,''))) = lower(trim(coalesce(s.performed_by_name,'')))
           or lower(trim(coalesce(p.email,''))) = lower(trim(coalesce(s.performed_by_name,'')))
        order by p.created_at asc nulls last
        limit 1
      ),
      (select actor_id from actor)
    ) as performed_by_id,
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.role,''))) = 'lawyer'
          and (
            lower(trim(coalesce(p.full_name,''))) = lower(trim(coalesce(s.handling_name,'')))
            or lower(trim(coalesce(p.email,''))) = lower(trim(coalesce(s.handling_name,'')))
            or (
              length(regexp_replace(lower(coalesce(s.handling_name,'')), '[^a-z]', '', 'g')) between 2 and 4
              and regexp_replace(
                    (
                      select string_agg(substr(token,1,1), '')
                      from regexp_split_to_table(lower(coalesce(p.full_name,'')), '\s+') token
                      where token <> ''
                    ),
                    '[^a-z]',
                    '',
                    'g'
                  ) = regexp_replace(lower(coalesce(s.handling_name,'')), '[^a-z]', '', 'g')
            )
          )
        order by p.created_at asc nulls last
        limit 1
      ),
      (select lawyer_id from default_lawyer)
    ) as handling_lawyer_id,
    case
      when s.activity_type in ('appearance','pleading_major','pleading_minor','communication') then s.activity_type
      else 'communication'
    end as activity_type,
    s.task_category
  from source_rows s
  join target_accounts ta on public.norm_key(ta.title) = public.norm_key(s.client_name)
),
inserted as (
  insert into public.activities (
    batch_id, line_no, account_id, matter, billing_status, billable,
    created_by, activity_type, performed_by, handling_lawyer_id, status,
    fee_code, task_category, amount, minutes, description, occurred_at,
    attachment_urls, submitted_at, draft_expires_at
  )
  select
    gen_random_uuid(),
    r.row_no,
    r.account_id,
    r.matter,
    r.billing_status,
    r.billable,
    r.actor_id,
    r.activity_type,
    r.performed_by_id,
    r.handling_lawyer_id,
    r.status,
    null,
    r.task_category,
    r.amount,
    0,
    concat(
      'Retainer OPE | Invoice: ', coalesce(nullif(r.invoice_no,''), '-'),
      ' | Assignee: ', coalesce(nullif(r.performed_by_name,''), '-'),
      ' | Location: ', coalesce(
        nullif(
          trim(
            coalesce(
              substring(r.source_note from 'Location:\s*([^|]+)'),
              ''
            )
          ),
          ''
        ),
        '-'
      ),
      ' | Handling: ', coalesce(nullif(r.handling_name,''), '-'),
      ' | Source: ', r.source_file
    ),
    (r.occurred_on::timestamptz + time '09:00'),
    null,
    case when r.status='draft' then null else now() end,
    case when r.status='draft' then now()+interval '30 minutes' else null end
  from resolved r
  where not exists (
    select 1 from public.activities a
    where a.account_id = r.account_id
      and public.norm_key(a.matter) = public.norm_key(r.matter)
      and a.occurred_at::date = r.occurred_on
  )
  returning id
)
select
  (select count(*) from source_rows) as source_rows_count,
  (select count(*) from ensure_accounts) as accounts_created,
  (select count(*) from inserted) as activities_inserted;

commit;
