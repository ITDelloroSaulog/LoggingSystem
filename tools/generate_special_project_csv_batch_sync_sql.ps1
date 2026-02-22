param(
  [string]$SourceDir = "C:\Users\kevin\Documents\Work\Delloro Saulog\Special Project",
  [string]$OutSql = "sql\26_sync_special_project_csv_batch1.sql",
  [string[]]$ExcludeSpecialCodes = @()
)

$ErrorActionPreference = "Stop"

function Clean([string]$s) {
  if ($null -eq $s) { return "" }
  return (($s -replace "[\u0000-\u001F]", " ") -replace "\s+", " ").Trim()
}

function Norm([string]$s) {
  $x = (Clean $s).ToLowerInvariant()
  if (-not $x) { return "" }
  $x = $x -replace "\b(ms|mr|mrs|dr|hon|sps|spouses|idr)\.?\b", ""
  return ($x -replace "[^a-z0-9]+", "")
}

function SqlQuote([string]$s) {
  if ($null -eq $s) { $s = "" }
  return "'" + ($s -replace "'", "''") + "'"
}

function ParseDateToIso([string]$raw) {
  $d = Clean $raw
  if (-not $d -or $d -eq "-") { return "" }
  $formats = @("M-d-yy","M-d-yyyy","d-M-yy","d-M-yyyy","d-MMM-yy","d-MMM-yyyy","dd-MMM-yy","dd-MMM-yyyy","yyyy-MM-dd")
  foreach ($f in $formats) {
    try { return ([datetime]::ParseExact($d, $f, [System.Globalization.CultureInfo]::InvariantCulture)).ToString("yyyy-MM-dd") } catch {}
  }
  try { return ([datetime]::Parse($d, [System.Globalization.CultureInfo]::InvariantCulture)).ToString("yyyy-MM-dd") } catch { return "" }
}

function BuildCode([string]$s) {
  $x = (Clean $s) -replace "[^A-Za-z0-9]+", "-"
  $x = $x.Trim("-").ToUpperInvariant()
  if (-not $x) { return "" }
  return $x
}

function ShortHash([string]$s) {
  $v = Clean $s
  if (-not $v) { return "000000" }
  $md5 = [System.Security.Cryptography.MD5]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($v.ToUpperInvariant())
    $hash = $md5.ComputeHash($bytes)
    $hex = -join ($hash | ForEach-Object { $_.ToString("x2") })
    return $hex.Substring(0, 6).ToUpperInvariant()
  } finally {
    $md5.Dispose()
  }
}

function HeaderKey([string]$s) { return ((Clean $s).ToLowerInvariant() -replace "[^a-z0-9]+", "") }

function GetField($row, [string[]]$candidates) {
  $map = @{}
  foreach ($p in $row.PSObject.Properties) { $map[(HeaderKey $p.Name)] = [string]$p.Value }
  foreach ($c in $candidates) {
    $k = HeaderKey $c
    if ($map.ContainsKey($k)) { return [string]$map[$k] }
  }
  return ""
}

function ImportFromHeader([string]$path, [scriptblock]$match) {
  $lines = Get-Content -Path $path
  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if (& $match ((Clean $lines[$i]).ToLowerInvariant())) { $idx = $i; break }
  }
  if ($idx -lt 0) { return @() }
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $tmp -Value ($lines[$idx..($lines.Count - 1)]) -Encoding UTF8
    return @(Import-Csv -Path $tmp)
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path $SourceDir)) { throw "SourceDir not found: $SourceDir" }

$excludeCodeSet = @{}
foreach ($code in @($ExcludeSpecialCodes)) {
  $k = BuildCode $code
  if ($k) { $excludeCodeSet[$k] = $true }
}

$files = @(Get-ChildItem -Path $SourceDir -Filter "SPECIAL PROJECT 2026 - *.csv" -File | Sort-Object Name)
if ($files.Count -eq 0) { throw "No matching CSV files found: $SourceDir" }

# Summary map: client -> tracker link code.
$summaryMap = @{}
$summaryFile = $files | Where-Object { $_.Name -match "(?i)SUMMARY\.csv$" } | Select-Object -First 1
if ($summaryFile) {
  $summaryRows = ImportFromHeader $summaryFile.FullName { param($line) $line -like "seq.,client,description of engagement,*" }
  foreach ($r in $summaryRows) {
    $seq = Clean (GetField $r @("Seq.","Seq"))
    if ($seq -notmatch "^\d+$") { continue }
    $client = Clean (GetField $r @("Client"))
    $tracker = BuildCode (GetField $r @("TRACKER LINK","Tracker Link"))
    $desc = Clean (GetField $r @("Description of Engagement"))
    $dateIso = ParseDateToIso (GetField $r @("DATE OF ENGAGEMENT","Date of Engagement"))
    if (-not $client) { continue }
    $k = Norm $client
    if (-not $summaryMap.ContainsKey($k)) {
      $summaryMap[$k] = [pscustomobject]@{
        special_code = if ($tracker) { $tracker } else { BuildCode ("SP-" + $client + "-" + $seq) }
        title = if ($desc) { $desc } else { "Special Project Engagement" }
        opened_on = $dateIso
      }
    }
  }
}

$rows = @()
$fileBaseCodeMap = @{}
foreach ($f in $files) {
  if ($f.Name -match "(?i)SUMMARY\.csv$|EMAIL\.csv$|WEEKLY ACT") { continue }
  $lines = Get-Content -Path $f.FullName
  $client = ""
  $typeEng = ""
  foreach ($line in $lines) {
    $c = Clean $line
    if (-not $client -and $c -match "(?i)^""?CLIENT:\s*(.+?)""?$") { $client = (Clean $matches[1]).Trim(",") }
    if (-not $typeEng -and $c -match "(?i)^""?TYPE OF ENGAGEMENT:\s*(.+?)""?$") { $typeEng = (Clean $matches[1]).Trim(",") }
  }
  $detail = ImportFromHeader $f.FullName { param($line) $line -like "seq.,date,incident,minutes,*" }
  $fileCode = BuildCode (($f.Name -replace "(?i)^SPECIAL PROJECT 2026 - ", "" -replace "(?i)\.csv$", ""))
  $headerClient = if ($client) { $client } else { "" }
  $fileMapped = $null
  if ($headerClient) {
    $hk = Norm $headerClient
    if ($summaryMap.ContainsKey($hk)) { $fileMapped = $summaryMap[$hk] }
  }
  $fileBase = if ($fileMapped) { $fileMapped.special_code } else { if ($fileCode) { $fileCode } else { BuildCode ("SP-" + $headerClient) } }
  $fileBase = BuildCode $fileBase
  if ($fileBase) { $fileBaseCodeMap[$f.Name] = $fileBase }
  foreach ($r in $detail) {
    $seq = Clean (GetField $r @("Seq.","SEQ.","Seq"))
    if ($seq -notmatch "^\d+$") { continue }
    $occurred = ParseDateToIso (GetField $r @("Date","DATE"))
    if (-not $occurred) { continue }
    $incident = Clean (GetField $r @("INCIDENT","Incident"))
    $minutes = Clean (GetField $r @("MINUTES","Minutes"))
    $staff = Clean (GetField $r @("Handling Staff","Handling Lawyer/Staff"))
    $venue = Clean (GetField $r @("VENUE","Venue"))
    $remarks = Clean (GetField $r @("Remarks","REMARKS"))
    $manhours = Clean (GetField $r @("MANHOURS","Man hours"))
    $invoice = Clean (GetField $r @("INVOICE","Invoice"))
    if (-not $incident -and -not $minutes -and -not $staff -and -not $venue -and -not $remarks -and -not $manhours -and -not $invoice) { continue }

    $srcClient = if ($client) { $client } else { Clean (GetField $r @("Client","CLIENT")) }
    if (-not $srcClient) { continue }
    $k = Norm $srcClient
    $mapped = if ($summaryMap.ContainsKey($k)) { $summaryMap[$k] } else { $null }
    $special = if ($mapped) { $mapped.special_code } else { if ($fileCode) { $fileCode } else { BuildCode ("SP-" + $srcClient) } }
    if ($excludeCodeSet.ContainsKey((BuildCode $special))) { continue }
    $title = if ($mapped) { $mapped.title } elseif ($typeEng) { $typeEng } else { "Special Project Engagement" }
    $opened = if ($mapped -and $mapped.opened_on) { $mapped.opened_on } else { $occurred }
    $blob = (Clean ($incident + " " + $minutes)).ToLowerInvariant()
    $task = "special_project"
    $entryClass = "service"
    $expense = ""
    $activityType = "communication"
    $wf = "pending"
    if ($blob -match "appearance|meeting|hearing") { $task = "appearance_fee"; $activityType = "appearance"; $entryClass = "meeting" }
    elseif ($blob -match "minor pleading") { $task = "pleading_minor"; $activityType = "pleading_minor" }
    elseif ($blob -match "pleading|motion|petition") { $task = "pleading_major"; $activityType = "pleading_major" }
    elseif ($blob -match "lbc|courier") { $task = "ope_lbc"; $entryClass = "opex"; $expense = "courier"; $wf = "draft" }
    elseif ($blob -match "transpo|transport") { $task = "ope_transpo"; $entryClass = "opex"; $expense = "transport"; $wf = "draft" }
    elseif ($blob -match "notary") { $task = "notary_fee"; $entryClass = "opex"; $expense = "notary"; $wf = "draft" }
    elseif ($blob -match "print") { $task = "ope_printing"; $entryClass = "opex"; $expense = "printing"; $wf = "draft" }
    elseif ($blob -match "envelope|folder") { $task = "ope_envelope"; $entryClass = "opex"; $expense = "envelope"; $wf = "draft" }
    elseif ($blob -match "manhour|man hour") { $task = "ope_manhours"; $entryClass = "opex"; $expense = "manhour"; $wf = "draft" }
    if ($wf -ne "draft" -and (Clean ($remarks + " " + $minutes)).ToLowerInvariant() -match "pending|draft|await|wait|on hold") { $wf = "draft" }

    $sourceKey = "spcsv:" + $f.Name + ":" + $seq + ":" + $occurred + ":" + (Norm $srcClient)
    $incidentText = if ($incident) { $incident } else { "-" }
    $minutesText = if ($minutes) { $minutes } else { "-" }
    $venueText = if ($venue) { $venue } else { "-" }
    $staffText = if ($staff) { $staff } else { "-" }
    $remarksText = if ($remarks) { $remarks } else { "-" }
    $manhoursText = if ($manhours) { $manhours } else { "-" }
    $invoiceText = if ($invoice) { $invoice } else { "-" }
    $desc = "Special Project Detail | Incident: " + $incidentText +
      " | Minutes: " + $minutesText +
      " | Venue: " + $venueText +
      " | Handling Staff: " + $staffText +
      " | Remarks: " + $remarksText +
      " | Manhours: " + $manhoursText +
      " | Invoice: " + $invoiceText +
      " | Source: " + $f.Name

    $rows += [pscustomobject]@{
      row_no = 0
      source_file = $f.Name
      source_key = $sourceKey
      client_name = $srcClient
      special_code = $special
      title = $title
      opened_on = $opened
      occurred_on = $occurred
      handling_token = $staff
      activity_type = $activityType
      workflow_status = $wf
      task_category = $task
      entry_class = $entryClass
      expense_type = $expense
      description = $desc
    }
  }
}

$rows = @($rows | Group-Object source_key | ForEach-Object { $_.Group[0] } | Sort-Object source_file, occurred_on, source_key)

# Best practice: never silently merge different files under one special_code.
# If a special_code maps to multiple source files, assign deterministic suffixed codes per file.
$collisionRemaps = @()
$allFilesByBaseCode = @{}
foreach ($kv in $fileBaseCodeMap.GetEnumerator()) {
  if (-not $allFilesByBaseCode.ContainsKey($kv.Value)) { $allFilesByBaseCode[$kv.Value] = @() }
  $allFilesByBaseCode[$kv.Value] += $kv.Key
}
$usedCodes = @{}
foreach ($r in $rows) {
  $k = BuildCode $r.special_code
  if ($k) { $usedCodes[$k] = $true }
}
$codeGroups = @($rows | Group-Object { BuildCode $_.special_code })
foreach ($g in $codeGroups) {
  $baseCode = BuildCode $g.Name
  if (-not $baseCode) { continue }
  $fileGroups = @($g.Group | Group-Object source_file)
  $folderCollisionCount = 0
  if ($allFilesByBaseCode.ContainsKey($baseCode)) {
    $folderCollisionCount = @($allFilesByBaseCode[$baseCode] | Select-Object -Unique).Count
  }
  if ($fileGroups.Count -le 1 -and $folderCollisionCount -le 1) { continue }
  foreach ($fg in $fileGroups) {
    $suffix = ShortHash $fg.Name
    $candidate = BuildCode ($baseCode + "-" + $suffix)
    $n = 2
    while ($usedCodes.ContainsKey($candidate)) {
      $candidate = BuildCode ($baseCode + "-" + $suffix + "-" + $n)
      $n++
    }
    foreach ($row in $fg.Group) { $row.special_code = $candidate }
    $usedCodes[$candidate] = $true
    $collisionRemaps += [pscustomobject]@{
      base_code = $baseCode
      source_file = $fg.Name
      remapped_code = $candidate
      row_count = $fg.Count
    }
  }
}

$i = 1
foreach ($r in $rows) { $r.row_no = $i; $i++ }

$vals = @()
foreach ($r in $rows) {
  $opened = if ($r.opened_on) { SqlQuote $r.opened_on } else { "null" }
  $occurred = if ($r.occurred_on) { SqlQuote $r.occurred_on } else { "null" }
  $vals += "    (" + $r.row_no + ", " + (SqlQuote $r.source_file) + ", " + (SqlQuote $r.source_key) + ", " + (SqlQuote $r.client_name) + ", " + (SqlQuote $r.special_code) + ", " + (SqlQuote $r.title) + ", " + $opened + ", " + $occurred + ", " + (SqlQuote $r.handling_token) + ", " + (SqlQuote $r.activity_type) + ", " + (SqlQuote $r.workflow_status) + ", " + (SqlQuote $r.task_category) + ", " + (SqlQuote $r.entry_class) + ", " + (SqlQuote $r.expense_type) + ", " + (SqlQuote $r.description) + ")"
}
$valuesBlock = if ($vals.Count) { $vals -join ",`r`n" } else { "    (null::int, null::text, null::text, null::text, null::text, null::text, null::date, null::date, null::text, null::text, null::text, null::text, null::text, null::text, null::text)" }

$sql = @"
-- STEP 26: Sync Special Project CSV detail batch into matters + activities
-- Source folder: $SourceDir
-- Parsed detail rows: $($rows.Count)
-- Safe to re-run.

create extension if not exists pgcrypto;
begin;

with source_rows (
  row_no, source_file, source_key, client_name, special_code, title, opened_on, occurred_on,
  handling_token, activity_type, workflow_status, task_category, entry_class, expense_type, description
) as (
  values
$valuesBlock
),
actor as (
  select coalesce((select p.id from public.profiles p where lower(trim(coalesce(p.role,''))) in ('super_admin','admin') order by p.created_at asc nulls last limit 1),(select p.id from public.profiles p order by p.created_at asc nulls last limit 1)) as actor_id
),
default_lawyer as (
  select coalesce((select p.id from public.profiles p where lower(trim(coalesce(p.role,'')))='lawyer' order by p.created_at asc nulls last limit 1),(select actor_id from actor)) as lawyer_id
),
ensure_accounts as (
  insert into public.accounts (title, category, status, created_by, account_kind, is_archived)
  select distinct s.client_name, 'special_project', 'active', a.actor_id,
    case when upper(s.client_name) similar to '%( INC| INC\\.| CORP| CORP\\.| CORPORATION| LTD| LTD\\.| HOLDINGS| COMPANY| CO\\.)%' then 'company' else 'personal' end,
    false
  from source_rows s cross join actor a
  where s.row_no is not null
    and not exists (select 1 from public.accounts acc where public.norm_key(acc.title)=public.norm_key(s.client_name) and lower(trim(coalesce(acc.category,'')))='special_project')
  returning id
),
target_accounts as (
  select distinct on (public.norm_key(acc.title))
    acc.id, acc.title, coalesce(acc.account_kind, 'personal') as account_kind
  from public.accounts acc
  where lower(trim(coalesce(acc.category,'')))='special_project'
    and public.norm_key(acc.title) in (select public.norm_key(client_name) from source_rows where row_no is not null)
  order by public.norm_key(acc.title), acc.created_at asc nulls last, acc.id
),
seed as (
  select distinct on (lower(trim(s.special_code)))
    s.client_name,
    s.special_code,
    s.title,
    s.opened_on,
    s.handling_token
  from source_rows s
  where s.row_no is not null
    and nullif(trim(coalesce(s.special_code, '')), '') is not null
  order by
    lower(trim(s.special_code)),
    nullif(trim(coalesce(s.opened_on, '')), '')::date desc nulls last,
    s.row_no asc
),
resolved_seed as (
  select sd.*, ta.id as account_id, ta.account_kind, ta.title as account_title,
    coalesce((select p.id from public.profiles p where lower(trim(coalesce(p.email,'')))=lower(trim(coalesce(sd.handling_token,''))) or lower(trim(coalesce(p.full_name,'')))=lower(trim(coalesce(sd.handling_token,''))) limit 1),(select lawyer_id from default_lawyer)) as handling_lawyer_id
  from seed sd join target_accounts ta on public.norm_key(ta.title)=public.norm_key(sd.client_name)
),
up_matter as (
  update public.matters m
  set account_id = rs.account_id, title = coalesce(nullif(trim(rs.title),''),m.title), opened_at = coalesce(nullif(trim(coalesce(rs.opened_on,'')), '')::date,m.opened_at), handling_lawyer_id = coalesce(rs.handling_lawyer_id,m.handling_lawyer_id), company_name = case when rs.account_kind='company' then rs.account_title else m.company_name end, personal_name = case when rs.account_kind='personal' then rs.account_title else m.personal_name end, updated_at = now()
  from resolved_seed rs
  where m.matter_type='special_project' and lower(trim(coalesce(m.special_engagement_code,''))) = lower(trim(rs.special_code))
  returning m.id
),
ins_matter as (
  insert into public.matters (account_id, matter_type, title, status, handling_lawyer_id, opened_at, created_by, special_engagement_code, company_name, personal_name, engagement_description)
  select rs.account_id, 'special_project', coalesce(nullif(trim(rs.title),''),'Special Project Engagement'), 'active', rs.handling_lawyer_id, nullif(trim(coalesce(rs.opened_on,'')), '')::date, (select actor_id from actor), rs.special_code,
    case when rs.account_kind='company' then rs.account_title else null end,
    case when rs.account_kind='personal' then rs.account_title else null end,
    nullif(trim(coalesce(rs.title,'')), '')
  from resolved_seed rs
  where not exists (select 1 from public.matters m where m.matter_type='special_project' and lower(trim(coalesce(m.special_engagement_code,'')))=lower(trim(rs.special_code)))
  returning id
),
target_matters as (
  select m.id, m.account_id, lower(trim(m.special_engagement_code)) as special_code_norm, m.handling_lawyer_id
  from public.matters m
  where m.matter_type='special_project'
    and lower(trim(coalesce(m.special_engagement_code,''))) in (select lower(trim(special_code)) from seed)
),
resolved as (
  select s.*, tm.account_id as account_id, tm.id as matter_id,
    coalesce((select p.id from public.profiles p where lower(trim(coalesce(p.full_name,'')))=lower(trim(coalesce(s.handling_token,''))) or lower(trim(coalesce(p.email,'')))=lower(trim(coalesce(s.handling_token,''))) limit 1),(select actor_id from actor)) as performed_by_id,
    coalesce(tm.handling_lawyer_id, (select lawyer_id from default_lawyer)) as handling_lawyer_id
  from source_rows s
  join target_matters tm on tm.special_code_norm=lower(trim(s.special_code))
  where s.row_no is not null
    and nullif(trim(coalesce(s.special_code, '')), '') is not null
),
ins_activities as (
  insert into public.activities (batch_id, line_no, account_id, matter, matter_id, billing_status, billable, created_by, activity_type, performed_by, handling_lawyer_id, status, fee_code, task_category, entry_class, expense_type, amount, minutes, description, occurred_at, attachment_urls, submitted_at, draft_expires_at, legacy_identifier_text)
  select gen_random_uuid(), r.row_no, r.account_id, r.title, r.matter_id, 'non_billable', false, (select actor_id from actor), r.activity_type, r.performed_by_id, r.handling_lawyer_id,
    case when lower(trim(coalesce(r.workflow_status,'')))='draft' then 'draft' else 'pending' end,
    null, r.task_category, r.entry_class, nullif(trim(coalesce(r.expense_type,'')), ''), 0::numeric, 0, r.description, (r.occurred_on::timestamptz + time '09:00'),
    null,
    case when lower(trim(coalesce(r.workflow_status,'')))='draft' then null else now() end,
    case when lower(trim(coalesce(r.workflow_status,'')))='draft' then now()+interval '30 minutes' else null end,
    r.source_key
  from resolved r
  where not exists (select 1 from public.activities a where a.matter_id = r.matter_id and lower(trim(coalesce(a.legacy_identifier_text,''))) = lower(trim(r.source_key)))
  returning id
)
select
  (select count(*) from source_rows where row_no is not null) as source_rows_count,
  (select count(*) from ensure_accounts) as accounts_created,
  (select count(*) from up_matter) as matters_updated,
  (select count(*) from ins_matter) as matters_inserted,
  (select count(*) from ins_activities) as activities_inserted;

commit;
"@

Set-Content -Path $OutSql -Value $sql -Encoding UTF8

Write-Output ("FILES_SCANNED=" + $files.Count)
Write-Output ("DETAIL_ROWS=" + $rows.Count)
if ($ExcludeSpecialCodes.Count -gt 0) {
  Write-Output ("EXCLUDED_CODES=" + (($ExcludeSpecialCodes | ForEach-Object { BuildCode $_ }) -join ","))
}
if ($rows.Count -gt 0) {
  $byCode = $rows | Group-Object special_code | Sort-Object Name
  foreach ($g in $byCode) {
    Write-Output ("DETAIL_ROWS_CODE_" + (BuildCode $g.Name) + "=" + $g.Count)
  }
}
if ($collisionRemaps.Count -gt 0) {
  foreach ($m in ($collisionRemaps | Sort-Object base_code, source_file)) {
    Write-Output ("SPECIAL_CODE_REMAP=" + $m.base_code + "|" + $m.source_file + "|" + $m.remapped_code + "|rows=" + $m.row_count)
  }
}
Write-Output ("OUTPUT_SQL=" + (Resolve-Path $OutSql))
