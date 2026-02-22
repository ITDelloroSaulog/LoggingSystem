param(
  [string]$BaseDir = "C:\Users\kevin\Documents\Work\Delloro Saulog\Retainer",
  [string]$OutFile = "sql\40_sync_retainer_monthly_summary_refs.sql"
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

function ParsePeriodFromFileName([string]$fileName) {
  $m = [regex]::Match($fileName, '(?i)\b(JAN|FEB|MAR|MARCH|APR|APRIL|MAY|JUN|JUNE|JUL|JULY|AUG|AUGUST|SEP|SEPT|SEPTEMBER|OCT|OCTOBER|NOV|NOVEMBER|DEC|DECEMBER)\s+(\d{4})\b')
  if (-not $m.Success) { return $null }

  $monTok = $m.Groups[1].Value.ToUpperInvariant()
  $year = [int]$m.Groups[2].Value
  $monthMap = @{
    JAN = 1; FEB = 2; MAR = 3; MARCH = 3; APR = 4; APRIL = 4; MAY = 5;
    JUN = 6; JUNE = 6; JUL = 7; JULY = 7; AUG = 8; AUGUST = 8;
    SEP = 9; SEPT = 9; SEPTEMBER = 9; OCT = 10; OCTOBER = 10;
    NOV = 11; NOVEMBER = 11; DEC = 12; DECEMBER = 12
  }
  if (-not $monthMap.ContainsKey($monTok)) { return $null }

  $month = [int]$monthMap[$monTok]
  $period = ($year * 100) + $month
  $periodStart = [datetime]::new($year, $month, 1).ToString("yyyy-MM-dd")
  return [pscustomobject]@{
    period_yyyymm = $period
    period_start = $periodStart
  }
}

function Test-ValidOfficialRef([string]$refNo, [string]$invoiceNo, [double]$grossAmount, [double]$netAmount, [string]$remarks, [string]$copyOfInvoice) {
  $ref = Clean $refNo
  $invoice = Clean $invoiceNo
  $rem = Clean $remarks
  $copy = Clean $copyOfInvoice

  if (-not $ref) { return $false }
  if ($ref -match '(?i)^total') { return $false }
  if ($ref -match '(?i)^quarterly\s*\(') { return $false }
  if ($ref -match '(?i)engagement not yet received') { return $false }
  if ($ref -match '(?i)\bSP\b') { return $false } # one-time/special-project style refs (e.g., MES-SP-PFEES-B01)
  if ($rem -match '(?i)one\s*time') { return $false }

  $hasBillingSignal = ($invoice -ne "") -or ($copy -ne "") -or ($grossAmount -gt 0) -or ($netAmount -gt 0)
  return $hasBillingSignal
}

function ParseMonthlySummarySection([string]$filePath) {
  $fileName = [System.IO.Path]::GetFileName($filePath)
  $period = ParsePeriodFromFileName $fileName
  if ($null -eq $period) { return @() }

  $lines = Get-Content -Path $filePath
  $headerIdx = -1
  $opeHeaderIdx = $lines.Count
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = Clean $lines[$i]
    if ($headerIdx -lt 0 -and $line.ToUpperInvariant().StartsWith("SEQ,CLIENTS,REF. NO")) {
      $headerIdx = $i
    }
    if ($line.ToUpperInvariant().StartsWith("DATE,CLIENT,PARTICULAR,ASSIGNED STAFF")) {
      $opeHeaderIdx = $i
      break
    }
  }
  if ($headerIdx -lt 0) { return @() }

  $endIdx = [Math]::Max($headerIdx, $opeHeaderIdx - 1)
  $csvText = @($lines[$headerIdx]) + @($lines[($headerIdx + 1)..$endIdx])
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
    $seqRaw = Clean (Get-Field $r @("SEQ"))
    $client = Clean (Get-Field $r @("CLIENTS", "CLIENT", "COMPANY"))
    $refNo = Clean (Get-Field $r @("REF. NO", "REF NO", "REF.NO", "REFERENCE"))
    $invoiceNo = Clean (Get-Field $r @("INVOICE NO.", "INVOICE NO", "INVOICE No.", "INVOICE"))
    $dateSent = ParseDateToIso (Get-Field $r @("DATE SENT"))
    $datePaid = ParseDateToIso (Get-Field $r @("DATE PAID"))
    $code = Clean (Get-Field $r @("CODE", "CATIGORY", "CATEGORY"))
    $gross = ParseMoney (Get-Field $r @("GROSS AMOUNT ", "GROSS AMOUNT"))
    $vat = ParseMoney (Get-Field $r @("VAT AMOUNT", "VAT"))
    $net = ParseMoney (Get-Field $r @("NET AMOUNT", "NET  AMOUNT"))
    $totalCollected = ParseMoney (Get-Field $r @("TOTAL COLLECTED"))
    $remarks = Clean (Get-Field $r @("Remarks", "REMARKS"))
    $copyOfInvoice = Clean (Get-Field $r @("COPY OF INVOICE"))

    $seqNum = 0
    if (-not [int]::TryParse($seqRaw, [ref]$seqNum)) { continue }
    if ($seqNum -le 0) { continue }
    if (-not $client) { continue }

    $isValidRef = Test-ValidOfficialRef $refNo $invoiceNo $gross $net $remarks $copyOfInvoice

    $out += [pscustomobject]@{
      row_no = 0
      source_row_no = $sourceRowNo
      source_file = $fileName
      period_yyyymm = $period.period_yyyymm
      period_start = $period.period_start
      client_name = $client
      ref_no = $refNo
      invoice_no = $invoiceNo
      date_sent = $dateSent
      date_paid = $datePaid
      code = $code
      gross_amount = [math]::Round($gross, 2)
      vat_amount = [math]::Round($vat, 2)
      net_amount = [math]::Round($net, 2)
      total_collected = [math]::Round($totalCollected, 2)
      remarks = $remarks
      copy_of_invoice = $copyOfInvoice
      is_valid_official_ref = $isValidRef
    }
  }

  return $out
}

function BuildSql([object[]]$rows, [string]$baseDirText) {
  $vals = @()
  foreach ($r in $rows) {
    $vals += "    (" +
      $r.row_no + ", " +
      $r.source_row_no + ", " +
      (SqlQuote $r.source_file) + ", " +
      $r.period_yyyymm + ", " +
      (SqlQuote $r.period_start) + ", " +
      (SqlQuote $r.client_name) + ", " +
      (SqlQuote $r.ref_no) + ", " +
      (SqlQuote $r.invoice_no) + ", " +
      ($(if ($r.date_sent) { SqlQuote $r.date_sent } else { "null" })) + ", " +
      ($(if ($r.date_paid) { SqlQuote $r.date_paid } else { "null" })) + ", " +
      (SqlQuote $r.code) + ", " +
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.gross_amount) + ", " +
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.vat_amount) + ", " +
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.net_amount) + ", " +
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [double]$r.total_collected) + ", " +
      (SqlQuote $r.remarks) + ", " +
      (SqlQuote $r.copy_of_invoice) + ", " +
      ($r.is_valid_official_ref.ToString().ToLowerInvariant()) +
      ")"
  }

  $valuesBlock = if ($vals.Count) { $vals -join ",`r`n" } else { "    (0,0,'',0,'','','', '', null, null, '', 0.00, 0.00, 0.00, 0.00, '', '', false)" }

  return @"
-- STEP 40: Sync official retainer monthly summary references into structured retainer matters (safe/unambiguous only)
-- Source: $baseDirText\DSLAW RETAINER2026 - *.csv (top summary table only; excludes OPE detail section)
-- Parsed summary rows: $($rows.Count)
-- Purpose:
--   1) Update retainer matters' retainer_contract_ref using official monthly summary REF. NO values.
--   2) Only update when account+period resolves to exactly one valid ref and exactly one target retainer matter.
--   3) Report unresolved accounts, ambiguous refs, and missing target matters for manual cleanup.
-- Safe to re-run.

begin;

create temporary table if not exists pg_temp.step40_source_summary_rows (
  row_no integer,
  source_row_no integer,
  source_file text,
  period_yyyymm integer,
  period_start date,
  client_name text,
  ref_no text,
  invoice_no text,
  date_sent date,
  date_paid date,
  code text,
  gross_amount numeric,
  vat_amount numeric,
  net_amount numeric,
  total_collected numeric,
  remarks text,
  copy_of_invoice text,
  is_valid_official_ref boolean
) on commit drop;

truncate table pg_temp.step40_source_summary_rows;

insert into pg_temp.step40_source_summary_rows (
  row_no,
  source_row_no,
  source_file,
  period_yyyymm,
  period_start,
  client_name,
  ref_no,
  invoice_no,
  date_sent,
  date_paid,
  code,
  gross_amount,
  vat_amount,
  net_amount,
  total_collected,
  remarks,
  copy_of_invoice,
  is_valid_official_ref
)
values
$valuesBlock
;

with source_summary_rows as (
  select *
  from pg_temp.step40_source_summary_rows
),
usable_source_rows as (
  select *
  from source_summary_rows
  where row_no > 0
),
resolved_accounts as (
  select
    s.*,
    a.id as account_id,
    a.title as account_title
  from usable_source_rows s
  left join public.accounts a
    on lower(trim(coalesce(a.category, ''))) = 'retainer'
   and public.norm_key(a.title) = public.norm_key(s.client_name)
),
unresolved_account_rows as (
  select *
  from resolved_accounts
  where account_id is null
),
valid_ref_rows as (
  select
    ra.*
  from resolved_accounts ra
  where ra.account_id is not null
    and ra.is_valid_official_ref = true
    and nullif(trim(coalesce(ra.ref_no, '')), '') is not null
),
valid_ref_groups as (
  select
    v.account_id,
    min(v.account_title) as account_title,
    v.period_yyyymm,
    min(v.period_start::date) as period_start_date,
    count(*)::int as source_rows,
    count(distinct lower(trim(v.ref_no)))::int as distinct_valid_refs,
    min(v.ref_no) as chosen_ref_if_single,
    string_agg(distinct v.ref_no, ' ; ' order by v.ref_no) as valid_refs_list,
    string_agg(distinct v.source_file, ' ; ' order by v.source_file) as source_files
  from valid_ref_rows v
  group by v.account_id, v.period_yyyymm
),
target_retainer_matters as (
  select
    m.id as matter_id,
    m.account_id,
    coalesce(m.retainer_period_yyyymm, 0) as period_yyyymm,
    m.retainer_contract_ref,
    m.title,
    m.status
  from public.matters m
  where m.matter_type = 'retainer'
),
target_counts as (
  select
    g.account_id,
    g.period_yyyymm,
    count(t.matter_id)::int as target_matters
  from valid_ref_groups g
  left join target_retainer_matters t
    on t.account_id = g.account_id
   and t.period_yyyymm = g.period_yyyymm
  group by g.account_id, g.period_yyyymm
),
eligible_update_groups as (
  select
    g.*,
    t.matter_id,
    t.retainer_contract_ref as existing_ref
  from valid_ref_groups g
  join target_counts tc
    on tc.account_id = g.account_id
   and tc.period_yyyymm = g.period_yyyymm
  join target_retainer_matters t
    on t.account_id = g.account_id
   and t.period_yyyymm = g.period_yyyymm
  where g.distinct_valid_refs = 1
    and tc.target_matters = 1
),
updated_matters as (
  update public.matters m
  set
    retainer_contract_ref = e.chosen_ref_if_single,
    opened_at = coalesce(m.opened_at, e.period_start_date),
    updated_at = now()
  from eligible_update_groups e
  where m.id = e.matter_id
    and lower(trim(coalesce(m.retainer_contract_ref, ''))) is distinct from lower(trim(coalesce(e.chosen_ref_if_single, '')))
  returning m.id
)
select
  (select count(*) from usable_source_rows) as source_summary_rows_count,
  (select count(*) from usable_source_rows where is_valid_official_ref) as valid_official_ref_source_rows,
  (select count(*) from resolved_accounts where account_id is not null) as source_rows_account_resolved,
  (select count(*) from unresolved_account_rows) as source_rows_unresolved_account,
  (select count(*) from valid_ref_groups) as account_period_groups_with_valid_refs,
  (select count(*) from valid_ref_groups where distinct_valid_refs = 1) as single_ref_account_period_groups,
  (select count(*) from valid_ref_groups where distinct_valid_refs > 1) as ambiguous_multi_ref_account_period_groups,
  (select count(*) from target_counts where target_matters = 0) as single_or_multi_ref_groups_missing_target_matter,
  (select count(*) from target_counts where target_matters > 1) as groups_with_ambiguous_target_matters,
  (select count(*) from eligible_update_groups) as eligible_single_ref_single_matter_groups,
  (select count(*) from updated_matters) as retainer_matters_updated_to_official_ref;

drop table if exists pg_temp.step40_unresolved_account_rows;
create temporary table pg_temp.step40_unresolved_account_rows on commit drop as
with source_summary_rows as (
  select * from pg_temp.step40_source_summary_rows
),
usable_source_rows as (
  select * from source_summary_rows where row_no > 0
),
resolved_accounts as (
  select
    s.*,
    a.id as account_id,
    a.title as account_title
  from usable_source_rows s
  left join public.accounts a
    on lower(trim(coalesce(a.category, ''))) = 'retainer'
   and public.norm_key(a.title) = public.norm_key(s.client_name)
)
select *
from resolved_accounts
where account_id is null;

drop table if exists pg_temp.step40_valid_ref_groups;
create temporary table pg_temp.step40_valid_ref_groups on commit drop as
with source_summary_rows as (
  select * from pg_temp.step40_source_summary_rows
),
usable_source_rows as (
  select * from source_summary_rows where row_no > 0
),
resolved_accounts as (
  select
    s.*,
    a.id as account_id,
    a.title as account_title
  from usable_source_rows s
  left join public.accounts a
    on lower(trim(coalesce(a.category, ''))) = 'retainer'
   and public.norm_key(a.title) = public.norm_key(s.client_name)
),
valid_ref_rows as (
  select
    ra.*
  from resolved_accounts ra
  where ra.account_id is not null
    and ra.is_valid_official_ref = true
    and nullif(trim(coalesce(ra.ref_no, '')), '') is not null
),
valid_ref_groups as (
  select
    v.account_id,
    min(v.account_title) as account_title,
    v.period_yyyymm,
    min(v.period_start::date) as period_start_date,
    count(*)::int as source_rows,
    count(distinct lower(trim(v.ref_no)))::int as distinct_valid_refs,
    min(v.ref_no) as chosen_ref_if_single,
    string_agg(distinct v.ref_no, ' ; ' order by v.ref_no) as valid_refs_list,
    string_agg(distinct v.source_file, ' ; ' order by v.source_file) as source_files
  from valid_ref_rows v
  group by v.account_id, v.period_yyyymm
)
select *
from valid_ref_groups;

drop table if exists pg_temp.step40_target_counts;
create temporary table pg_temp.step40_target_counts on commit drop as
with valid_ref_groups as (
  select * from pg_temp.step40_valid_ref_groups
),
target_retainer_matters as (
  select
    m.id as matter_id,
    m.account_id,
    coalesce(m.retainer_period_yyyymm, 0) as period_yyyymm
  from public.matters m
  where m.matter_type = 'retainer'
),
target_counts as (
  select
    g.account_id,
    g.period_yyyymm,
    count(t.matter_id)::int as target_matters
  from valid_ref_groups g
  left join target_retainer_matters t
    on t.account_id = g.account_id
   and t.period_yyyymm = g.period_yyyymm
  group by g.account_id, g.period_yyyymm
)
select *
from target_counts;

-- REVIEW 1: Unresolved account rows from summary files (alias/account naming mismatches)
select
  source_file,
  source_row_no,
  period_yyyymm,
  client_name,
  ref_no,
  invoice_no,
  code,
  gross_amount,
  net_amount,
  remarks,
  is_valid_official_ref
from pg_temp.step40_unresolved_account_rows
order by period_yyyymm, source_file, source_row_no;

-- REVIEW 2: Account-period groups with multiple distinct valid refs (do not auto-pick)
select
  g.account_id,
  g.account_title,
  g.period_yyyymm,
  g.source_rows,
  g.distinct_valid_refs,
  g.valid_refs_list,
  g.source_files,
  coalesce(tc.target_matters, 0) as target_retainer_matters
from pg_temp.step40_valid_ref_groups g
left join pg_temp.step40_target_counts tc
  on tc.account_id = g.account_id
 and tc.period_yyyymm = g.period_yyyymm
where g.distinct_valid_refs > 1
order by g.period_yyyymm, g.account_title;

-- REVIEW 3: Single official ref groups with no target retainer matter yet (seed these next if desired)
select
  g.account_id,
  g.account_title,
  g.period_yyyymm,
  g.period_start_date,
  g.chosen_ref_if_single as official_ref_no,
  g.source_rows,
  g.source_files
from pg_temp.step40_valid_ref_groups g
join pg_temp.step40_target_counts tc
  on tc.account_id = g.account_id
 and tc.period_yyyymm = g.period_yyyymm
where g.distinct_valid_refs = 1
  and tc.target_matters = 0
order by g.period_yyyymm, g.account_title;

commit;
"@
}

if (-not (Test-Path $BaseDir)) {
  throw "Retainer folder not found: $BaseDir"
}

$files = Get-ChildItem -Path $BaseDir -File -Filter "DSLAW RETAINER2026 - *.csv" |
  Where-Object {
    $_.Name -notmatch '(?i)SUMMARY LIST|SUMMARY COLLECTION|BACKLOG'
  } |
  Sort-Object Name

$allRows = @()
foreach ($f in $files) {
  $rows = ParseMonthlySummarySection $f.FullName
  if (-not $rows -or $rows.Count -eq 0) { continue }
  $allRows += $rows
}

$i = 1
foreach ($r in $allRows) {
  $r.row_no = $i
  $i++
}

$sql = BuildSql -rows $allRows -baseDirText $BaseDir
$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
Set-Content -Path $OutFile -Value $sql -Encoding UTF8

Write-Host "Generated $OutFile"
Write-Host ("SUMMARY_ROWS=" + $allRows.Count)
Write-Host ("VALID_OFFICIAL_REF_ROWS=" + (($allRows | Where-Object { $_.is_valid_official_ref }).Count))
Write-Host ("FILES=" + $files.Count)
