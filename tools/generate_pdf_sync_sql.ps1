$ErrorActionPreference = "Stop"

function Clean([string]$s) {
  if ($null -eq $s) { return "" }
  $x = $s -replace "[^\x20-\x7E]", " "
  $x = $x -replace "\s+", " "
  return $x.Trim()
}

function ParseDateToIso([string]$d) {
  $d = Clean $d
  if ([string]::IsNullOrWhiteSpace($d)) { return "" }
  $d = $d -replace "\s*,\s*", ","
  $d = $d -replace "\bSept\b", "Sep"

  $formats = @(
    "MMM d,yyyy",
    "MMMM d,yyyy",
    "d-MMM-yy",
    "d-MMM-yyyy"
  )
  foreach ($f in $formats) {
    try {
      return ([datetime]::ParseExact($d, $f, [System.Globalization.CultureInfo]::InvariantCulture)).ToString("yyyy-MM-dd")
    } catch {}
  }
  return ""
}

function SqlQuote([string]$s) {
  if ($null -eq $s) { $s = "" }
  return "'" + ($s -replace "'", "''") + "'"
}

function DetectRetainerActivityType([string]$matter) {
  $m = ""
  if ($null -ne $matter) { $m = $matter.ToLowerInvariant() }
  if ($m -match "notary|notarized|meeting held|appearance") { return "appearance" }
  if ($m -match "draft|review|legal|opinion|memorandum|petition|due diligence|title transfer") { return "pleading_major" }
  return "communication"
}

function Parse-RetainerRows([string]$path) {
  $lines = Get-Content $path
  $rows = @()
  $currentClient = ""
  $prevNonEmpty = ""

  $dateRegex = [regex]"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}\b"

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = Clean $lines[$i]
    if ([string]::IsNullOrWhiteSpace($ln)) { continue }

    if ($ln -match "^\s*(\d+)\s+(.+)$") {
      $rest = Clean $matches[2]
      $md = $dateRegex.Match($rest)
      if ($md.Success) {
        $candidate = Clean $rest.Substring(0, $md.Index)
        $candidate = Clean ($candidate -replace "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$", "")
        if ($candidate) { $currentClient = $candidate }
      } else {
        $candidate = Clean ($rest -replace "\s+(DRAFT|DONE|COMPLETED)\b.*$", "")
        $candidate = Clean ($candidate -replace "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$", "")
        if ($candidate) { $currentClient = $candidate }
      }
    }

    $m = $dateRegex.Match($ln)
    if (-not $m.Success) {
      $prevNonEmpty = $ln
      continue
    }

    $dateIso = ParseDateToIso $m.Value
    if (-not $dateIso) {
      $prevNonEmpty = $ln
      continue
    }

    $next1 = ""
    $next2 = ""
    if ($i + 1 -lt $lines.Count) { $next1 = Clean $lines[$i + 1] }
    if ($i + 2 -lt $lines.Count) { $next2 = Clean $lines[$i + 2] }

    $matter = Clean $ln.Substring($m.Index + $m.Length)
    if (-not $matter) {
      if ($prevNonEmpty -and -not ($prevNonEmpty -match "^\d+\s")) {
        $matter = $prevNonEmpty
      } elseif ($next1 -and -not ($next1 -match "^(Billable|Non-Billable|Billed)\b")) {
        $matter = $next1
      } else {
        $matter = "Retainer backlog entry"
      }
    }

    $statusBlob = $ln
    $billingStatus = "billable"
    if ($ln -match "(?i)Non-Billable") {
      $billingStatus = "non_billable"
    } elseif ($ln -match "(?i)\bBilled\b") {
      $billingStatus = "billed"
    }

    $wfStatus = "pending"
    if ((Clean ($ln + " " + $next1 + " " + $next2)) -match "(?i)\bDRAFT\b") { $wfStatus = "draft" }

    $invoice = ""
    $invMatch = [regex]::Match((Clean ($ln + " " + $next1 + " " + $next2)), "\bINV-\d{3,5}\b|\b[0-9A-Z]{1,15}PENALTY\b")
    if ($invMatch.Success) { $invoice = $invMatch.Value }

    # OCR layout makes amount extraction unreliable; keep amount neutral for sync rows.
    $amount = 0.0

    if (-not $currentClient) { $currentClient = "RETAINER CLIENT" }

    $rows += [pscustomobject]@{
      row_no        = ($rows.Count + 1)
      client_name   = Clean $currentClient
      occurred_on   = $dateIso
      matter        = $matter
      billing_status= $billingStatus
      billable      = ($billingStatus -ne "non_billable")
      wf_status     = $wfStatus
      invoice_no    = $invoice
      source_note   = "DSLAW RETAINER2026 - BACKLOG BREAKDOWN 2025.pdf"
      amount        = [math]::Round($amount, 2)
      activity_type = DetectRetainerActivityType $matter
    }

    $prevNonEmpty = $ln
  }

  $dedup = $rows | Group-Object { $_.client_name.ToLower() + "|" + $_.occurred_on + "|" + $_.matter.ToLower() } | ForEach-Object { $_.Group[0] }
  $index = 1
  foreach ($r in $dedup) { $r.row_no = $index; $index++ }
  return $dedup
}

function Parse-SpecialRows([string]$path) {
  $all = Get-Content $path
  $cut = ($all | Select-String -Pattern "LITIGATION CASES" -SimpleMatch | Select-Object -First 1).LineNumber
  if (-not $cut) { $cut = $all.Count + 1 }
  $lines = $all[0..($cut - 2)]

  $markers = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = Clean $lines[$i]
    if ($ln -match "^\s*(\d{1,2})\s+") {
      $seq = [int]$matches[1]
      $markers += [pscustomobject]@{ idx = $i; seq = $seq }
    }
  }

  $rows = @()
  for ($k = 0; $k -lt $markers.Count; $k++) {
    $start = 0
    if ($k -gt 0) { $start = $markers[$k - 1].idx + 1 }
    $end = $markers[$k].idx
    $seq = $markers[$k].seq

    $block = @()
    for ($j = $start; $j -le $end; $j++) {
      $x = Clean $lines[$j]
      if ($x) { $block += $x }
    }
    if ($block.Count -eq 0) { continue }

    $dateIso = ""
    foreach ($b in $block) {
      $dm = [regex]::Match($b, "\b\d{1,2}-[A-Za-z]{3}-\d{2,4}\b")
      if ($dm.Success) {
        $dateIso = ParseDateToIso $dm.Value
        break
      }
    }
    if (-not $dateIso) {
      $dateIso = (Get-Date "2025-01-01").AddDays($seq - 1).ToString("yyyy-MM-dd")
    }

    $clientCandidates = @()
    foreach ($b in $block) {
      if ($b -match "\.(pdf|docx)\b") { continue }
      if ($b -match "\b(Seq\.|Engagement|Handling|Lawyer|TRACKER|REMARKS|UPDATE|LINK|DATE OF)\b") { continue }
      if ($b -match "\b\d{1,2}-[A-Za-z]{3}-\d{2,4}\b") { continue }
      if ($b -match "(?i)\b(pending|done|completed|waiting|for billing|draft)\b") { continue }
      $letters = ($b.ToCharArray() | Where-Object { [char]::IsLetter($_) } | Measure-Object).Count
      if ($letters -eq 0) { continue }
      $uppers = ($b.ToCharArray() | Where-Object { [char]::IsUpper($_) } | Measure-Object).Count
      $ratio = [double]$uppers / [double]$letters
      if ($ratio -ge 0.55 -and $b -notmatch "\d" -and $b.Length -le 60 -and $b -notmatch "(?i)\b(NTF|MVB|MLM|INV|EP|SEQ)\b") {
        $clientCandidates += $b
      }
    }
    if ($clientCandidates.Count -eq 0) { continue }
    $client = $clientCandidates[0]

    $matter = ""
    foreach ($b in $block) {
      if ($b -eq $client) { continue }
      if ($b -match "\.(pdf|docx)\b") { continue }
      if ($b -match "\b\d{1,2}-[A-Za-z]{3}-\d{2,4}\b") { continue }
      if ($b -match "(?i)\b(pending|done|completed|waiting|for billing|draft)\b") { continue }
      if ($b.Length -ge 6) { $matter = $b; break }
    }
    if (-not $matter) { $matter = "Special project seq $seq" }

    $link = ""
    foreach ($b in $block) {
      $lm = [regex]::Match($b, "[A-Za-z0-9 _\-\.\(\)]+\.(pdf|docx)")
      if ($lm.Success) { $link = Clean $lm.Value; break }
    }

    $remark = ""
    foreach ($b in $block) {
      if ($b -match "(?i)\b(pending|done|completed|waiting|for billing|draft)\b") {
        $remark = $b
        break
      }
    }

    $wfStatus = "pending"
    if ($remark -match "(?i)\b(pending|waiting|draft)\b") { $wfStatus = "draft" }

    $activityType = "communication"
    if ($matter -match "(?i)due diligence|review|legal|opinion|incorporation|transfer|sec|bir|petition|title") {
      $activityType = "pleading_major"
    }

    $rows += [pscustomobject]@{
      row_no        = ($rows.Count + 1)
      client_name   = Clean $client
      occurred_on   = $dateIso
      matter        = Clean $matter
      wf_status     = $wfStatus
      activity_type = $activityType
      engagement_link = $link
      remarks       = Clean $remark
      source_note   = "SPECIAL PROJECT 2026 - SUMMARY.pdf"
    }
  }

  $rows = $rows | Where-Object {
    $_.client_name -notin @("MERCADO", "GIBIS BAKESHOP", "CABREBALD HOLDINGS INC.") -and
    $_.matter.Length -ge 5 -and
    $_.client_name -notmatch "^\d" -and
    $_.client_name -notmatch "(?i)\b(NTF|MVB|MLM|INV|EP|SEQ|SPECIAL PROJECT)\b" -and
    $_.matter -notmatch "(?i)^Special project seq"
  }
  $rows = $rows | Group-Object { $_.client_name.ToLower() + "|" + $_.occurred_on + "|" + $_.matter.ToLower() } | ForEach-Object { $_.Group[0] }
  $i = 1
  foreach ($r in $rows) { $r.row_no = $i; $i++ }
  return $rows
}

function Build-Sql11([object[]]$rows) {
  $vals = @()
  foreach ($r in $rows) {
    $vals += "    (" + $r.row_no + ", " + (SqlQuote $r.client_name) + ", " + (SqlQuote $r.occurred_on) + ", " + (SqlQuote $r.matter) + ", " + (SqlQuote $r.billing_status) + ", " + ($r.billable.ToString().ToLowerInvariant()) + ", " + (SqlQuote $r.wf_status) + ", " + (SqlQuote $r.invoice_no) + ", " + (SqlQuote $r.source_note) + ", " + [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.amount) + ", " + (SqlQuote $r.activity_type) + ")"
  }
  $valuesBlock = ($vals -join ",`r`n")

  return @"
-- STEP 11: Sync retainer backlog rows into activities (update + insert)
-- Source: C:\Users\kevin\Documents\Work\Delloro Saulog\DSLAW RETAINER2026 - BACKLOG BREAKDOWN 2025.pdf
-- Parsed rows: $($rows.Count)
-- Safe to re-run.

create extension if not exists pgcrypto;

begin;

with source_rows (
  row_no,
  client_name,
  occurred_on,
  matter,
  billing_status,
  billable,
  workflow_status,
  invoice_no,
  source_note,
  amount,
  activity_type
) as (
  values
$valuesBlock
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
    select 1 from public.accounts x where lower(trim(coalesce(x.title,''))) = lower(trim(s.client_name))
  )
  returning id
),
target_accounts as (
  select a.id, a.title
  from public.accounts a
  where lower(trim(coalesce(a.title,''))) in (select lower(trim(client_name)) from source_rows)
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
    s.billing_status,
    s.billable,
    case when s.workflow_status='draft' then 'draft' else 'pending' end as status,
    s.invoice_no,
    s.source_note,
    greatest(coalesce(s.amount,0::numeric),0::numeric) as amount,
    (select actor_id from actor) as actor_id,
    (select lawyer_id from default_lawyer) as handling_lawyer_id,
    case when s.activity_type in ('appearance','pleading_major','pleading_minor','communication') then s.activity_type else 'communication' end as activity_type,
    'retainer_backlog' as task_category,
    case when lower(s.matter) like '%notary%' then 'NF' else null end as fee_code,
    concat(
      'Retainer Backlog | Invoice: ', coalesce(nullif(s.invoice_no,''), '-'),
      ' | Source: ', s.source_note
    ) as description
  from source_rows s
  join target_accounts ta on lower(trim(ta.title)) = lower(trim(s.client_name))
),
updated as (
  update public.activities a
  set
    activity_type = r.activity_type,
    description = r.description,
    minutes = coalesce(a.minutes,0),
    status = r.status,
    billable = r.billable,
    task_category = r.task_category,
    fee_code = r.fee_code,
    amount = r.amount,
    billing_status = r.billing_status,
    handling_lawyer_id = r.handling_lawyer_id,
    performed_by = coalesce(a.performed_by, r.actor_id),
    submitted_at = case when r.status='draft' then null else coalesce(a.submitted_at, now()) end,
    draft_expires_at = case when r.status='draft' then coalesce(a.draft_expires_at, now()+interval '30 minutes') else null end,
    updated_at = now()
  from resolved r
  where a.account_id = r.account_id
    and lower(trim(coalesce(a.matter,''))) = lower(trim(coalesce(r.matter,'')))
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
    gen_random_uuid(), r.row_no, r.account_id, r.matter, r.billing_status, r.billable,
    r.actor_id, r.activity_type, r.actor_id, r.handling_lawyer_id, r.status,
    r.fee_code, r.task_category, r.amount, 0, r.description, (r.occurred_on::timestamptz + time '09:00'),
    null,
    case when r.status='draft' then null else now() end,
    case when r.status='draft' then now()+interval '30 minutes' else null end
  from resolved r
  where not exists (
    select 1 from public.activities a
    where a.account_id = r.account_id
      and lower(trim(coalesce(a.matter,''))) = lower(trim(coalesce(r.matter,'')))
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
"@
}

function Build-Sql12([object[]]$rows) {
  $vals = @()
  foreach ($r in $rows) {
    $vals += "    (" + $r.row_no + ", " + (SqlQuote $r.client_name) + ", " + (SqlQuote $r.occurred_on) + ", " + (SqlQuote $r.matter) + ", " + (SqlQuote $r.wf_status) + ", " + (SqlQuote $r.activity_type) + ", " + (SqlQuote $r.engagement_link) + ", " + (SqlQuote $r.remarks) + ", " + (SqlQuote $r.source_note) + ")"
  }
  $valuesBlock = ($vals -join ",`r`n")

  return @"
-- STEP 12: Sync special project tracker rows into activities (update + insert)
-- Source: C:\Users\kevin\Documents\Work\Delloro Saulog\SPECIAL PROJECT 2026 - SUMMARY.pdf
-- Parsed rows: $($rows.Count)
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
$valuesBlock
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
    select 1 from public.accounts x where lower(trim(coalesce(x.title,''))) = lower(trim(s.client_name))
  )
  returning id
),
target_accounts as (
  select a.id, a.title
  from public.accounts a
  where lower(trim(coalesce(a.title,''))) in (select lower(trim(client_name)) from source_rows)
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
  join target_accounts ta on lower(trim(ta.title)) = lower(trim(s.client_name))
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
    and lower(trim(coalesce(a.matter,''))) = lower(trim(coalesce(r.matter,'')))
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
      and lower(trim(coalesce(a.matter,''))) = lower(trim(coalesce(r.matter,'')))
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
"@
}

$root = Split-Path -Parent $PSScriptRoot
$retRows = Parse-RetainerRows (Join-Path $root "tmp_retainer.txt")
$spRows = Parse-SpecialRows (Join-Path $root "tmp_special_project.txt")

$sql11 = Build-Sql11 $retRows
$sql12 = Build-Sql12 $spRows

Set-Content -Path (Join-Path $root "sql\\11_sync_retainer_backlog_rows.sql") -Value $sql11 -Encoding UTF8
Set-Content -Path (Join-Path $root "sql\\12_sync_special_project_rows.sql") -Value $sql12 -Encoding UTF8

Write-Output ("RET_ROWS=" + $retRows.Count)
Write-Output ("SP_ROWS=" + $spRows.Count)
