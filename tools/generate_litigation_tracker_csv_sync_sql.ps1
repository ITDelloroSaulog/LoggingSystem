param(
  [string]$SourceFile = "C:\Users\kevin\Documents\Work\Delloro Saulog\Litigation\LITIGATIONS SUMMARY TRACKER - LITIGATIONS.csv",
  [string]$OutFile = "sql\41_sync_litigation_tracker_csv_hardened.sql"
)

$ErrorActionPreference = "Stop"

function Clean([string]$s) {
  if ($null -eq $s) { return "" }
  $x = $s -replace "[^\x20-\x7E]", " "
  $x = $x -replace "\s+", " "
  return $x.Trim()
}

function SqlQuote([string]$s) {
  if ($null -eq $s) { return "null" }
  return "'" + ($s -replace "'", "''") + "'"
}

function SqlNullable([string]$s) {
  $x = Clean $s
  if (-not $x) { return "null" }
  return SqlQuote $x
}

function ParseLitigationCsv([string]$filePath) {
  if (-not (Test-Path $filePath)) { throw "Source file not found: $filePath" }
  $fileName = [System.IO.Path]::GetFileName($filePath)
  $lines = Get-Content -Path $filePath
  $headerIdx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = Clean $lines[$i]
    if ($line.ToUpperInvariant().StartsWith("NO.,CLIENT,CASE TITLE,VENUE")) {
      $headerIdx = $i
      break
    }
  }
  if ($headerIdx -lt 0) { throw "Could not find litigation CSV header row in $filePath" }

  $csvText = @($lines[$headerIdx]) + $lines[($headerIdx + 1)..($lines.Count - 1)]
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $tmp -Value $csvText -Encoding UTF8
    $rows = Import-Csv -Path $tmp
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }

  $out = @()
  $sourceRowNo = 0
  foreach ($r in $rows) {
    $sourceRowNo++
    $trackerNoRaw = Clean([string]$r.'NO.')
    $client = Clean([string]$r.Client)
    $caseTitle = Clean([string]$r.'Case Title')
    $venue = Clean([string]$r.Venue)
    $caseType = Clean([string]$r.'TYPES OF CASES')
    $trackerStatus = Clean([string]$r.Status)
    $handling = Clean([string]$r.'Handling Lawyer')
    $engagement = Clean([string]$r.ENGAGEMENT)
    $notes = Clean([string]$r.Notes)

    if (-not $client -or -not $caseTitle) { continue }
    $trackerNo = 0
    if (-not [int]::TryParse(($trackerNoRaw -replace "[^0-9]", ""), [ref]$trackerNo)) { continue }
    if ($trackerNo -le 0) { continue }

    $out += [pscustomobject]@{
      row_no = 0
      source_row_no = $sourceRowNo
      source_file = $fileName
      tracker_no = $trackerNo
      client_name = $client
      case_title = $caseTitle
      venue = $venue
      case_type = $caseType
      tracker_status = $trackerStatus
      handling_token = $handling
      engagement = $engagement
      notes = $notes
    }
  }

  return $out
}

function BuildSql([object[]]$rows, [string]$sourcePath) {
  $vals = @()
  foreach ($r in $rows) {
    $vals += "    (" +
      $r.row_no + ", " +
      $r.source_row_no + ", " +
      (SqlQuote $r.source_file) + ", " +
      $r.tracker_no + ", " +
      (SqlQuote $r.client_name) + ", " +
      (SqlQuote $r.case_title) + ", " +
      (SqlNullable $r.venue) + ", " +
      (SqlNullable $r.case_type) + ", " +
      (SqlNullable $r.tracker_status) + ", " +
      (SqlNullable $r.handling_token) + ", " +
      (SqlNullable $r.engagement) + ", " +
      (SqlNullable $r.notes) +
      ")"
  }
  if (-not $vals.Count) { throw "No valid litigation rows parsed." }
  $valuesBlock = $vals -join ",`r`n"

  return @"
-- STEP 41: Sync litigation tracker rows from CSV (hardened: legacy key + current schema)
-- Source: $sourcePath
-- Rows imported: $($rows.Count) (filtered to non-empty Client + Case Title)
-- Safe to re-run.

create extension if not exists pgcrypto;

begin;

with source_rows (
  row_no,
  source_row_no,
  source_file,
  tracker_no,
  client_name,
  case_title,
  venue,
  case_type,
  tracker_status,
  handling_token,
  engagement,
  notes
) as (
  values
$valuesBlock
),
actor as (
  select coalesce(
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
  select coalesce(
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
  insert into public.accounts (title, category, status, created_by, account_kind, is_archived)
  select distinct
    s.client_name,
    'litigation',
    'active',
    a.actor_id,
    case
      when upper(s.client_name) similar to '%( INC| INC\\.| CORP| CORP\\.| CORPORATION| LTD| LTD\\.| HOLDINGS| COMPANY| CO\\.)%'
        then 'company'
      else 'personal'
    end,
    false
  from source_rows s
  cross join actor a
  where not exists (
    select 1
    from public.accounts acc
    where public.norm_key(acc.title) = public.norm_key(s.client_name)
      and lower(trim(coalesce(acc.category, ''))) = 'litigation'
  )
  returning id
),
target_accounts as (
  select acc.id, acc.title
  from public.accounts acc
  where lower(trim(coalesce(acc.category, ''))) = 'litigation'
    and public.norm_key(acc.title) in (select public.norm_key(client_name) from source_rows)
),
resolved_rows as (
  select
    s.row_no,
    s.source_row_no,
    s.source_file,
    s.tracker_no,
    ta.id as account_id,
    s.client_name,
    s.case_title,
    s.venue,
    s.case_type,
    s.tracker_status,
    s.engagement,
    s.notes,
    a.actor_id,
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.email, ''))) = lower(trim(coalesce(s.handling_token, '')))
           or lower(trim(coalesce(p.full_name, ''))) = lower(trim(coalesce(s.handling_token, '')))
        order by p.created_at asc nulls last
        limit 1
      ),
      (select lawyer_id from default_lawyer)
    ) as handling_lawyer_id,
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
    (timestamptz '2025-01-01 09:00:00+08' + make_interval(days => greatest(s.tracker_no - 1, 0))) as occurred_at_seed,
    concat(
      'Venue: ', coalesce(nullif(trim(coalesce(s.venue, '')), ''), '-'),
      ' | Case Type: ', coalesce(nullif(trim(coalesce(s.case_type, '')), ''), '-'),
      ' | Tracker Status: ', coalesce(nullif(trim(coalesce(s.tracker_status, '')), ''), '-'),
      case when nullif(trim(coalesce(s.engagement, '')), '') is not null then concat(' | Engagement: ', trim(s.engagement)) else '' end,
      case when nullif(trim(coalesce(s.notes, '')), '') is not null then concat(' | Notes: ', trim(s.notes)) else '' end,
      ' | Source: ', s.source_file
    ) as description,
    concat('littrk:', lower(trim(s.source_file)), ':', s.tracker_no::text) as legacy_identifier_text
  from source_rows s
  join target_accounts ta
    on public.norm_key(ta.title) = public.norm_key(s.client_name)
  cross join actor a
),
ensure_members_actor as (
  insert into public.account_members (account_id, user_id)
  select distinct rr.account_id, rr.actor_id
  from resolved_rows rr
  where not exists (
    select 1 from public.account_members am
    where am.account_id = rr.account_id and am.user_id = rr.actor_id
  )
  returning account_id
),
ensure_members_lawyers as (
  insert into public.account_members (account_id, user_id)
  select distinct rr.account_id, rr.handling_lawyer_id
  from resolved_rows rr
  where rr.handling_lawyer_id is not null
    and not exists (
      select 1 from public.account_members am
      where am.account_id = rr.account_id and am.user_id = rr.handling_lawyer_id
    )
  returning account_id
),
backfilled_legacy as (
  update public.activities act
  set
    legacy_identifier_text = rr.legacy_identifier_text,
    updated_at = now()
  from resolved_rows rr
  where nullif(trim(coalesce(act.legacy_identifier_text, '')), '') is null
    and act.account_id = rr.account_id
    and public.norm_key(act.matter) = public.norm_key(rr.case_title)
    and coalesce(act.line_no, -1) = rr.tracker_no
    and lower(trim(coalesce(act.task_category, ''))) = lower(trim(coalesce(rr.task_category, '')))
    and lower(coalesce(act.description, '')) like '%source: litigations summary tracker%'
  returning act.id
),
updated_activities as (
  update public.activities act
  set
    line_no = rr.tracker_no,
    matter = rr.case_title,
    billing_status = rr.billing_status,
    billable = rr.billable,
    created_by = coalesce(act.created_by, rr.actor_id),
    activity_type = rr.activity_type,
    performed_by = coalesce(act.performed_by, rr.actor_id),
    handling_lawyer_id = rr.handling_lawyer_id,
    status = rr.status,
    fee_code = rr.fee_code,
    task_category = rr.task_category,
    amount = coalesce(act.amount, 0::numeric),
    minutes = coalesce(act.minutes, 0),
    description = rr.description,
    occurred_at = coalesce(act.occurred_at, rr.occurred_at_seed),
    submitted_at = case when rr.status = 'draft' then null else coalesce(act.submitted_at, now()) end,
    draft_expires_at = case when rr.status = 'draft' then coalesce(act.draft_expires_at, now() + interval '30 minutes') else null end,
    updated_at = now()
  from resolved_rows rr
  where lower(trim(coalesce(act.legacy_identifier_text, ''))) = lower(trim(rr.legacy_identifier_text))
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
    draft_expires_at,
    legacy_identifier_text
  )
  select
    gen_random_uuid(),
    rr.tracker_no,
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
    case when rr.status = 'draft' then now() + interval '30 minutes' else null end,
    rr.legacy_identifier_text
  from resolved_rows rr
  where not exists (
    select 1
    from public.activities act
    where lower(trim(coalesce(act.legacy_identifier_text, ''))) = lower(trim(rr.legacy_identifier_text))
  )
    and not exists (
      select 1
      from public.activities act
      where act.account_id = rr.account_id
        and public.norm_key(act.matter) = public.norm_key(rr.case_title)
        and coalesce(act.line_no, -1) = rr.tracker_no
        and lower(trim(coalesce(act.task_category, ''))) = lower(trim(coalesce(rr.task_category, '')))
        and lower(coalesce(act.description, '')) like '%source: litigations summary tracker%'
    )
  returning id
)
select
  (select count(*) from source_rows) as source_rows_count,
  (select count(*) from ensure_accounts) as accounts_created,
  (select count(*) from ensure_members_actor) as actor_memberships_created,
  (select count(*) from ensure_members_lawyers) as lawyer_memberships_created,
  (select count(*) from backfilled_legacy) as legacy_keys_backfilled,
  (select count(*) from updated_activities) as activities_updated,
  (select count(*) from inserted_activities) as activities_inserted;

commit;
"@
}

$rows = ParseLitigationCsv -filePath $SourceFile
$i = 1
foreach ($r in $rows) {
  $r.row_no = $i
  $i++
}

$sql = BuildSql -rows $rows -sourcePath $SourceFile
$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
Set-Content -Path $OutFile -Value $sql -Encoding UTF8

Write-Host "Generated $OutFile"
Write-Host ("ROWS=" + $rows.Count)
