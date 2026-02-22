param(
  [string]$BaseDir = "C:\Users\kevin\Documents\Work\Delloro Saulog\Retainer",
  [string]$OutFile = "sql\37_sync_retainer_monthly_ope_csv_hardened.sql"
)

$ErrorActionPreference = "Stop"

function Clean([string]$s) {
  if ($null -eq $s) { return "" }
  $x = $s -replace "[^\x20-\x7E]", " "
  $x = $x -replace "\s+", " "
  return $x.Trim()
}

function SqlQuote([string]$s) {
  if ($null -eq $s) { $s = "" }
  return "'" + ($s -replace "'", "''") + "'"
}

function ParseMoney([string]$s) {
  $x = Clean $s
  if (-not $x) { return 0.0 }
  $x = $x -replace ",", ""
  $x = $x -replace "[^0-9\.\-]", ""
  if (-not $x) { return 0.0 }
  $n = 0.0
  if ([double]::TryParse($x, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$n)) {
    return $n
  }
  return 0.0
}

function ParseDateToIso([string]$raw) {
  $d = Clean $raw
  if (-not $d -or $d -eq "-") { return "" }

  $formats = @(
    "M/d/yyyy",
    "M/dd/yyyy",
    "MM/d/yyyy",
    "MM/dd/yyyy",
    "MMM d,yyyy",
    "MMMM d,yyyy",
    "MMM dd,yyyy",
    "MMMM dd,yyyy",
    "d-MMM-yy",
    "d-MMM-yyyy",
    "yyyy-MM-dd"
  )
  foreach ($f in $formats) {
    try {
      return ([datetime]::ParseExact($d, $f, [System.Globalization.CultureInfo]::InvariantCulture)).ToString("yyyy-MM-dd")
    } catch {}
  }
  try {
    return ([datetime]::Parse($d, [System.Globalization.CultureInfo]::InvariantCulture)).ToString("yyyy-MM-dd")
  } catch {
    return ""
  }
}

function Get-Field($row, [string[]]$names) {
  foreach ($n in $names) {
    if ($row.PSObject.Properties.Name -contains $n) {
      return [string]$row.$n
    }
  }
  return ""
}

function DetectActivityType($appearance, $notary, $pleading) {
  if ($appearance -gt 0 -or $notary -gt 0) { return "appearance" }
  if ($pleading -gt 0) { return "pleading_major" }
  return "communication"
}

function ParseStatus([string]$categoryText, [string]$statusText) {
  $cat = Clean $categoryText
  $st = Clean $statusText
  $billing = "billable"
  $billable = $true

  if ($cat -match "(?i)non[- ]?billable") {
    $billing = "non_billable"
    $billable = $false
  } elseif ($cat -match "(?i)\bbilled\b") {
    $billing = "billed"
    $billable = $true
  }

  $workflow = "pending"
  if ($st -match "(?i)draft|pending|waiting") {
    $workflow = "draft"
  }

  return [pscustomobject]@{
    billing_status = $billing
    billable = $billable
    workflow_status = $workflow
  }
}

function ParseMonthlyOpeSection([string]$filePath) {
  $fileName = [System.IO.Path]::GetFileName($filePath)
  $lines = Get-Content -Path $filePath
  $headerIdx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ((Clean $lines[$i]).ToUpperInvariant().StartsWith("DATE,CLIENT,PARTICULAR,ASSIGNED STAFF")) {
      $headerIdx = $i
      break
    }
  }
  if ($headerIdx -lt 0) { return @() }

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
    $dateRaw = Get-Field $r @("DATE")
    $client = Clean (Get-Field $r @("CLIENT", "CLIENTS", "COMPANY"))
    $matter = Clean (Get-Field $r @("PARTICULAR"))

    $dateIso = ParseDateToIso $dateRaw
    if (-not $dateIso -or -not $client -or -not $matter) { continue }
    if ($client -match "(?i)^total amount$") { continue }
    if ($matter -match "(?i)^total amount$") { continue }

    $assigned = Clean (Get-Field $r @("ASSIGNED STAFF", "ASSIGNED STAFF/ATTENDEES"))
    $location = Clean (Get-Field $r @("LOCATION"))
    $category = Clean (Get-Field $r @("CATEGORY", "STATUS"))
    $statusText = Clean (Get-Field $r @("STATUS"))
    $handling = Clean (Get-Field $r @("HANDLING LAWYER"))
    $invoice = Clean (Get-Field $r @("INVOICE No.", "INVOICE No", "INVOICE NO.", "INVOICE"))

    $reimb = ParseMoney (Get-Field $r @("REIMBURSEMENT"))
    $appearance = ParseMoney (Get-Field $r @("APPEARANCE"))
    $notary = ParseMoney (Get-Field $r @("NOTARY"))
    $printing = ParseMoney (Get-Field $r @("PRINTING"))
    $envelope = ParseMoney (Get-Field $r @("ENVELOPE"))
    $pleading = ParseMoney (Get-Field $r @("PLEADING"))
    $lbc = ParseMoney (Get-Field $r @("LBC", "LBC "))
    $transpo = ParseMoney (Get-Field $r @("TRANSPO"))
    $manhour = ParseMoney (Get-Field $r @("MAN HOUR"))
    $subtotal = ParseMoney (Get-Field $r @("OPE SUBTOTAL"))

    $sum = $reimb + $appearance + $notary + $printing + $envelope + $pleading + $lbc + $transpo + $manhour
    $amount = if ($subtotal -gt 0) { $subtotal } else { $sum }

    if ($amount -le 0 -and -not $invoice -and -not $assigned -and -not $handling) { continue }

    $status = ParseStatus $category $statusText
    $activityType = DetectActivityType $appearance $notary $pleading

    $sourceNote = @("Source File: $fileName")
    if ($assigned) { $sourceNote += ("Assignee: " + $assigned) }
    if ($location) { $sourceNote += ("Location: " + $location) }
    if ($handling) { $sourceNote += ("Handling: " + $handling) }

    $out += [pscustomobject]@{
      row_no = 0
      source_row_no = $sourceRowNo
      source_file = $fileName
      client_name = $client
      occurred_on = $dateIso
      matter = $matter
      billing_status = $status.billing_status
      billable = $status.billable
      workflow_status = $status.workflow_status
      invoice_no = $invoice
      performed_by_name = $assigned
      handling_name = $handling
      amount = [math]::Round($amount, 2)
      activity_type = $activityType
      task_category = "retainer_ope_csv"
      source_note = ($sourceNote -join " | ")
    }
  }

  return $out
}

function BuildSql([object[]]$rows) {
  $vals = @()
  foreach ($r in $rows) {
    $vals += "    (" +
      $r.row_no + ", " +
      $r.source_row_no + ", " +
      (SqlQuote $r.source_file) + ", " +
      (SqlQuote $r.client_name) + ", " +
      (SqlQuote $r.occurred_on) + ", " +
      (SqlQuote $r.matter) + ", " +
      (SqlQuote $r.billing_status) + ", " +
      ($r.billable.ToString().ToLowerInvariant()) + ", " +
      (SqlQuote $r.workflow_status) + ", " +
      (SqlQuote $r.invoice_no) + ", " +
      (SqlQuote $r.performed_by_name) + ", " +
      (SqlQuote $r.handling_name) + ", " +
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.amount) + ", " +
      (SqlQuote $r.activity_type) + ", " +
      (SqlQuote $r.task_category) + ", " +
      (SqlQuote $r.source_note) +
      ")"
  }
  $valuesBlock = ($vals -join ",`r`n")

  return @"
-- STEP 37: Sync retainer monthly OPE rows from CSV (hardened: legacy key + safe rerun)
-- Source: $BaseDir\DSLAW RETAINER2026 - *.csv (OPE detail sections only)
-- Parsed rows: $($rows.Count)
-- Safe to re-run.

create extension if not exists pgcrypto;

begin;

with source_rows (
  row_no,
  source_row_no,
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
  insert into public.accounts (title, category, status, created_by, account_kind, is_archived)
  select distinct
    s.client_name,
    'retainer',
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
    s.source_row_no,
    s.source_file,
    ta.id as account_id,
    s.client_name,
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
    s.task_category,
    concat(
      'retope:',
      s.occurred_on, ':',
      public.norm_key(s.client_name), ':',
      public.norm_key(s.matter), ':',
      lower(trim(coalesce(s.invoice_no,''))), ':',
      lower(trim(coalesce(s.performed_by_name,''))), ':',
      lower(trim(coalesce(s.handling_name,''))), ':',
      lower(trim(coalesce(s.activity_type,''))), ':',
      lower(trim(coalesce(s.billing_status,''))), ':',
      case when s.billable then '1' else '0' end, ':',
      trim(to_char(coalesce(s.amount,0::numeric), 'FM999999999999990.00'))
    ) as legacy_identifier_text
  from source_rows s
  join target_accounts ta on public.norm_key(ta.title) = public.norm_key(s.client_name)
),
backfilled_legacy as (
  update public.activities a
  set
    legacy_identifier_text = r.legacy_identifier_text,
    updated_at = now()
  from resolved r
  where nullif(trim(coalesce(a.legacy_identifier_text,'')), '') is null
    and a.account_id = r.account_id
    and public.norm_key(a.matter) = public.norm_key(r.matter)
    and a.occurred_at::date = r.occurred_on
    and lower(trim(coalesce(a.task_category,''))) = lower(trim(coalesce(r.task_category,'')))
    and coalesce(a.amount, 0::numeric) = coalesce(r.amount, 0::numeric)
    and lower(coalesce(a.description,'')) like ('%| source: ' || lower(r.source_file) || '%')
  returning a.id
),
inserted as (
  insert into public.activities (
    batch_id, line_no, account_id, matter, billing_status, billable,
    created_by, activity_type, performed_by, handling_lawyer_id, status,
    fee_code, task_category, amount, minutes, description, occurred_at,
    attachment_urls, submitted_at, draft_expires_at, legacy_identifier_text
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
    case when r.status='draft' then now()+interval '30 minutes' else null end,
    r.legacy_identifier_text
  from resolved r
  where not exists (
    select 1 from public.activities a
    where lower(trim(coalesce(a.legacy_identifier_text,''))) = lower(trim(coalesce(r.legacy_identifier_text,'')))
  )
  and not exists (
    select 1 from public.activities a
    where a.account_id = r.account_id
      and public.norm_key(a.matter) = public.norm_key(r.matter)
      and a.occurred_at::date = r.occurred_on
      and lower(trim(coalesce(a.task_category,''))) = lower(trim(coalesce(r.task_category,'')))
      and coalesce(a.amount, 0::numeric) = coalesce(r.amount, 0::numeric)
      and lower(coalesce(a.description,'')) like ('%| source: ' || lower(r.source_file) || '%')
  )
  returning id
)
select
  (select count(*) from source_rows) as source_rows_count,
  (select count(*) from ensure_accounts) as accounts_created,
  (select count(*) from backfilled_legacy) as legacy_keys_backfilled,
  (select count(*) from inserted) as activities_inserted;

commit;
"@
}

$allCsv = Get-ChildItem -Path $BaseDir -Filter "DSLAW RETAINER2026 - *.csv" -File

$monthlyFiles = $allCsv | Where-Object {
  $_.Name -notmatch "BACKLOG BREAKDOWN 2025|SUMMARY LIST|SUMMARY COLLECTION"
}
$targets = @($monthlyFiles)

$rows = @()
foreach ($f in $targets) {
  $rows += ParseMonthlyOpeSection $f.FullName
}

$rows = $rows |
  Where-Object { $_.client_name -and $_.matter -and $_.occurred_on } |
  Sort-Object source_file, source_row_no |
  Group-Object {
    $amountKey = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$_.amount)
    @(
      (Clean $_.client_name).ToLowerInvariant()
      $_.occurred_on
      (Clean $_.matter).ToLowerInvariant()
      (Clean $_.invoice_no).ToLowerInvariant()
      (Clean $_.performed_by_name).ToLowerInvariant()
      (Clean $_.handling_name).ToLowerInvariant()
      (Clean $_.activity_type).ToLowerInvariant()
      (Clean $_.billing_status).ToLowerInvariant()
      $(if ($_.billable) { "1" } else { "0" })
      $amountKey
    ) -join "|"
  } |
  ForEach-Object { $_.Group | Sort-Object source_file, source_row_no | Select-Object -First 1 }

$i = 1
foreach ($r in $rows) {
  $r.row_no = $i
  $i++
}

$sql = BuildSql $rows
Set-Content -Path $OutFile -Value $sql -Encoding UTF8

Write-Output ("MONTHLY_ROWS=" + $rows.Count)
Write-Output ("OUT_FILE=" + $OutFile)
