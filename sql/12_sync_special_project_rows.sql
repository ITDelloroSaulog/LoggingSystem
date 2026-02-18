-- STEP 12: Sync special project tracker rows into activities (update + insert)
-- Source: SPECIAL PROJECT 2026.xlsx
-- Parsed rows: 53
-- Safe to re-run.

create extension if not exists pgcrypto;

begin;

with source_rows (
  row_no,
  client_name,
  occurred_on,
  matter,
  workflow_status,
  activity_type,
  engagement_link,
  remarks,
  source_note
) as (
  values
    (1, 'IDR. ANNALYN PAMELA P. PATROCINIO', '2026-01-06', 'the incorporation of an integrated design and build company', 'pending', 'pleading_major', 'EP Retainer with Set-up.Alyn Patrocinio.6 January 2026 (1).pdf', 'Handling: NTF | Tracker: ALYN', 'SPECIAL PROJECT 2026.xlsx'),
    (2, 'DYNAMIC TRANSINVEST LTD.', '2025-01-02', 'BIR TIN/Registration Assistance', 'pending', 'pleading_major', 'EP_BIR TIN Processing.pdf', 'Handling: MVB | Update: For request of Tin no. | Tracker: DYNAMIC', 'SPECIAL PROJECT 2026.xlsx'),
    (3, 'CYRUS ANDREI FERAER SIERRA & JHAYEHD SALAZAR TUA O', '2025-01-03', 'Special Project Engagement', 'pending', 'communication', 'EP_Franchise Agreement Review 3-Copy.pdf', 'Handling: MVB | Tracker: CYRUS', 'SPECIAL PROJECT 2026.xlsx'),
    (4, 'PHILCARE PHARMA, INC.', '2025-10-02', 'Negotiation and Representation in LOA with the Bureau of Internal Revenue', 'draft', 'communication', 'EP- Phil Care BIR Assessment.pdf', 'Handling: NTF | Update: Pending; NTF to follow up with BIR National Office | Tracker: PHILCARE', 'SPECIAL PROJECT 2026.xlsx'),
    (5, 'MS. JENTLY O. RIVERA', '2025-08-27', 'Due Diligence', 'draft', 'pleading_major', 'EP-Ms.-Rivera-re-Due-Diligence-27Aug25.pdf', 'Handling: NTF | Update: PENDING; NTF to write RD concerning the legal position that the property involved is paraphernal | Tracker: JENTLY', 'SPECIAL PROJECT 2026.xlsx'),
    (6, 'SPOUSES ALFRED and MARY JANE THERESE AUBREY MANALILI', '2025-08-26', 'TITLE TRANSFER', 'draft', 'pleading_major', 'EP-Sps-Manalili-re-Title-Transfer.pdf', 'Handling: NTF | Update: Title has been picked-up. | Tracker: MANALILI | Remarks: waiting for Tax Dec', 'SPECIAL PROJECT 2026.xlsx'),
    (7, 'MS. CARLITA N. LUNA', '2025-06-24', 'Corporate Restructuring', 'pending', 'communication', 'Engagement Proposal for Corporate Restructuring (1).pdf', 'Handling: NTF | Update: CLIENT HAS TO APPROVE THE PROPOSAL | Tracker: LUNA', 'SPECIAL PROJECT 2026.xlsx'),
    (8, 'HON. PAUL R. DAZA', '2025-06-13', 'TCT NO.12163', 'pending', 'communication', 'HON. DAZA.pdf', 'Handling: NTF | Update: COMPLETED; Billing to send allt the certificate of registrations to Sir Onnie | Tracker: HON. DAZA', 'SPECIAL PROJECT 2026.xlsx'),
    (9, 'MR. ANTHONY N. CHENG', '2025-06-04', 'Property Turn Over', 'draft', 'communication', 'Engagement Proposal for Critical Solutions Property Turn Over.pdf', 'Handling: NTF | Update: PENDING; NTF to check status of the transfer of the property to the client. | Tracker: CHENG', 'SPECIAL PROJECT 2026.xlsx'),
    (10, 'MR. GILBERT T. DEE, JR. (UMC)', '2025-05-28', 'Due Diligence of Property under TCT No. 271623', 'pending', 'pleading_major', 'EP_ Due Diligence TCT No. 271623 - UMC Gilbert Dee.pdf', 'Handling: NTF | Update: COMPLETED; NTF released due diligence report; Billing to send final bill, if neeeded | Tracker: DEE', 'SPECIAL PROJECT 2026.xlsx'),
    (11, 'CALAYAN', '2025-05-21', 'Incorporation', 'pending', 'pleading_major', 'Engagement Proposal Incorporation_rev1.pdf', 'Handling: NTF | Update: COMPLETED; Certificate of Incorporation has been secured by the client | Tracker: CALAYAN', 'SPECIAL PROJECT 2026.xlsx'),
    (12, 'MS. NENITA MARTIN DE TORRES', '2025-05-20', 'Due Diligence & Title Transfer via Deed', 'draft', 'pleading_major', 'NENITA DE TORRES_rotated.pdf', 'Handling: NTF | Update: Pending; NTF to provide report to the client | Tracker: NENITA', 'SPECIAL PROJECT 2026.xlsx'),
    (13, 'HON. PAUL R. DAZA', '2025-05-16', 'Incorporation (5 corporation)', 'pending', 'pleading_major', 'EP-HON. PAUL DAZA.pdf', 'Handling: NTF | Update: Done | Tracker: DAZA | Remarks: DONE', 'SPECIAL PROJECT 2026.xlsx'),
    (14, 'MS. CINDY RIVERA', '2025-05-15', 'MOA - Bounty', 'pending', 'communication', 'EP Ms Cindy Rivera1 (1).pdf', 'Handling: NTF | Update: COMPLETED; Labor (Tulfo) problem is resolved amicably | Tracker: RIVERA', 'SPECIAL PROJECT 2026.xlsx'),
    (15, 'Mr. Gilbert T. Dee, Jr. (UMC)', '2025-04-04', 'Due Diligence (Hyundai Joint Venture)', 'draft', 'pleading_major', 'EP_Due Diligence (Hyundai Joint Venture) - UMC Gilbert Dee.pdf', 'Handling: NTF | Update: Pending; Client has to approve the draft AOI and By-laws of the joint venture | Tracker: GILBERT D.', 'SPECIAL PROJECT 2026.xlsx'),
    (16, 'AYNS VICEROY EAST REALTY INC.', '2025-03-03', 'TRANSFER OF TITLE & TAX DECLARATION OF REAL PROPERTY EMBRACED UNDER TCT NO. 004-2015003262', 'pending', 'pleading_major', 'EP- Atty. Madrona (rev1).pdf', 'Handling: NTF | Update: Done - for billing | Tracker: AYNS | Remarks: FOR BILLING', 'SPECIAL PROJECT 2026.xlsx'),
    (17, 'MR. MICHAEL KOOZNETSOFF', '2025-02-17', 'Judicial Settlement of Estate of Ms. Leora Aguilar Puso', 'draft', 'pleading_major', 'MICHAEL KOOZNETSOFF', 'Handling: MVB | Update: Pending; NTF to provide report to the client | Tracker: MICHAEL', 'SPECIAL PROJECT 2026.xlsx'),
    (18, 'MS. LAURA IGNACIO', '2025-02-12', 'Estate Planning', 'draft', 'communication', 'EP - LAURA IGNACIO.pdf', 'Handling: NTF | Update: Email invitation sent to Ms. Ignacio to a meeting on 15 January 2025 at 1:00pm; awaiting for confirmation | Tracker: LAURA IGNACIO', 'SPECIAL PROJECT 2026.xlsx'),
    (19, 'SPOUSES ANTHONY N. CHENG & CHARLOTTE CHENG', '2025-02-12', 'SEC', 'draft', 'pleading_major', 'Engagement Proposal Matterhorn SEC Audit.docx', 'Handling: NTF | Update: Pending; Awaiting SEC''s feedback on comment prepared by the firm;Billing to check if payment was received; | Tracker: SPS CHENG', 'SPECIAL PROJECT 2026.xlsx'),
    (20, 'WINSTON FABRIKOID CORP', '2025-01-20', 'Sale of lot covered under TCT No. 38029', 'pending', 'communication', 'EP-Sale of Final Lot to Sir Oliver.docx', 'Handling: NTF | Update: COMPLETED | Tracker: WINSTON | Remarks: DONE', 'SPECIAL PROJECT 2026.xlsx'),
    (21, 'OLIVER JOHNSTON SY', '2025-01-17', 'Corporate Formation', 'pending', 'communication', 'OLIVER SY CORPORATE FORMATION.pdf', 'Handling: NTF | Update: COMPLETED | Tracker: OLIVER SY | Remarks: DONE', 'SPECIAL PROJECT 2026.xlsx'),
    (22, 'MS. FLORA L. VILLAROSA', '2025-01-02', 'King & Queen Bar and Restaurant', 'draft', 'communication', 'EP_Mayor Villarosa_Admin Case.pdf', 'Handling: NTF | Update: Pending; NTF already prepared letter request addressed to the Mayor | Tracker: FLORA', 'SPECIAL PROJECT 2026.xlsx'),
    (23, 'MR. GILBERT T. DEE, JR.', '2024-12-25', 'Due Diligence of Property under TCT No. 19966', 'pending', 'pleading_major', 'Engagement Proposal TCT No. 19966 (3).pdf', 'Handling: NTF | Update: COMPLETED; NTF already sent final report to the client; Billing to s | Tracker: GILBERT', 'SPECIAL PROJECT 2026.xlsx'),
    (24, 'DR. MASANGKAY', '2024-12-17', 'DUE DILIGENCE', 'pending', 'pleading_major', 'EP_Ris_Doc_Masangkay.pdf', 'Handling: MVB | Tracker: MASANGKAY', 'SPECIAL PROJECT 2026.xlsx'),
    (25, 'FULL POTENTIAL BPO INC.', '2024-12-10', 'BIR LOA', 'draft', 'pleading_major', 'SIGNED-Full Potential BIR Assessment and Criminal Case (rev) copy.pdf', 'Handling: NTF | Update: Pending; Accounting to send billing for the success fee | Tracker: FULL POTENTIAL', 'SPECIAL PROJECT 2026.xlsx'),
    (26, 'MR. RONALDO SANTOS', '2024-12-03', 'Corporate Formation for Concord Pasig Property', 'draft', 'communication', 'EP Concord Pasig_03Dec24.pdf', 'Handling: NTF | Update: Pending; Client has to ready the office | Tracker: CONCORD', 'SPECIAL PROJECT 2026.xlsx'),
    (27, 'MS. GRACIALITA C. CHUA', '2024-08-19', 'Transfer of shares of Stock - a.) from Phil Bed to Ms. Chua; b.) from Ms. Chua to Anthony N. Cheng', 'draft', 'pleading_major', 'Signed EP_Phil Bed and Grace Chua Shares.pdf', 'Handling: NTF | Update: Pending; NTF to set a meeting to John Chua | Tracker: CHUA', 'SPECIAL PROJECT 2026.xlsx'),
    (28, 'ASHTON TECHNOLOGIES CORP.', '2024-07-29', 'eLA202200046025', 'draft', 'communication', 'EngagementContract---LOA 2023.pdf', 'Handling: NTF | Update: PENDING; LOA YEAR 2023 awaiting FINAL ASSESSMENT | Tracker: ASHTON', 'SPECIAL PROJECT 2026.xlsx'),
    (29, 'MR. FREDDIE RICK C. DOMINGO', '2024-07-26', 'Petition for Cancellation or Correction of Entry in the Civil Registry', 'draft', 'pleading_major', 'Freddie Rick Domingo.pdf', 'Handling: MLM | Tracker: DOMINGO | Remarks: waiting for update', 'SPECIAL PROJECT 2026.xlsx'),
    (30, 'MR. ALLAN JAYSON LOPEZ', '2024-06-19', 'Due Diligence and Negotiation for Property Acquisition', 'pending', 'pleading_major', 'EP - Allan Lopez.pdf', 'Handling: MVB | Update: DONE | Tracker: ALLAN | Remarks: DONE', 'SPECIAL PROJECT 2026.xlsx'),
    (31, 'MR. JULIUS DEL MUNDO', '2024-06-10', 'Due Diligence & Title Transfer via Deed', 'draft', 'pleading_major', 'JULIUS DEL MUNDO.pdf', 'Handling: NTF | Update: Pending; NTF to provide report to the client | Tracker: DEL MUNDO', 'SPECIAL PROJECT 2026.xlsx'),
    (32, 'MS. JULIE TAN', '2024-05-21', 'BIR LOA', 'draft', 'pleading_major', 'JULIE TAN - REVISED.pdf', 'Handling: NTF | Update: Pending; Awaiting feedback from the BIR on the proposed settlement | Tracker: JULIE TAN', 'SPECIAL PROJECT 2026.xlsx'),
    (33, 'MR. RONALDO SANTOS', '2024-04-24', 'Title or Ownership over TCT no. T-187175', 'draft', 'pleading_major', 'TCT NO. 187175- RONALDO SANTOS - Title Transfer.pdf', 'Handling: NTF | Update: Pending; see remarks under "Next Incident'' | Tracker: RONALDO', 'SPECIAL PROJECT 2026.xlsx'),
    (34, 'WINSTON FABRIKOID CORP', '2024-02-29', 'Proposal for the objective of removing the consulta entries', 'pending', 'communication', 'EP-Winston re Consulta Removal---SIGNED---PAID.pdf', 'Handling: NTF | Update: COMPLETED | Tracker: WINSTON | Remarks: COMPLETED', 'SPECIAL PROJECT 2026.xlsx'),
    (35, 'ASHTON TECHNOLOGIES CORP.', '2024-02-16', 'eLA202200046025', 'pending', 'communication', 'LOA - BIR 27.pdf', 'Handling: NTF | Update: COMPLETED; LOA YEAR 2022 | Tracker: ASHTON | Remarks: COMPLETED', 'SPECIAL PROJECT 2026.xlsx'),
    (36, 'SPOUSES WOODEN PLASABAS CORTEL AND JASHMINE MENDOZA CORTEL', '2024-02-15', 'Processing of Title Transfer', 'draft', 'pleading_major', 'SPS. Wooden and Jashmine Cortel - ENGAGEMENT.pdf', 'Handling: NTF | Tracker: SPS. CORTEL | Remarks: WAITING FOR UPDATE', 'SPECIAL PROJECT 2026.xlsx'),
    (37, 'MR. RONALDO SANTOS', '2024-02-15', 'Local Manpower Agency -Phase I', 'draft', 'communication', 'LOCAL MANPOWER AGENCY PHASE 1_rotated.pdf', 'Handling: NTF | Update: Pending; see remarks under "Next Incident'' | Tracker: RONALDO', 'SPECIAL PROJECT 2026.xlsx'),
    (38, 'MR. RONALDO SANTOS', '2024-02-07', 'Corporation Set-Up', 'pending', 'communication', 'JST CORPORATION SET UP - JENSEN SANTOS.pdf', 'Handling: NTF | Update: Completed; Billing to send final bill, if necessary | Tracker: RONALDO | Remarks: BILLING', 'SPECIAL PROJECT 2026.xlsx'),
    (39, 'WINSTON FABRIKOID CORPORATION', '2024-02-03', 'Due Diligence, SEC Compliance, Amendment of Corporate Charter and Introduction of Tax Saving Mechanisms', 'pending', 'pleading_major', 'DUE DILIGENCE - SEC COMPLIANCE.pdf', 'Handling: NTF | Update: COMPLETED | Tracker: WINSTON | Remarks: COMPLETED', 'SPECIAL PROJECT 2026.xlsx'),
    (40, 'MR. RONALDO SANTOS', '2024-01-31', 'Local Manpower Agency -Phase II & III', 'draft', 'communication', 'LOCAL MANPOWER AGENCY PHASE 2 AND 3_rotated.pdf', 'Handling: NTF | Update: Pending; see remarks under "Next Incident'' | Tracker: RONALDO', 'SPECIAL PROJECT 2026.xlsx'),
    (41, 'MR. RONALDO SANTOS', '2024-01-18', 'Direct Hiring of Manpower', 'draft', 'communication', 'DIRECT HIRING OF MANPOWER - RONALDO SANTOS.pdf', 'Handling: NTF | Update: Pending; This is put on hold due to difficulty in hiring Nurse from PH to the US | Tracker: RONALDO', 'SPECIAL PROJECT 2026.xlsx'),
    (42, 'WINSTON FABRIKOID CORPORATION', '2024-01-15', 'Due Diligence and Sale of Lot 107', 'pending', 'pleading_major', 'DUE DILIGENCE - SALE LOT 107.pdf', 'Handling: NTF | Update: COMPLETED | Tracker: WINSTON | Remarks: COMPLETED', 'SPECIAL PROJECT 2026.xlsx'),
    (43, 'MR. RONALDO SANTOS', '2023-12-06', 'Townhouse Investment', 'pending', 'communication', 'TOWNHOUSE INVESTMENT_rotated.pdf', 'Handling: NTF | Update: COMPLETED; | Tracker: RONALDO | Remarks: COMPLETED', 'SPECIAL PROJECT 2026.xlsx'),
    (44, 'MS. JENNY TAN', '2023-11-10', 'RAFT', 'draft', 'communication', 'JENNY TAN - Tangent Enterprise.pdf', 'Handling: NTF | Update: Pending; NTF to coordinate with BIR National Office | Tracker: JENNY', 'SPECIAL PROJECT 2026.xlsx'),
    (45, 'LUZ YAP', '2023-08-22', 'Extra-judicial settlement of the estate', 'pending', 'pleading_major', 'LUZ YAP - EJS SAN JUAN.pdf', 'Handling: MLM | Tracker: LUZ YAP', 'SPECIAL PROJECT 2026.xlsx'),
    (46, 'HEIRS OF MANUEL YAP', '2023-05-22', 'Extra-judicial settlement of the estate', 'draft', 'pleading_major', 'Engagement Proposal-Manuel Yap Estate copy copy.pdf', 'Handling: MLM | Update: Pending; NTF to provide draft report on BIR''s findings | Tracker: MANUEL', 'SPECIAL PROJECT 2026.xlsx'),
    (47, 'MS. JULIE TAN', '2023-02-16', 'Processing of Title Transfer', 'pending', 'pleading_major', 'JULIE TAN - PROCESSING OF TITLE TRANSFER_rotated.pdf', 'Handling: NTF | Update: DONE | Tracker: JULIE TAN | Remarks: DONE', 'SPECIAL PROJECT 2026.xlsx'),
    (48, 'MS. JULIE TAN', '2022-05-18', 'Negotiation and Documentation', 'pending', 'communication', 'JULIE TAN - Negotiation and Documentation.pdf', 'Handling: NTF | Update: DONE | Tracker: JULIE | Remarks: DONE', 'SPECIAL PROJECT 2026.xlsx'),
    (49, 'UNION MOTORS CORP.', '2021-05-06', 'Legal Advisory and Contract Drafting', 'pending', 'pleading_major', 'UMC - LEGAL ADVISORY AND CONTRACT DRAFTING.pdf', 'Handling: NTF | Tracker: UMC', 'SPECIAL PROJECT 2026.xlsx'),
    (50, 'UNION MOTORS CORP.', '2021-04-19', 'Title and Corporate Due Diligence', 'pending', 'pleading_major', 'UNION MOTORS CORP. - Title and Corporate Due Diligence.pdf', 'Handling: NTF | Tracker: UMC II', 'SPECIAL PROJECT 2026.xlsx'),
    (51, 'UNION MOTORS CORP.', '2021-04-19', 'Documentation and Transfer of Title ( A real property covered by TCT No. 001-2016002143 registered under the name of Winston Fabrikoid)', 'pending', 'pleading_major', 'UMC - DOCUMENTATION AND TRASFER OF TITLE.pdf', 'Handling: NTF | Update: Done | Tracker: UMC III', 'SPECIAL PROJECT 2026.xlsx'),
    (52, 'UNION MOTORS CORP.', '2021-03-22', 'Documentation and Transfer of Titles (Quezon City Properties)', 'pending', 'pleading_major', 'UNION MOTORS CORP. - Documentation and Transfer of Titles.pdf', 'Handling: NTF | Tracker: UMC IV', 'SPECIAL PROJECT 2026.xlsx'),
    (53, 'UNION MOTORS CORP.', '2021-03-22', 'Due Diligence', 'pending', 'pleading_major', 'UNION MOTORS CORP. - Due Diligence.pdf', 'Handling: NTF | Tracker: UMC V', 'SPECIAL PROJECT 2026.xlsx')
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
  select distinct s.client_name, 'special_project', 'active', a.actor_id
  from source_rows s
  cross join actor a
  where not exists (
    select 1
    from public.accounts x
    where public.norm_key(x.title) = public.norm_key(s.client_name)
      and lower(trim(coalesce(x.category, ''))) = 'special_project'
  )
  returning id
),
target_accounts as (
  select a.id, a.title
  from public.accounts a
  where lower(trim(coalesce(a.category, ''))) = 'special_project'
    and public.norm_key(a.title) in (select public.norm_key(client_name) from source_rows)
),
ensure_members as (
  insert into public.account_members (account_id, user_id)
  select ta.id, a.actor_id
  from target_accounts ta
  cross join actor a
  where not exists (
    select 1 from public.account_members am where am.account_id = ta.id and am.user_id = a.actor_id
  )
  returning account_id
),
resolved as (
  select
    s.row_no,
    ta.id as account_id,
    s.matter,
    s.occurred_on::date as occurred_on,
    case when s.workflow_status='draft' then 'draft' else 'pending' end as status,
    case when s.activity_type in ('appearance','pleading_major','pleading_minor','communication') then s.activity_type else 'communication' end as activity_type,
    (select actor_id from actor) as actor_id,
    (select lawyer_id from default_lawyer) as handling_lawyer_id,
    concat(
      'Special Project Tracker | Link: ', coalesce(nullif(s.engagement_link,''), '-'),
      ' | Remarks: ', coalesce(nullif(s.remarks,''), '-'),
      ' | Source: ', s.source_note
    ) as description
  from source_rows s
  join target_accounts ta on public.norm_key(ta.title) = public.norm_key(s.client_name)
),
updated as (
  update public.activities a
  set
    activity_type = r.activity_type,
    description = r.description,
    minutes = coalesce(a.minutes,0),
    status = r.status,
    billable = false,
    task_category = 'special_project',
    fee_code = null,
    amount = coalesce(a.amount,0),
    billing_status = 'non_billable',
    handling_lawyer_id = r.handling_lawyer_id,
    performed_by = coalesce(a.performed_by, r.actor_id),
    submitted_at = case when r.status='draft' then null else coalesce(a.submitted_at, now()) end,
    draft_expires_at = case when r.status='draft' then coalesce(a.draft_expires_at, now()+interval '30 minutes') else null end,
    updated_at = now()
  from resolved r
  where a.account_id = r.account_id
    and public.norm_key(a.matter) = public.norm_key(r.matter)
    and a.occurred_at::date = r.occurred_on
  returning a.id
),
inserted as (
  insert into public.activities (
    batch_id, line_no, account_id, matter, billing_status, billable,
    created_by, activity_type, performed_by, handling_lawyer_id, status,
    fee_code, task_category, amount, minutes, description, occurred_at,
    attachment_urls, submitted_at, draft_expires_at
  )
  select
    gen_random_uuid(), r.row_no, r.account_id, r.matter, 'non_billable', false,
    r.actor_id, r.activity_type, r.actor_id, r.handling_lawyer_id, r.status,
    null, 'special_project', 0::numeric, 0, r.description, (r.occurred_on::timestamptz + time '09:00'),
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
  (select count(*) from ensure_members) as memberships_created,
  (select count(*) from updated) as activities_updated,
  (select count(*) from inserted) as activities_inserted;

commit;
