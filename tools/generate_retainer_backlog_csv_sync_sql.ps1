param(
  [string]$SourceFile = "C:\Users\kevin\Documents\Work\Delloro Saulog\Retainer\DSLAW RETAINER2026 - BACKLOG BREAKDOWN 2025.csv",
  [string]$OutFile = "sql\45_sync_retainer_backlog_rows_hardened.sql"
)

$ErrorActionPreference = "Stop"

function Clean([string]$s) {
  if ($null -eq $s) { return "" }
  $x = $s -replace "[^\x20-\x7E]", " "
  $x = $x -replace "\s+", " "
  return $x.Trim()
}

function SqlQuote([string]$s) {
  if ($null -eq $s) { return "''" }
  return "'" + ($s -replace "'", "''") + "'"
}

function SqlNullable([string]$s) {
  $x = Clean $s
  if (-not $x) { return "null" }
  return SqlQuote $x
}

function ParseMoney([string]$s) {
  $x = Clean $s
  if (-not $x) { return 0.0 }
  $x = $x -replace ",", ""
  $x = $x -replace "[^0-9\.\-]", ""
  if (-not $x) { return 0.0 }
  $n = 0.0
  if ([double]::TryParse($x, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$n)) {
    return [math]::Round($n, 2)
  }
  return 0.0
}

function ParseDateToIso([string]$raw) {
  $d = Clean $raw
  if (-not $d -or $d -eq "-") { return "" }
  $d = ($d -replace '^(?i)Sept\b', 'Sep')
  $formats = @(
    "MMM d,yyyy",
    "MMM dd,yyyy",
    "MMMM d,yyyy",
    "MMMM dd,yyyy",
    "M/d/yyyy",
    "MM/dd/yyyy",
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

function NormalizeBillingStatus([string]$raw) {
  $x = (Clean $raw).ToLowerInvariant()
  switch -Regex ($x) {
    '^billable$' { return [pscustomobject]@{ billing_status='billable'; billable=$true } }
    '^billed$' { return [pscustomobject]@{ billing_status='billed'; billable=$true } }
    'non[\s\-]?billable' { return [pscustomobject]@{ billing_status='non_billable'; billable=$false } }
    default {
      return [pscustomobject]@{ billing_status='billable'; billable=$true }
    }
  }
}

function Ensure-Length([string[]]$arr, [int]$len) {
  if ($arr.Length -ge $len) { return $arr }
  $out = New-Object string[] $len
  for ($i = 0; $i -lt $len; $i++) {
    if ($i -lt $arr.Length) { $out[$i] = [string]$arr[$i] } else { $out[$i] = "" }
  }
  return $out
}

function ParseBacklogCsv([string]$filePath) {
  if (-not (Test-Path $filePath)) { throw "Source file not found: $filePath" }

  Add-Type -AssemblyName Microsoft.VisualBasic
  $tf = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($filePath)
  $tf.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
  $tf.SetDelimiters(",")
  $tf.HasFieldsEnclosedInQuotes = $true
  $tf.TrimWhiteSpace = $false

  try {
    if ($tf.EndOfData) { throw "Backlog CSV is empty: $filePath" }
    $header = Ensure-Length ($tf.ReadFields()) 33
    $header0 = Clean $header[0]
    $header1 = Clean $header[1]
    if ($header0 -ne "x" -or $header1 -notmatch 'CLIENT') {
      throw "Unexpected backlog CSV header. Expected x,CLIENT,... in $filePath"
    }

    $fileName = [System.IO.Path]::GetFileName($filePath)
    $rows = @()
    $currentClient = ""
    $lineNo = 1

    while (-not $tf.EndOfData) {
      $lineNo++
      $f = Ensure-Length ($tf.ReadFields()) 33

      $colX = Clean $f[0]
      $colClient = Clean $f[1]
      $colDate = Clean $f[2]
      $colParticular = Clean $f[3]
      $colAssignee = Clean $f[4]
      $colLocation = Clean $f[5]
      $colBilling = Clean $f[6]
      $colHandling = Clean $f[7]
      $colStatus2 = Clean $f[19]

      if ($colX -match '^\d+$' -and $colClient) { $currentClient = $colClient }

      $occurredOn = ParseDateToIso $colDate
      if (-not $occurredOn) { continue }
      if (-not $currentClient) { continue }
      if (-not $colParticular) { continue }
      if (-not $colBilling) { continue }

      $appearanceAmt = ParseMoney $f[8]
      $notaryAmt = ParseMoney $f[9]
      $printingAmt = ParseMoney $f[10]
      $envelopeAmt = ParseMoney $f[11]
      $pleadingAmt = ParseMoney $f[12]
      $lbcAmt = ParseMoney $f[13]
      $transpoAmt = ParseMoney $f[14]
      $manHourAmt = ParseMoney $f[15]
      $subtotalAmt = ParseMoney $f[16]
      $totalAmt = ParseMoney $f[17]
      $invoiceNo = Clean $f[18]

      $billing = NormalizeBillingStatus $colBilling
      $workflowStatus = if ($colStatus2 -match '(?i)^draft$') { 'draft' } else { 'pending' }

      # Backlog import historically used SUBTOTAL (per-line amount), not TOTAL AMOUNT (group running total).
      $amount = $subtotalAmt
      if ($amount -lt 0) { $amount = 0.0 }

      $matterLower = $colParticular.ToLowerInvariant()
      $activityType = 'communication'
      if ($matterLower -match '(pick\s*up|pickup|transmit|tranmit|transmitted|lalamove|grab|lbc|email|e-mail|inquiry|request|review|drafting)') {
        $activityType = 'communication'
      } elseif ($pleadingAmt -gt 0) {
        $activityType = 'pleading_major'
      } elseif ($matterLower -match 'notar|meeting') {
        $activityType = 'appearance'
      } elseif ($appearanceAmt -gt 0 -or $notaryAmt -gt 0 -or $manHourAmt -gt 0) {
        $activityType = 'appearance'
      }

      $noteParts = @("Source File: $fileName")
      if ($colAssignee) { $noteParts += "Assignee: $colAssignee" }
      if ($colLocation) { $noteParts += "Location: $colLocation" }
      if ($colHandling) { $noteParts += "Handling: $colHandling" }
      $sourceNote = ($noteParts -join " | ")

      $rows += [pscustomobject]@{
        row_no = 0
        source_row_no = $lineNo
        source_file = $fileName
        client_name = $currentClient
        occurred_on = $occurredOn
        matter = $colParticular
        billing_status = $billing.billing_status
        billable = [bool]$billing.billable
        workflow_status = $workflowStatus
        invoice_no = $invoiceNo
        performed_by_name = $colAssignee
        handling_name = $colHandling
        source_note = $sourceNote
        amount = [math]::Round([double]$amount, 2)
        activity_type = $activityType
      }
    }

    return $rows
  } finally {
    $tf.Close()
  }
}

function BuildSql([object[]]$rows, [string]$sourcePathText) {
  if (-not $rows -or $rows.Count -eq 0) { throw "No valid backlog rows parsed." }

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
      (SqlQuote $r.source_note) + ", " +
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.amount) + ", " +
      (SqlQuote $r.activity_type) +
      ")"
  }

  $valuesBlock = $vals -join ",`r`n"

  return @"
-- STEP 45: Sync retainer backlog rows into activities (hardened: legacy key + current schema)
-- Source: $sourcePathText
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
    select 1
    from public.accounts x
    where public.norm_key(x.title) = public.norm_key(s.client_name)
      and lower(trim(coalesce(x.category, ''))) = 'retainer'
  )
  returning id
),
target_accounts as (
  select a.id, a.title
  from public.accounts a
  where lower(trim(coalesce(a.category, ''))) = 'retainer'
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
              length(regexp_replace(lower(coalesce(s.handling_name,'')), '[^a-z]', '', 'g')) between 2 and 5
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
    case when s.activity_type in ('appearance','pleading_major','pleading_minor','communication') then s.activity_type else 'communication' end as activity_type,
    'retainer_backlog' as task_category,
    case when lower(coalesce(s.matter,'')) like '%notary%' then 'NF' else null end as fee_code,
    concat(
      'Retainer Backlog | Invoice: ', coalesce(nullif(s.invoice_no,''), '-'),
      ' | Assignee: ', coalesce(nullif(s.performed_by_name,''), '-'),
      case when nullif(trim(coalesce(s.handling_name,'')), '') is not null then concat(' | Handling: ', trim(s.handling_name)) else '' end,
      case when lower(coalesce(s.source_note,'')) like '%location:%' then concat(
        ' | Location: ',
        coalesce(
          nullif(trim(coalesce(substring(s.source_note from 'Location:\s*([^|]+)'), '')), ''),
          '-'
        )
      ) else '' end,
      ' | Source: ', s.source_file
    ) as description,
    concat('retbacklog:', lower(trim(coalesce(s.source_file,''))), ':', s.source_row_no::text) as legacy_identifier_text
  from source_rows s
  join target_accounts ta on public.norm_key(ta.title) = public.norm_key(s.client_name)
),
ensure_members_actor as (
  insert into public.account_members (account_id, user_id)
  select distinct r.account_id, r.actor_id
  from resolved r
  where not exists (
    select 1 from public.account_members am where am.account_id = r.account_id and am.user_id = r.actor_id
  )
  returning account_id
),
ensure_members_lawyers as (
  insert into public.account_members (account_id, user_id)
  select distinct r.account_id, r.handling_lawyer_id
  from resolved r
  where r.handling_lawyer_id is not null
    and not exists (
      select 1 from public.account_members am where am.account_id = r.account_id and am.user_id = r.handling_lawyer_id
    )
  returning account_id
),
backfilled_legacy as (
  update public.activities a
  set
    legacy_identifier_text = r.legacy_identifier_text,
    updated_at = now()
  from resolved r
  where nullif(trim(coalesce(a.legacy_identifier_text,'')), '') is null
    and a.account_id = r.account_id
    and coalesce(a.line_no, -1) = r.row_no
    and public.norm_key(a.matter) = public.norm_key(r.matter)
    and a.occurred_at::date = r.occurred_on
    and lower(trim(coalesce(a.task_category,''))) = 'retainer_backlog'
    and coalesce(a.amount, 0::numeric) = coalesce(r.amount, 0::numeric)
    and lower(coalesce(a.description,'')) like 'retainer backlog%'
    and lower(coalesce(a.description,'')) like ('%invoice: ' || lower(coalesce(nullif(r.invoice_no,''), '-')) || '%')
  returning a.id
),
updated_activities as (
  update public.activities a
  set
    line_no = r.row_no,
    activity_type = r.activity_type,
    description = r.description,
    status = r.status,
    billable = r.billable,
    task_category = r.task_category,
    fee_code = r.fee_code,
    amount = r.amount,
    billing_status = r.billing_status,
    handling_lawyer_id = r.handling_lawyer_id,
    performed_by = coalesce(a.performed_by, r.performed_by_id),
    occurred_at = coalesce(a.occurred_at, (r.occurred_on::timestamptz + time '09:00')),
    submitted_at = case when r.status='draft' then null else coalesce(a.submitted_at, now()) end,
    draft_expires_at = case when r.status='draft' then coalesce(a.draft_expires_at, now()+interval '30 minutes') else null end,
    updated_at = now()
  from resolved r
  where lower(trim(coalesce(a.legacy_identifier_text,''))) = lower(trim(coalesce(r.legacy_identifier_text,'')))
  returning a.id
),
inserted_activities as (
  insert into public.activities (
    batch_id, line_no, account_id, matter, billing_status, billable,
    created_by, activity_type, performed_by, handling_lawyer_id, status,
    fee_code, task_category, amount, minutes, description, occurred_at,
    attachment_urls, submitted_at, draft_expires_at, legacy_identifier_text
  )
  select
    gen_random_uuid(), r.row_no, r.account_id, r.matter, r.billing_status, r.billable,
    r.actor_id, r.activity_type, r.performed_by_id, r.handling_lawyer_id, r.status,
    r.fee_code, r.task_category, r.amount, 0, r.description, (r.occurred_on::timestamptz + time '09:00'),
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
        and lower(trim(coalesce(a.task_category,''))) = 'retainer_backlog'
        and coalesce(a.amount, 0::numeric) = coalesce(r.amount, 0::numeric)
        and lower(coalesce(a.description,'')) like '%retainer backlog%'
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

$rows = ParseBacklogCsv -filePath $SourceFile
$i = 1
foreach ($r in $rows) {
  $r.row_no = $i
  $i++
}

$sql = BuildSql -rows $rows -sourcePathText $SourceFile
$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
Set-Content -Path $OutFile -Value $sql -Encoding UTF8

Write-Host "Generated $OutFile"
Write-Host ("PARSED_ROWS=" + $rows.Count)
Write-Host ("DRAFT_ROWS=" + (($rows | Where-Object { $_.workflow_status -eq 'draft' }).Count))
Write-Host ("SOURCE_FILE=" + $SourceFile)
