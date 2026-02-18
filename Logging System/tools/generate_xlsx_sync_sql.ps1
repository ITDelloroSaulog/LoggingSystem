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

function ToNumber([string]$s) {
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

function ParseDateToIso([string]$v) {
  $d = Clean $v
  if (-not $d -or $d -eq "-") { return "" }

  if ($d -match "^\d+(\.\d+)?$") {
    try {
      return ([datetime]::FromOADate([double]$d)).ToString("yyyy-MM-dd")
    } catch {
      return ""
    }
  }

  $d = $d -replace "\s*,\s*", ","
  $d = $d -replace "\bSept\b", "Sep"

  $formats = @(
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

function Get-SharedStringText($si) {
  if ($null -eq $si) { return "" }
  $nodes = $si.SelectNodes(".//*[local-name()='t']")
  if ($nodes -and $nodes.Count -gt 0) {
    $parts = @()
    foreach ($n in $nodes) {
      $parts += [string]$n.InnerText
    }
    return ($parts -join "")
  }
  return [string]$si.InnerText
}

function Get-XlsxRows([string]$baseDir, [string]$sheetPath) {
  [xml]$sharedXml = Get-Content -Raw -Path (Join-Path $baseDir "xl/sharedStrings.xml")
  [xml]$sheetXml = Get-Content -Raw -Path (Join-Path $baseDir $sheetPath)

  $shared = @()
  if ($sharedXml.sst -and $sharedXml.sst.si) {
    foreach ($si in $sharedXml.sst.si) {
      $shared += (Get-SharedStringText $si)
    }
  }

  $rows = @()
  foreach ($row in $sheetXml.worksheet.sheetData.row) {
    $obj = [ordered]@{ Row = [int]$row.r }
    foreach ($c in $row.c) {
      $col = ([string]$c.r) -replace "\d", ""
      $val = ""
      if ($c.t -eq "s") {
        $idx = [int]$c.v
        if ($idx -ge 0 -and $idx -lt $shared.Count) {
          $val = $shared[$idx]
        }
      } elseif ($c.t -eq "inlineStr") {
        $val = Get-SharedStringText $c.is
      } else {
        $val = [string]$c.v
      }
      $obj[$col] = Clean $val
    }
    $rows += [pscustomobject]$obj
  }
  return $rows
}

function Parse-RetainerRows() {
  $rows = Get-XlsxRows "tmp_retainer_xlsx" "xl/worksheets/sheet1.xml"
  $out = @()
  $currentClient = ""

  foreach ($r in $rows) {
    if ($r.Row -le 1) { continue }

    $a = Clean $r.A
    $b = Clean $r.B
    $c = Clean $r.C
    $d = Clean $r.D
    $e = Clean $r.E
    $f = Clean $r.F
    $g = Clean $r.G
    $h = Clean $r.H
    $i = ToNumber $r.I
    $j = ToNumber $r.J
    $k = ToNumber $r.K
    $l = ToNumber $r.L
    $m = ToNumber $r.M
    $n = ToNumber $r.N
    $o = ToNumber $r.O
    $p = ToNumber $r.P
    $q = ToNumber $r.Q
    $rTotal = ToNumber $r.R
    $s = Clean $r.S
    $t = Clean $r.T

    if ($a -match "^\d+(\.\d+)?$" -and $b -and $b -notmatch "(?i)^meeting held$") {
      $currentClient = $b
    }

    $dateIso = ParseDateToIso $c
    $matter = Clean $d
    if (-not $dateIso -or -not $matter) { continue }
    if ($matter -eq "System.Xml.XmlElement") { continue }

    $client = ""
    if ($a -match "^\d+(\.\d+)?$" -and $b) {
      $client = $b
    } elseif ($currentClient) {
      $client = $currentClient
    } elseif ($b) {
      $client = $b
    }
    if (-not $client) { continue }

    $billingStatus = "billable"
    $billable = $true
    if ($g -match "(?i)non[- ]?billable") {
      $billingStatus = "non_billable"
      $billable = $false
    } elseif ($g -match "(?i)\bbilled\b") {
      $billingStatus = "billed"
      $billable = $true
    }

    $wfStatus = "pending"
    if ($t -match "(?i)draft|pending|waiting") {
      $wfStatus = "draft"
    }

    $sumCats = ($i + $j + $k + $l + $m + $n + $o + $p)
    $amount = 0.0
    if ($q -gt 0) {
      $amount = $q
    } elseif ($sumCats -gt 0) {
      $amount = $sumCats
    } elseif ($rTotal -gt 0) {
      $amount = $rTotal
    }

    $activityType = "communication"
    if ($i -gt 0 -or $j -gt 0) {
      $activityType = "appearance"
    } elseif ($m -gt 0) {
      $activityType = "pleading_major"
    }

    $note = @()
    if ($e) { $note += ("Assignee: " + $e) }
    if ($f) { $note += ("Location: " + $f) }
    if ($h) { $note += ("Handling: " + $h) }
    $sourceNote = "DSLAW RETAINER2026.xlsx"
    if ($note.Count -gt 0) {
      $sourceNote = $sourceNote + " | " + ($note -join " | ")
    }

    $out += [pscustomobject]@{
      row_no         = 0
      client_name    = $client
      occurred_on    = $dateIso
      matter         = $matter
      billing_status = $billingStatus
      billable       = $billable
      wf_status      = $wfStatus
      invoice_no     = $s
      source_note    = $sourceNote
      amount         = [math]::Round($amount, 2)
      activity_type  = $activityType
    }
  }

  $dedup = $out | Group-Object { ($_.client_name.ToLowerInvariant() + "|" + $_.occurred_on + "|" + $_.matter.ToLowerInvariant()) } | ForEach-Object { $_.Group[0] }
  $idx = 1
  foreach ($x in $dedup) {
    $x.row_no = $idx
    $idx++
  }
  return $dedup
}

function Detect-SpecialActivityType([string]$matter) {
  $m = (Clean $matter).ToLowerInvariant()
  if ($m -match "due diligence|review|legal|opinion|memorandum|petition|incorporation|transfer|title|sec|bir|audit|settlement") {
    return "pleading_major"
  }
  return "communication"
}

function Parse-SpecialRows() {
  $rows = Get-XlsxRows "tmp_special_xlsx" "xl/worksheets/sheet1.xml"
  $out = @()
  $seedDate = [datetime]"2025-01-01"

  foreach ($r in $rows) {
    if ($r.Row -lt 4) { continue }

    $joined = Clean (($r.A + " " + $r.B + " " + $r.C))
    if ($joined -match "(?i)LITIGATION CASES") { break }

    $seq = Clean $r.A
    if ($seq -notmatch "^\d+(\.\d+)?$") { continue }

    $client = Clean $r.B
    if (-not $client -or $client -eq "System.Xml.XmlElement") { continue }

    $matter = Clean $r.C
    if (-not $matter -or $matter -eq "System.Xml.XmlElement") {
      $matter = "Special Project Engagement"
    }

    $link = Clean $r.D
    if ($link -eq "System.Xml.XmlElement") { $link = "" }
    $handling = Clean $r.E
    $dateIso = ParseDateToIso $r.F
    if (-not $dateIso) {
      $dateIso = $seedDate.AddDays($out.Count).ToString("yyyy-MM-dd")
    }
    $weekly = Clean $r.G
    if ($weekly -eq "System.Xml.XmlElement") { $weekly = "" }
    $tracker = Clean $r.H
    $remarks = Clean $r.I
    if ($remarks -eq "System.Xml.XmlElement") { $remarks = "" }

    if ($client -in @("MERCADO", "GIBIS BAKESHOP", "CABREBALD HOLDINGS INC.")) { continue }
    if ($matter -eq "Special Project Engagement" -and -not $link -and -not $weekly -and -not $remarks) { continue }

    $wfBlob = (($weekly + " " + $remarks).Trim())
    $wfStatus = "pending"
    if ($wfBlob -match "(?i)pending|waiting|await|draft") {
      $wfStatus = "draft"
    }

    $remarkParts = @()
    if ($handling) { $remarkParts += ("Handling: " + $handling) }
    if ($weekly) { $remarkParts += ("Update: " + $weekly) }
    if ($tracker) { $remarkParts += ("Tracker: " + $tracker) }
    if ($remarks) { $remarkParts += ("Remarks: " + $remarks) }
    $remarkText = ($remarkParts -join " | ")

    $out += [pscustomobject]@{
      row_no          = 0
      client_name     = $client
      occurred_on     = $dateIso
      matter          = $matter
      wf_status       = $wfStatus
      activity_type   = (Detect-SpecialActivityType $matter)
      engagement_link = $link
      remarks         = $remarkText
      source_note     = "SPECIAL PROJECT 2026.xlsx"
    }
  }

  $dedup = $out | Group-Object { ($_.client_name.ToLowerInvariant() + "|" + $_.occurred_on + "|" + $_.matter.ToLowerInvariant()) } | ForEach-Object { $_.Group[0] }
  $idx = 1
  foreach ($x in $dedup) {
    $x.row_no = $idx
    $idx++
  }
  return $dedup
}

function Build-Sql11([object[]]$rows) {
  $vals = @()
  foreach ($r in $rows) {
    $vals += "    (" + $r.row_no + ", " + (SqlQuote $r.client_name) + ", " + (SqlQuote $r.occurred_on) + ", " + (SqlQuote $r.matter) + ", " + (SqlQuote $r.billing_status) + ", " + ($r.billable.ToString().ToLowerInvariant()) + ", " + (SqlQuote $r.wf_status) + ", " + (SqlQuote $r.invoice_no) + ", " + (SqlQuote $r.source_note) + ", " + [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.amount) + ", " + (SqlQuote $r.activity_type) + ")"
  }
  $valuesBlock = ($vals -join ",`r`n")

  return @"
-- STEP 11: Sync retainer backlog rows into activities (update + insert)
-- Source: C:\Users\kevin\Documents\Work\Delloro Saulog\DSLAW RETAINER2026.xlsx
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
-- Source: C:\Users\kevin\Documents\Work\Delloro Saulog\SPECIAL PROJECT 2026.xlsx
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

$retRows = Parse-RetainerRows
$spRows = Parse-SpecialRows

$sql11 = Build-Sql11 $retRows
$sql12 = Build-Sql12 $spRows

Set-Content -Path "sql\\11_sync_retainer_backlog_rows.sql" -Value $sql11 -Encoding UTF8
Set-Content -Path "sql\\12_sync_special_project_rows.sql" -Value $sql12 -Encoding UTF8

Write-Output ("RET_ROWS=" + $retRows.Count)
Write-Output ("SP_ROWS=" + $spRows.Count)
