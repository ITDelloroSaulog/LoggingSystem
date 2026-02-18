-- STEP 10: Sync litigation tracker rows into activities (update existing + insert missing)
-- Source: LITIGATIONS SUMMARY TRACKER.xlsx
-- Rows imported: 45 (filtered to non-empty Client + Case Title)
-- Safe to re-run.

create extension if not exists pgcrypto;

begin;

with source_rows (
  row_no,
  client_name,
  case_title,
  venue,
  case_type,
  tracker_status,
  handling_email,
  engagement,
  notes
) as (
  values
    (1, 'RAYMUND YAP', 'RAYMUND L. YAP VS. SPOUSES MICHAEL AND ROSEMARIE GAW ET. AL.', 'RTC Branch 3, Baguio City', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', '', ''),
    (2, 'RAYMUND YAP', 'Raymund Yap vs. Sonia Tacderan & Sps. Michael and Rosemarie Gaw', 'RTC Branch 209, Mandaluyong City', 'Criminal Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (3, 'LUZ YAP', 'In Re: Petition for Reissuance of a New Owner''s Duplicate Copy of Transfer Certificate of Title No. 163-2019000603 in lieu of the lost one in the Registry of Deeds of Antipolo City', 'RTC Branch 137 , Antipolo', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'Antipolo Properties.pdf', ''),
    (4, 'LUZ YAP', 'Luz Yap vs. Sps. Erwin and Lisa Olaso, Sonia Tacderan', 'RTC Branch 83, Tanauan Batangas', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'LUZ YAP - SPS. OLASO BATANGAS.pdf', ''),
    (5, 'RONALDO SANTOS', 'Spouses Ronaldo R. Santos and Rachelle S. Santos vs. Spouses Glenn R. Santos and Luz R. Santos', 'RTC Branch 78, Malolos Bulacan', 'Civil Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'PARTITION 11 TITLES - RONALDO SANTOS.pdf', ''),
    (6, 'AMELIA SANTOS', 'AMELIA SANTOS vs. ARIEL SANTOS ET. AL.', 'Municipal Trial Court of San Miguel', 'Civil Case', 'Elevated', 'nestor.fernandez@dellorosaulog.com', 'PARTITION - AMELIA SANTOS.pdf', 'Elevated to RTC'),
    (7, 'AMELIA SANTOS', 'AMELIA SANTOS vs. ARIEL SANTOS ET. AL.', 'RTC Branch 83 City of Malolos, Bulacan', 'Civil Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (8, 'RONALDO SANTOS', 'Ronaldo R. Santos vs. Glenn R. Santos', 'RTC Branch 157, Pasig City', 'Civil Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'DISSOLUTION OF CO-OWNERSHIP_rotated.pdf', ''),
    (9, 'RYKOM', 'Editha Peji vs. Edzequil E. Sy, Rykom Financing Corp. and the Register of Deeds of Tagaytay City and Laida P. Yu', 'RTC Branch 18, Tagaytay', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', '', ''),
    (10, 'RYKOM', 'In Matter of Petition for Voluntary Liquidation of Spouses Edmond Gawani Uy and Conchita Uy', 'RTC Branch 93, Quezon City', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'EDMUND UY.pdf', ''),
    (11, 'RYKOM', 'Sps. Carlos Jose Pastor and Maria Evan Pastor vs. Rykom Financing Corporation et. al.', 'RTC Branch 4, Batangas City', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'PASTOR.pdf', ''),
    (12, 'RYKOM', 'In the Matter of Petition for Corporate Rehabilitation and Suspension of Payments; Papers and Pigments Printing Press Co., Inc.,', 'RTC Branch 253, Las Pinas', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'PAPER AND PIGMENTS.pdf', ''),
    (13, 'RYKOM', 'Prestigious Developer and Builders vs. Engr. Jesusito Legaspi and Rykom', 'RTC Branch 148, MakatiCity', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'Prestigious Developer and Builders.pdf', ''),
    (14, 'RYKOM', 'IN RE: JOINT AND CONSOLIDATED PETITION FOR REHABILITATION SPECIFIED CONTRACTORS & DEVELOPMENT INC.', 'RTC Branch 93, Quezon City', 'Civil Case', 'Elevated', 'kristine.villanueva@dellorosaulog.com', 'SCDI.pdf', 'ELEVATED TO CA'),
    (15, 'RYKOM', 'SCDI et.al. vs. RTC 93 Quezon City, and Rykom Finance Corporation et.al.', 'COURT OF APPEALS Sixth Division Manila', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', '', ''),
    (16, 'RYKOM', 'In the Matter of Petition for Voluntary Rehabilitation of Glazetech Glass & Aluminum Installation Inc.', 'RTC Branch 6, Malolos Bulacan', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'GLAZETECH.pdf', ''),
    (17, 'RYKOM', 'People of the Philippines vs. Reynaldo De Jesus', 'MTC Branch 68, Pasig', 'Criminal Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'REYNALDO DE JESUS.pdf', ''),
    (18, 'RYKOM', 'People of the Philippines vs. Elsie Matalote', 'MTC Branch 69, Pasig', 'Criminal Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', '', ''),
    (19, 'RYKOM', 'Rykom vs. Marinette Perez', 'RTC 4 Mariveles Bataan', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'MPP MARINETTE PEREZ.pdf', ''),
    (21, 'ADERITO YUJUICO', 'People of the Philippines vs. Aderito Yujuico', 'RTC Branch 141, Makati City', 'Criminal Case', 'Elevated', 'nestor.fernandez@dellorosaulog.com', 'EP_MrYujuico BP22_v4.pdf', 'Elevated to RTC'),
    (22, 'ADERITO YUJUICO', 'Alpamayo Lending Inc., represented by VENU KOTAMRAJU vs. ADERITO YUJUICO', 'METC 63 Makati', 'Criminal Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (23, 'ADERITO YUJUICO', 'Purence Realty Corp., represented by Aderito Zavalla Yujuico vs. Alpamayo Lending Inc., represented by Venu Kotamraju', 'RTC Branch 161, Pasig', 'Civil Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'PURENCE vs. ALPAMAYO.pdf', ''),
    (24, 'SPS. CHENG', 'David Rodriguez et. al. vs. Sps. Anthony and Charlotte Cheng et. al.', 'RTC Branch 89, Bacoor, Cavite', 'Civil Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (25, 'SPS. CHENG', 'Juanito Miras vs. Joseph Camello et. al.', 'OCP QC', 'Preliminary Investigation', 'In progress', 'Nestor Fernandez, Jr.', 'TO SCAN', 'FOLLOW UP OCP IF THE OTHER PARTY FILED MR'),
    (26, 'SPS. CHENG', 'GEMMA DARLO vs. RTC MANILA BRANCH 28, ET. AL.,', 'CA', 'Criminal Case', 'In progress', 'Nestor Fernandez, Jr.', '', ''),
    (27, 'HARRY LERO', 'People of the Philippines vs. Harry Harvey Lero and Donna Racho', 'RTC Branch 271, Taguig', 'Criminal Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'Lero. Harvey. Estafa 3 November 2020 (Combined).pdf', ''),
    (28, 'GIL ORENSE', 'People of the Philippines vs. Gil Orense', 'RTC Branch 146, Makati', 'Criminal Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'TO SCAN', ''),
    (29, 'RICKY SY', 'Petition For the Reissuance of a New Owner s Duplicate Copy of Transfer Certificate of Title Number 004-2012001567 In Lieu Of The Lost One in the Registry of Deeds for Quezon City; Spouses Richard Winston C. Sy and Jenny L. Sy', 'RTC Branch 100, Quezon City', 'Civil Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'RICHARD WINSTON SY.pdf', ''),
    (30, 'RODITO BANICO', 'RODITO B. BANICO, JR., vs. JEANINA B. LEGARA-BANICO', 'FC Branch 8, Pili, Camarines Sur', 'Civil Case', 'In progress', 'michelle.basmayor@dellorosaulog.com', 'RODITO BANICO.pdf', ''),
    (31, 'GERARDO DOMAGAS', 'GERARDO DOMAGAS vs CASAWITAN ET. AL.', '', 'Not started', 'Not started', '', 'GERARDO DOMAGAS.pdf', ''),
    (32, 'CEFI', 'People of the Philippines vs. Manuel Corpino', 'MTC OF PAGBILAO Fourth Judicial Region PROVINCE OF QUEZON', 'Criminal Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (33, 'FREDDIERICK DOMINGO', 'In The Matter of Petition for Cancellation of the Certificate of Live Birth of Freddie Rick C. Isidro Also Known as Freddie Rick C. Domingo, Freddie Rick C. Domingo, ET.AL', 'RTC Branch 69 Binangonan, Rizal', 'Civil Case', 'In progress', 'kristine.villanueva@dellorosaulog.com', 'Freddie Rick Domingo.pdf', ''),
    (34, 'ALDER DELLORO', 'Ma. Luisa Guysayko, Ma. Penafrancia Guysayko et.al. vs. Xavier Guysayko', 'SC MANILA', 'Civil Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (35, 'ALDER DELLORO', 'DELLORO vs. GUYSAYKO', 'CA', '', 'In progress', '', '', ''),
    (36, 'ALDER DELLORO', 'GUYSAYKO vs. DELLORO', 'RTC Branch 22, NAGA', '', 'In progress', '', '', ''),
    (37, 'NICHOLAS GUYSAYKO', 'XAVIER NICHOLAS U. GUYSAYKO vs. CHRISTA FRANCE L. LAYNESA ET.AL', 'Reginal Adjudication Branch V', 'Admin Case', 'Elevated', 'nestor.fernandez@dellorosaulog.com', '', 'ELEVATED TO CA'),
    (38, 'NICHOLAS GUYSAYKO', 'XAVIER NICHOLAS U. GUYSAYKO vs. CHRISTA FRANCE L. LAYNESA ET.AL', 'CA MANILA', 'Admin Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (39, 'NICHOLAS GUYSAYKO', 'Nancy Laynesa, represented by Vanessa Anna Pontillas vs. Pico Zennith Global Properties Inc., Xavier Nicholas Guysayko Et.al.,', 'HSAC RAB V LEGASPI CITY', 'Admin Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (40, 'NICHOLAS GUYSAYKO', 'Nancy Laynesa, represented by Vanessa Anna Pontillas vs. Pico Zennith Global Properties Inc., Xavier Nicholas Guysayko Et.al.,', 'HSAC RAB V LEGASPI CITY', 'Admin Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (41, 'NICHOLAS GUYSAYKO', 'Juan Sanchez Jr. vs. Nicholas Guysayko et.al.,', 'Reginal Adjudication Branch V', 'Admin Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (42, 'NICHOLAS GUYSAYKO', 'Ma. Concepcion Guysayko et.al., vs. Mercedito Marcial et.al.,', 'NINTH DIVISION CA MANILA', 'Admin Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (43, 'NICHOLAS GUYSAYKO', 'Sps. Danilo Laurente Et.,al vs. Ma. Concepcion Francisco, Xavier Nicholas Guysayko Et.al.,', 'HSAC RAB V LEGASPI CITY', 'Admin Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', '', ''),
    (44, 'CBL', 'CBL vs Carlson Belarmino and Royce Jaboli', 'OCP, Paranaque', 'Preliminary Investigation', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'Engagement Proposal for CBL Freight.pdf', 'NEW'),
    (45, 'Philcare Pharma, Inc.', 'Marco Gasatan vs. Philcare Pharma, Inc.', 'NLRC National Capital Region Arbitration Branch Quezon City', 'Admin Case', 'In progress', 'nestor.fernandez@dellorosaulog.com', 'EP Philcare Pharma re Marco Gasatan Illegal Dismissal.pdf', 'NEW'),
    (46, 'SPS. DOMINGO UY & MARIA CRISTINA UY', 'MARIA CRISTINA Q. UY, married to DOMINGO M. UY, SPOUSES CHRISTOPHER T. ALCAZAR and LEA P. ALCAZAR', 'RTC LAS PINAS', 'Civil Case', 'Not started', 'nestor.fernandez@dellorosaulog.com', 'Engagement Proposal Sps Uy re Recovery Property.pdf', 'NEW')
),
actor as (
  select
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.role, ''))) in ('super_admin', 'admin')
        order by p.created_at asc nulls last
        limit 1
      ),
      (
        select p.id
        from public.profiles p
        order by p.created_at asc nulls last
        limit 1
      )
    ) as actor_id
),
default_lawyer as (
  select
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.role, ''))) = 'lawyer'
        order by p.created_at asc nulls last
        limit 1
      ),
      (select actor_id from actor)
    ) as lawyer_id
),
ensure_accounts as (
  insert into public.accounts (title, category, status, created_by)
  select distinct
    s.client_name,
    'litigation',
    'active',
    a.actor_id
  from source_rows s
  cross join actor a
  where not exists (
    select 1
    from public.accounts acc
    where public.norm_key(acc.title) = public.norm_key(s.client_name)
      and lower(trim(coalesce(acc.category, ''))) = 'litigation'
  )
  returning id, title
),
target_accounts as (
  select acc.id, acc.title
  from public.accounts acc
  where lower(trim(coalesce(acc.category, ''))) = 'litigation'
    and public.norm_key(acc.title) in (
      select public.norm_key(client_name)
      from source_rows
    )
),
source_lawyers as (
  select distinct
    lower(trim(coalesce(s.handling_email, ''))) as handling_email_norm,
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.email, ''))) = lower(trim(coalesce(s.handling_email, '')))
        limit 1
      ),
      dl.lawyer_id
    ) as lawyer_id
  from source_rows s
  cross join default_lawyer dl
),
ensure_members_actor as (
  insert into public.account_members (account_id, user_id)
  select ta.id, a.actor_id
  from target_accounts ta
  cross join actor a
  where not exists (
    select 1
    from public.account_members am
    where am.account_id = ta.id
      and am.user_id = a.actor_id
  )
  returning account_id, user_id
),
ensure_members_lawyers as (
  insert into public.account_members (account_id, user_id)
  select distinct
    ta.id,
    sl.lawyer_id
  from source_rows s
  join target_accounts ta
    on public.norm_key(ta.title) = public.norm_key(s.client_name)
  join source_lawyers sl
    on sl.handling_email_norm = lower(trim(coalesce(s.handling_email, '')))
  where sl.lawyer_id is not null
    and not exists (
      select 1
      from public.account_members am
      where am.account_id = ta.id
        and am.user_id = sl.lawyer_id
    )
  returning account_id, user_id
),
resolved_rows_raw as (
  select
    s.row_no,
    ta.id as account_id,
    s.client_name,
    s.case_title,
    s.venue,
    s.case_type,
    s.tracker_status,
    s.engagement,
    s.notes,
    a.actor_id,
    sl.lawyer_id as handling_lawyer_id,
    case
      when lower(trim(coalesce(s.tracker_status, ''))) in ('not started', 'new') then 'draft'
      else 'pending'
    end as status,
    case
      when lower(trim(coalesce(s.tracker_status, ''))) in ('not started', 'new') then false
      else true
    end as billable,
    case
      when lower(trim(coalesce(s.tracker_status, ''))) in ('not started', 'new') then 'non_billable'
      else 'billable'
    end as billing_status,
    case
      when lower(coalesce(s.case_type, '')) like '%civil%' then 'pleading_major'
      when lower(coalesce(s.case_type, '')) like '%criminal%' then 'communication'
      when lower(coalesce(s.case_type, '')) like '%admin%' then 'communication'
      when lower(coalesce(s.case_type, '')) like '%preliminary%' then 'communication'
      else 'communication'
    end as activity_type,
    case
      when lower(coalesce(s.case_type, '')) like '%civil%' then 'litigation_civil'
      when lower(coalesce(s.case_type, '')) like '%criminal%' then 'litigation_criminal'
      when lower(coalesce(s.case_type, '')) like '%admin%' then 'litigation_admin'
      when lower(coalesce(s.case_type, '')) like '%preliminary%' then 'litigation_preliminary_investigation'
      else 'litigation_general'
    end as task_category,
    case
      when lower(coalesce(s.case_type, '')) like '%civil%' then 'PF'
      else null
    end as fee_code,
    (timestamptz '2025-01-01 09:00:00+08' + make_interval(days => greatest(s.row_no - 1, 0))) as occurred_at_seed,
    concat(
      'Venue: ', coalesce(s.venue, '-'),
      ' | Case Type: ', coalesce(s.case_type, '-'),
      ' | Tracker Status: ', coalesce(s.tracker_status, '-'),
      case when nullif(trim(coalesce(s.engagement, '')), '') is not null then concat(' | Engagement: ', trim(s.engagement)) else '' end,
      case when nullif(trim(coalesce(s.notes, '')), '') is not null then concat(' | Notes: ', trim(s.notes)) else '' end,
      ' | Source: LITIGATIONS SUMMARY TRACKER.xlsx'
    ) as description
  from source_rows s
  join target_accounts ta
    on public.norm_key(ta.title) = public.norm_key(s.client_name)
  cross join actor a
  join source_lawyers sl
    on sl.handling_email_norm = lower(trim(coalesce(s.handling_email, '')))
),
resolved_rows as (
  select rr.*
  from resolved_rows_raw rr
),
updated_activities as (
  update public.activities act
  set
    matter = rr.case_title,
    line_no = rr.row_no,
    activity_type = rr.activity_type,
    description = rr.description,
    billable = rr.billable,
    status = rr.status,
    task_category = rr.task_category,
    fee_code = rr.fee_code,
    performed_by = coalesce(act.performed_by, rr.actor_id),
    handling_lawyer_id = rr.handling_lawyer_id,
    billing_status = rr.billing_status,
    occurred_at = coalesce(act.occurred_at, rr.occurred_at_seed),
    submitted_at = case when rr.status = 'draft' then null else coalesce(act.submitted_at, now()) end,
    draft_expires_at = case when rr.status = 'draft' then coalesce(act.draft_expires_at, now() + interval '30 minutes') else null end,
    updated_at = now()
  from resolved_rows rr
  where act.account_id = rr.account_id
    and public.norm_key(act.matter) = public.norm_key(rr.case_title)
    and (
      coalesce(act.line_no, -1) = rr.row_no
      or act.occurred_at::date = rr.occurred_at_seed::date
    )
  returning act.id
),
inserted_activities as (
  insert into public.activities (
    batch_id,
    line_no,
    account_id,
    matter,
    billing_status,
    billable,
    created_by,
    activity_type,
    performed_by,
    handling_lawyer_id,
    status,
    fee_code,
    task_category,
    amount,
    minutes,
    description,
    occurred_at,
    attachment_urls,
    submitted_at,
    draft_expires_at
  )
  select
    gen_random_uuid(),
    rr.row_no,
    rr.account_id,
    rr.case_title,
    rr.billing_status,
    rr.billable,
    rr.actor_id,
    rr.activity_type,
    rr.actor_id,
    rr.handling_lawyer_id,
    rr.status,
    rr.fee_code,
    rr.task_category,
    0::numeric,
    0,
    rr.description,
    rr.occurred_at_seed,
    null,
    case when rr.status = 'draft' then null else now() end,
    case when rr.status = 'draft' then now() + interval '30 minutes' else null end
  from resolved_rows rr
  where not exists (
    select 1
    from public.activities act
    where act.account_id = rr.account_id
      and public.norm_key(act.matter) = public.norm_key(rr.case_title)
      and (
        coalesce(act.line_no, -1) = rr.row_no
        or act.occurred_at::date = rr.occurred_at_seed::date
      )
  )
  returning id
)
select
  (select count(*) from source_rows) as source_rows_count,
  (select count(*) from ensure_accounts) as accounts_created,
  (select count(*) from ensure_members_actor) as actor_memberships_created,
  (select count(*) from ensure_members_lawyers) as lawyer_memberships_created,
  (select count(*) from updated_activities) as activities_updated,
  (select count(*) from inserted_activities) as activities_inserted;

commit;
