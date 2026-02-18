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

function Add-Name([hashtable]$set, [string]$category, [string]$name) {
  $n = Clean $name
  if (-not $n) { return }
  if ($n -match "^(x|seq|client|clients|company|date|total|status)$") { return }
  if ($n -match "(?i)^total amount$") { return }
  if ($n -match "(?i)^system\.xml\.xmlelement$") { return }

  $key = ($category + "|" + $n.ToLowerInvariant())
  if (-not $set.ContainsKey($key)) {
    $set[$key] = [pscustomobject]@{
      title = $n
      category = $category
    }
  }
}

function Parse-RetainerCsvNames([hashtable]$set) {
  $baseDir = "C:\Users\kevin\Documents\Work\Delloro Saulog\All things"
  $files = Get-ChildItem -Path $baseDir -Filter "DSLAW RETAINER2026 - *.csv" -File
  foreach ($f in $files) {
    try {
      $rows = Import-Csv -Path $f.FullName
    } catch {
      continue
    }
    $isSummaryList = $f.Name -match "SUMMARY LIST"
    foreach ($r in $rows) {
      if ($isSummaryList) {
        Add-Name $set "retainer" ([string]$r.COMPANY)
        continue
      }
      Add-Name $set "retainer" ([string]$r.CLIENT)
      Add-Name $set "retainer" ([string]$r.CLIENTS)
      Add-Name $set "retainer" ([string]$r.COMPANY)
    }
  }
}

function Parse-SqlValuesClientNames([hashtable]$set, [string]$path, [string]$category) {
  if (-not (Test-Path $path)) { return }
  $text = Get-Content -Raw -Path $path
  $rx = [regex]"(?m)\(\s*\d+\s*,\s*'((?:''|[^'])*)'\s*,"
  foreach ($m in $rx.Matches($text)) {
    $name = $m.Groups[1].Value -replace "''", "'"
    Add-Name $set $category $name
  }
}

function Build-Sql([object[]]$items) {
  $vals = @()
  $i = 1
  foreach ($x in $items) {
    $vals += "    (" + $i + ", " + (SqlQuote $x.title) + ", " + (SqlQuote $x.category) + ")"
    $i++
  }
  $valuesBlock = ($vals -join ",`r`n")

  return @"
-- STEP 13: Seed missing accounts from Retainer/Litigation/Special sources
-- Source files: Retainer CSV batch + existing sync SQL (10/12)
-- Parsed accounts: $($items.Count)
-- Safe to re-run.

begin;

with source_accounts (
  row_no,
  title,
  category
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
inserted as (
  insert into public.accounts (title, category, status, created_by, notes)
  select
    s.title,
    s.category,
    'active',
    a.actor_id,
    'seeded from source import'
  from source_accounts s
  cross join actor a
  where not exists (
    select 1
    from public.accounts acc
    where lower(trim(coalesce(acc.title,''))) = lower(trim(s.title))
      and lower(trim(coalesce(acc.category,''))) = lower(trim(s.category))
  )
  returning id
),
target_accounts as (
  select acc.id
  from public.accounts acc
  join source_accounts s
    on lower(trim(coalesce(acc.title,''))) = lower(trim(s.title))
   and lower(trim(coalesce(acc.category,''))) = lower(trim(s.category))
),
inserted_members as (
  insert into public.account_members (account_id, user_id)
  select ta.id, a.actor_id
  from target_accounts ta
  cross join actor a
  where not exists (
    select 1 from public.account_members am
    where am.account_id = ta.id
      and am.user_id = a.actor_id
  )
  returning account_id
)
select
  (select count(*) from source_accounts) as source_accounts_count,
  (select count(*) from inserted) as accounts_created,
  (select count(*) from inserted_members) as memberships_created;

commit;
"@
}

$set = @{}
Parse-RetainerCsvNames $set
Parse-SqlValuesClientNames $set "sql\10_sync_litigation_tracker_rows.sql" "litigation"
Parse-SqlValuesClientNames $set "sql\12_sync_special_project_rows.sql" "special_project"

$items = $set.Values |
  Sort-Object category, title

$sql = Build-Sql $items
Set-Content -Path "sql\\13_seed_accounts_from_sources.sql" -Value $sql -Encoding UTF8

Write-Output ("ACCOUNT_SEEDS=" + $items.Count)
