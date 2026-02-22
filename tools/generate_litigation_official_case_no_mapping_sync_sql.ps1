param(
  [string]$SourceFile,
  [string]$OutFile = "sql\47_sync_litigation_official_case_numbers_from_mapping.sql",
  [switch]$AllowNonTempCurrent
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

function Get-Field($row, [string[]]$names) {
  foreach ($n in $names) {
    if ($row.PSObject.Properties.Name -contains $n) {
      return [string]$row.$n
    }
  }
  return ""
}

function NormalizeCsvNullLiteral([string]$s) {
  $x = Clean $s
  if ($x.ToLowerInvariant() -in @('null','(null)')) { return "" }
  return $x
}

function ParseMappingCsv([string]$filePath) {
  if (-not $filePath) { return @() }
  if (-not (Test-Path $filePath)) { throw "Mapping file not found: $filePath" }

  $rows = Import-Csv -Path $filePath
  $out = @()
  $rowNo = 0
  foreach ($r in $rows) {
    $rowNo++
    $matterId = NormalizeCsvNullLiteral (Get-Field $r @("matter_id","Matter ID","MatterId"))
    $currentRef = NormalizeCsvNullLiteral (Get-Field $r @("current_official_case_no","Current Official Case No","current_case_no"))
    $newRef = NormalizeCsvNullLiteral (Get-Field $r @("new_official_case_no","New Official Case No","new_case_no"))
    $accountTitle = NormalizeCsvNullLiteral (Get-Field $r @("account_title","Account Title"))
    $matterTitle = NormalizeCsvNullLiteral (Get-Field $r @("matter_title","Matter Title"))
    $caseType = NormalizeCsvNullLiteral (Get-Field $r @("case_type","Case Type"))
    $venue = NormalizeCsvNullLiteral (Get-Field $r @("venue","Venue"))
    $openedAt = NormalizeCsvNullLiteral (Get-Field $r @("opened_at","Opened At"))

    $out += [pscustomobject]@{
      row_no = $rowNo
      matter_id_text = $matterId
      current_official_case_no = $currentRef
      new_official_case_no = $newRef
      account_title = $accountTitle
      matter_title = $matterTitle
      case_type = $caseType
      venue = $venue
      opened_at = $openedAt
    }
  }
  return $out
}

function BuildSql([object[]]$rows, [string]$sourcePathText, [bool]$allowNonTemp) {
  $vals = @()
  foreach ($r in $rows) {
    $vals += "    (" +
      $r.row_no + ", " +
      (SqlQuote $r.matter_id_text) + ", " +
      (SqlQuote $r.current_official_case_no) + ", " +
      (SqlQuote $r.new_official_case_no) + ", " +
      (SqlQuote $r.account_title) + ", " +
      (SqlQuote $r.matter_title) + ", " +
      (SqlQuote $r.case_type) + ", " +
      (SqlQuote $r.venue) + ", " +
      (SqlQuote $r.opened_at) +
      ")"
  }

  $valuesBlock = if ($vals.Count) {
    $vals -join ",`r`n"
  } else {
    "    (0, '', '', '', '', '', '', '', '')"
  }

  $allowLiteral = $allowNonTemp.ToString().ToLowerInvariant()

  return @"
-- STEP 47: Sync litigation official case numbers from master mapping CSV (generated)
-- Source: $(if ($sourcePathText) { $sourcePathText } else { '[template / fill with generator]' })
-- Mapping rows loaded: $($rows.Count)
-- Purpose:
--   1) Replace temporary litigation identifiers (TMP-LIT-...) with official_case_no values in bulk.
--   2) Validate matter_id + current_official_case_no matches DB state before update.
--   3) Prevent duplicate target case numbers and stale mapping overwrites.
-- Safe to re-run.
-- allow_non_temp_current = $allowLiteral

begin;

create temporary table if not exists pg_temp.step47_mapping_rows (
  row_no integer,
  matter_id_text text,
  current_official_case_no text,
  new_official_case_no text,
  account_title text,
  matter_title text,
  case_type text,
  venue text,
  opened_at text
) on commit drop;

truncate table pg_temp.step47_mapping_rows;

insert into pg_temp.step47_mapping_rows (
  row_no,
  matter_id_text,
  current_official_case_no,
  new_official_case_no,
  account_title,
  matter_title,
  case_type,
  venue,
  opened_at
)
values
$valuesBlock
;

drop table if exists pg_temp.step47_classified;
create temporary table pg_temp.step47_classified on commit drop as
with params as (
  select $allowLiteral::boolean as allow_non_temp_current
),
mapping_rows as (
  select *
  from pg_temp.step47_mapping_rows
),
usable_mapping as (
  select
    mr.*,
    lower(trim(coalesce(mr.matter_id_text, ''))) as matter_id_text_norm,
    lower(trim(coalesce(mr.current_official_case_no, ''))) as current_official_case_no_norm,
    lower(trim(coalesce(mr.new_official_case_no, ''))) as new_official_case_no_norm
  from mapping_rows mr
  where mr.row_no > 0
    and nullif(trim(coalesce(mr.matter_id_text, '')), '') is not null
    and nullif(trim(coalesce(mr.current_official_case_no, '')), '') is not null
    and nullif(trim(coalesce(mr.new_official_case_no, '')), '') is not null
),
mapping_dupe_matter as (
  select lower(trim(coalesce(matter_id_text, ''))) as k
  from usable_mapping
  group by 1
  having count(*) > 1
),
mapping_dupe_target_ref as (
  select lower(trim(coalesce(new_official_case_no, ''))) as k
  from usable_mapping
  group by 1
  having count(*) > 1
),
normalized as (
  select
    um.*,
    case
      when um.matter_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then um.matter_id_text::uuid
      else null
    end as matter_id,
    exists (select 1 from mapping_dupe_matter d where d.k = um.matter_id_text_norm) as duplicate_matter_id_in_file,
    exists (select 1 from mapping_dupe_target_ref d where d.k = um.new_official_case_no_norm) as duplicate_target_case_no_in_file
  from usable_mapping um
),
joined as (
  select
    n.*,
    m.id as db_matter_id,
    m.matter_type as db_matter_type,
    m.official_case_no as db_official_case_no,
    m.title as db_matter_title,
    m.updated_at as db_updated_at
  from normalized n
  left join public.matters m on m.id = n.matter_id
),
classified as (
  select
    j.*,
    (j.matter_id is null) as invalid_matter_id_format,
    (j.matter_id is not null and j.db_matter_id is null) as missing_matter_id,
    (j.db_matter_id is not null and lower(trim(coalesce(j.db_matter_type, ''))) <> 'litigation') as not_litigation_matter,
    (
      j.db_matter_id is not null
      and lower(trim(coalesce(j.db_official_case_no, ''))) <> lower(trim(coalesce(j.current_official_case_no, '')))
    ) as stale_current_case_no_mismatch,
    (
      j.db_matter_id is not null
      and (select not allow_non_temp_current from params)
      and lower(trim(coalesce(j.db_official_case_no, ''))) not like 'tmp-lit-%'
    ) as current_case_no_not_temp,
    exists (
      select 1
      from public.matters m2
      where m2.matter_type = 'litigation'
        and lower(trim(coalesce(m2.official_case_no, ''))) = lower(trim(coalesce(j.new_official_case_no, '')))
        and m2.id <> j.matter_id
    ) as target_case_no_conflict_in_db
  from joined j
)
select *
from classified;

drop table if exists pg_temp.step47_valid_rows;
create temporary table pg_temp.step47_valid_rows on commit drop as
select c.*
from pg_temp.step47_classified c
where not c.invalid_matter_id_format
  and not c.missing_matter_id
  and not c.not_litigation_matter
  and not c.stale_current_case_no_mismatch
  and not c.current_case_no_not_temp
  and not c.target_case_no_conflict_in_db
  and not c.duplicate_matter_id_in_file
  and not c.duplicate_target_case_no_in_file;

drop table if exists pg_temp.step47_updated;
create temporary table pg_temp.step47_updated on commit drop as
with updated as (
  update public.matters m
  set
    official_case_no = v.new_official_case_no,
    updated_at = now()
  from pg_temp.step47_valid_rows v
  where m.id = v.matter_id
    and lower(trim(coalesce(m.official_case_no, ''))) = lower(trim(coalesce(v.current_official_case_no, '')))
    and lower(trim(coalesce(m.official_case_no, ''))) is distinct from lower(trim(coalesce(v.new_official_case_no, '')))
  returning m.id
)
select id
from updated;

select
  (select count(*) from pg_temp.step47_mapping_rows where row_no > 0) as mapping_rows_total,
  (select count(*) from pg_temp.step47_classified) as mapping_rows_usable,
  (select count(*) from pg_temp.step47_classified where invalid_matter_id_format) as invalid_matter_id_rows,
  (select count(*) from pg_temp.step47_classified where missing_matter_id) as missing_matter_rows,
  (select count(*) from pg_temp.step47_classified where not_litigation_matter) as non_litigation_matter_rows,
  (select count(*) from pg_temp.step47_classified where duplicate_matter_id_in_file) as duplicate_matter_id_rows_in_file,
  (select count(*) from pg_temp.step47_classified where duplicate_target_case_no_in_file) as duplicate_target_case_no_rows_in_file,
  (select count(*) from pg_temp.step47_classified where stale_current_case_no_mismatch) as stale_current_case_no_rows,
  (select count(*) from pg_temp.step47_classified where current_case_no_not_temp) as current_case_no_not_temp_rows,
  (select count(*) from pg_temp.step47_classified where target_case_no_conflict_in_db) as target_case_no_conflict_rows,
  (select count(*) from pg_temp.step47_valid_rows) as valid_mapping_rows,
  (select count(*) from pg_temp.step47_updated) as matters_updated;

-- REVIEW 1: Invalid or missing matter IDs
select
  row_no,
  matter_id_text,
  current_official_case_no,
  new_official_case_no,
  account_title,
  matter_title,
  invalid_matter_id_format,
  missing_matter_id
from pg_temp.step47_classified
where invalid_matter_id_format or missing_matter_id
order by row_no;

-- REVIEW 2: File-level duplicate mapping rows
select
  row_no,
  matter_id_text,
  current_official_case_no,
  new_official_case_no,
  duplicate_matter_id_in_file,
  duplicate_target_case_no_in_file
from pg_temp.step47_classified
where duplicate_matter_id_in_file or duplicate_target_case_no_in_file
order by row_no;

-- REVIEW 3: Stale/current mismatch or non-temp current case numbers
select
  row_no,
  matter_id_text,
  current_official_case_no,
  db_official_case_no,
  new_official_case_no,
  stale_current_case_no_mismatch,
  current_case_no_not_temp,
  db_updated_at
from pg_temp.step47_classified
where stale_current_case_no_mismatch or current_case_no_not_temp
order by row_no;

-- REVIEW 4: Target conflicts in DB or non-litigation rows
select
  row_no,
  matter_id_text,
  current_official_case_no,
  new_official_case_no,
  db_matter_id,
  db_matter_type,
  db_matter_title,
  target_case_no_conflict_in_db,
  not_litigation_matter
from pg_temp.step47_classified
where target_case_no_conflict_in_db or not_litigation_matter
order by row_no;

commit;
"@
}

$rows = ParseMappingCsv -filePath $SourceFile
$sql = BuildSql -rows $rows -sourcePathText $SourceFile -allowNonTemp ([bool]$AllowNonTempCurrent)

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
Set-Content -Path $OutFile -Value $sql -Encoding UTF8

Write-Host "Generated $OutFile"
Write-Host ("MAPPING_ROWS=" + $rows.Count)
Write-Host ("ALLOW_NON_TEMP_CURRENT=" + ([bool]$AllowNonTempCurrent))
