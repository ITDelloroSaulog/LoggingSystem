param(
  [string]$SourceDir = "C:\Users\kevin\Documents\Work\Delloro Saulog\2nd Special Project",
  [string]$OutSql = "sql\31_sync_special_project_cost_setup_batch2.sql",
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

function NormalizeDateForSql([string]$raw) {
  $iso = ParseDateToIso $raw
  if (-not $iso) { return Clean $raw }
  return ([datetime]::ParseExact($iso, "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)).ToString("d-MMM-yy", [System.Globalization.CultureInfo]::InvariantCulture)
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
  if ($null -eq $row) { return "" }
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

# Optional summary map (if available)
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
    if (-not $client) { continue }
    $k = Norm $client
    if (-not $summaryMap.ContainsKey($k)) {
      $summaryMap[$k] = [pscustomobject]@{
        special_code = if ($tracker) { $tracker } else { BuildCode ("SP-" + $client + "-" + $seq) }
        title = if ($desc) { $desc } else { "Special Project Engagement" }
      }
    }
  }
}

$rawRows = @()
foreach ($f in $files) {
  if ($f.Name -match "(?i)SUMMARY\.csv$|EMAIL\.csv$|WEEKLY ACT") { continue }

  $lines = Get-Content -Path $f.FullName
  $clientFromLine = ""
  $engagementFromLine = ""
  foreach ($line in $lines) {
    $c = Clean $line
    if (-not $clientFromLine -and $c -match "(?i)^""?CLIENT:\s*(.+?)""?$") { $clientFromLine = (Clean $matches[1]).Trim(",") }
    if (-not $engagementFromLine -and $c -match "(?i)^""?TYPE OF ENGAGEMENT:\s*(.+?)""?$") { $engagementFromLine = (Clean $matches[1]).Trim(",") }
  }

  $headerRows = ImportFromHeader $f.FullName { param($line) $line -like "seq.,handling lawyer,date of engagement,*" }
  $head = $null
  foreach ($r in $headerRows) {
    $seq = Clean (GetField $r @("Seq.","Seq"))
    if ($seq -match "^\d+$") { $head = $r; break }
  }
  if ($null -eq $head -and $headerRows.Count -gt 0) { $head = $headerRows[0] }

  $client = if ($clientFromLine) { $clientFromLine } else { Clean (GetField $head @("Client","CLIENT")) }
  if (-not $client) { continue }

  $clientKey = Norm $client
  $mapped = if ($summaryMap.ContainsKey($clientKey)) { $summaryMap[$clientKey] } else { $null }
  $fileCode = BuildCode (($f.Name -replace "(?i)^SPECIAL PROJECT 2026 - ", "" -replace "(?i)\.csv$", ""))
  $specialCode = if ($mapped) { $mapped.special_code } else { $fileCode }
  $specialCode = BuildCode $specialCode
  if (-not $specialCode) { continue }
  if ($excludeCodeSet.ContainsKey($specialCode)) { continue }

  $engagement = if ($mapped -and (Clean $mapped.title)) { Clean $mapped.title } elseif ($engagementFromLine) { $engagementFromLine } else { "Special Project Engagement" }
  $openedRaw = NormalizeDateForSql (GetField $head @("Date of Engagement","DATE OF ENGAGEMENT"))
  $handling = Clean (GetField $head @("Handling Lawyer","Handling Lawyer/Staff"))
  $af = Clean (GetField $head @("Acceptance Fee/Professional Fee","Acceptance Fee"))
  $ope = Clean (GetField $head @("OPE"))
  $tech = Clean (GetField $head @("Tech Fee / Admin Fee","Tech Fee/Admin Fee","Tech Fee"))
  $major = Clean (GetField $head @("Major Pleading"))
  $minor = Clean (GetField $head @("Minor Pleading"))
  $appPartner = Clean (GetField $head @("Appearance (Partner)","Appearance Partner"))
  $appAssoc = Clean (GetField $head @("Appearance (Associate)","Appearance Associate"))
  $success = Clean (GetField $head @("Success Fee"))

  $rawRows += [pscustomobject]@{
    source_file = $f.Name
    special_code = $specialCode
    client_name = $client
    engagement_description = $engagement
    opened_on_text = $openedRaw
    handling_token = $handling
    af_raw = $af
    ope_raw = $ope
    tech_raw = $tech
    major_raw = $major
    minor_raw = $minor
    appearance_partner_raw = $appPartner
    appearance_associate_raw = $appAssoc
    success_fee_raw = $success
  }
}

$rows = @($rawRows)

# Best practice: do not collapse multiple retainers that happen to share one special_code.
# When one code appears across different files, assign deterministic suffixed codes per file.
$collisionRemaps = @()
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
  if ($fileGroups.Count -le 1) { continue }
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

$rows = @($rows | Sort-Object special_code, source_file)

$vals = @()
foreach ($r in $rows) {
  $openedSql = if (Clean $r.opened_on_text) { SqlQuote $r.opened_on_text } else { "null" }
  $handlingSql = if (Clean $r.handling_token) { SqlQuote $r.handling_token } else { "null" }
  $afSql = if (Clean $r.af_raw) { SqlQuote $r.af_raw } else { "null" }
  $opeSql = if (Clean $r.ope_raw) { SqlQuote $r.ope_raw } else { "null" }
  $techSql = if (Clean $r.tech_raw) { SqlQuote $r.tech_raw } else { "null" }
  $majorSql = if (Clean $r.major_raw) { SqlQuote $r.major_raw } else { "null" }
  $minorSql = if (Clean $r.minor_raw) { SqlQuote $r.minor_raw } else { "null" }
  $appPartnerSql = if (Clean $r.appearance_partner_raw) { SqlQuote $r.appearance_partner_raw } else { "null" }
  $appAssocSql = if (Clean $r.appearance_associate_raw) { SqlQuote $r.appearance_associate_raw } else { "null" }
  $successSql = if (Clean $r.success_fee_raw) { SqlQuote $r.success_fee_raw } else { "null" }

  $vals += "    (" +
    (SqlQuote $r.source_file) + ", " +
    (SqlQuote $r.special_code) + ", " +
    (SqlQuote $r.client_name) + ", " +
    (SqlQuote $r.engagement_description) + ", " +
    $openedSql + ", " +
    $handlingSql + ", " +
    $afSql + ", " +
    $opeSql + ", " +
    $techSql + ", " +
    $majorSql + ", " +
    $minorSql + ", " +
    $appPartnerSql + ", " +
    $appAssocSql + ", " +
    $successSql +
  ")"
}

$valuesBlock = if ($vals.Count) { $vals -join ",`r`n" } else {
  "    (null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text)"
}

$sql = @"
-- STEP 31: Sync Special Project cost setup rows (header block) into matters + matter_rate_overrides
-- Source folder: $SourceDir
-- Parsed cost rows: $($rows.Count)
-- Safe to re-run.

begin;

with source_cost_rows (
  source_file,
  special_code,
  client_name,
  engagement_description,
  opened_on_text,
  handling_token,
  af_raw,
  ope_raw,
  tech_raw,
  major_raw,
  minor_raw,
  appearance_partner_raw,
  appearance_associate_raw,
  success_fee_raw
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
    'special_project',
    'active',
    a.actor_id,
    case
      when upper(s.client_name) similar to '%( INC| INC\\.| CORP| CORP\\.| CORPORATION| LTD| LTD\\.| HOLDINGS| COMPANY| CO\\.)%'
        then 'company'
      else 'personal'
    end,
    false
  from source_cost_rows s
  cross join actor a
  where not exists (
    select 1
    from public.accounts acc
    where public.norm_key(acc.title) = public.norm_key(s.client_name)
      and lower(trim(coalesce(acc.category, ''))) = 'special_project'
  )
  returning id
),
target_accounts as (
  select distinct on (public.norm_key(acc.title))
    acc.id,
    acc.title,
    coalesce(acc.account_kind, 'personal') as account_kind
  from public.accounts acc
  where lower(trim(coalesce(acc.category, ''))) = 'special_project'
    and public.norm_key(acc.title) in (
      select public.norm_key(s.client_name)
      from source_cost_rows s
    )
  order by public.norm_key(acc.title), acc.created_at asc nulls last, acc.id
),
seed as (
  select
    s.special_code,
    s.client_name,
    s.engagement_description,
    s.opened_on_text,
    s.handling_token
  from source_cost_rows s
  where nullif(trim(coalesce(s.special_code, '')), '') is not null
),
resolved_seed as (
  select
    sd.*,
    ta.id as account_id,
    ta.account_kind,
    ta.title as account_title,
    coalesce(
      (
        select p.id
        from public.profiles p
        where lower(trim(coalesce(p.email, ''))) = lower(trim(coalesce(sd.handling_token, '')))
           or lower(trim(coalesce(p.full_name, ''))) = lower(trim(coalesce(sd.handling_token, '')))
        limit 1
      ),
      (select lawyer_id from default_lawyer)
    ) as handling_lawyer_id,
    case
      when trim(coalesce(sd.opened_on_text, '')) ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$'
        then to_date(trim(sd.opened_on_text), 'DD-Mon-YY')
      else null
    end as opened_on
  from seed sd
  join target_accounts ta on public.norm_key(ta.title) = public.norm_key(sd.client_name)
),
up_matter as (
  update public.matters m
  set
    account_id = rs.account_id,
    title = coalesce(nullif(trim(rs.engagement_description), ''), m.title),
    opened_at = coalesce(rs.opened_on, m.opened_at),
    handling_lawyer_id = coalesce(rs.handling_lawyer_id, m.handling_lawyer_id),
    company_name = case when rs.account_kind = 'company' then rs.account_title else m.company_name end,
    personal_name = case when rs.account_kind = 'personal' then rs.account_title else m.personal_name end,
    engagement_description = coalesce(nullif(trim(rs.engagement_description), ''), m.engagement_description),
    updated_at = now()
  from resolved_seed rs
  where m.matter_type = 'special_project'
    and lower(trim(coalesce(m.special_engagement_code, ''))) = lower(trim(rs.special_code))
  returning m.id
),
ins_matter as (
  insert into public.matters (
    account_id,
    matter_type,
    title,
    status,
    handling_lawyer_id,
    opened_at,
    created_by,
    special_engagement_code,
    company_name,
    personal_name,
    engagement_description
  )
  select
    rs.account_id,
    'special_project',
    coalesce(nullif(trim(rs.engagement_description), ''), 'Special Project Engagement'),
    'active',
    rs.handling_lawyer_id,
    rs.opened_on,
    (select actor_id from actor),
    rs.special_code,
    case when rs.account_kind = 'company' then rs.account_title else null end,
    case when rs.account_kind = 'personal' then rs.account_title else null end,
    nullif(trim(rs.engagement_description), '')
  from resolved_seed rs
  where not exists (
    select 1
    from public.matters m
    where m.matter_type = 'special_project'
      and lower(trim(coalesce(m.special_engagement_code, ''))) = lower(trim(rs.special_code))
  )
  returning id
),
target_matters as (
  select
    m.id as matter_id,
    lower(trim(m.special_engagement_code)) as special_code_norm
  from public.matters m
  where m.matter_type = 'special_project'
    and lower(trim(coalesce(m.special_engagement_code, ''))) in (
      select lower(trim(s.special_code))
      from source_cost_rows s
    )
),
rate_rows as (
  select
    tm.matter_id,
    r.rate_code,
    r.raw_value
  from source_cost_rows s
  join target_matters tm on tm.special_code_norm = lower(trim(s.special_code))
  cross join lateral (
    values
      ('AF', s.af_raw),
      ('OPE', s.ope_raw),
      ('TECH', s.tech_raw),
      ('PLEADING_MAJOR', s.major_raw),
      ('PLEADING_MINOR', s.minor_raw),
      ('APPEARANCE_PARTNER', s.appearance_partner_raw),
      ('APPEARANCE_ASSOCIATE', s.appearance_associate_raw),
      ('SUCCESS_FEE_PERCENT', s.success_fee_raw)
  ) as r(rate_code, raw_value)
),
parsed_rates as (
  select
    rr.matter_id,
    rr.rate_code,
    rr.raw_value,
    case
      when nullif(trim(coalesce(rr.raw_value, '')), '') is null then null
      when nullif(regexp_replace(rr.raw_value, '[^0-9.]+', '', 'g'), '') ~ '^[0-9]+([.][0-9]+)?$'
        then nullif(regexp_replace(rr.raw_value, '[^0-9.]+', '', 'g'), '')::numeric
      else null
    end as override_amount
  from rate_rows rr
),
valid_rates as (
  select
    pr.matter_id,
    pr.rate_code,
    pr.override_amount
  from parsed_rates pr
  where pr.override_amount is not null
),
up_rates as (
  update public.matter_rate_overrides mro
  set
    override_amount = vr.override_amount,
    active = true,
    updated_at = now(),
    created_by = coalesce(mro.created_by, (select actor_id from actor))
  from valid_rates vr
  where mro.matter_id = vr.matter_id
    and mro.active = true
    and lower(trim(mro.rate_code)) = lower(trim(vr.rate_code))
    and mro.override_amount is distinct from vr.override_amount
  returning mro.id
),
ins_rates as (
  insert into public.matter_rate_overrides (
    matter_id,
    rate_code,
    override_amount,
    active,
    created_by
  )
  select
    vr.matter_id,
    vr.rate_code,
    vr.override_amount,
    true,
    (select actor_id from actor)
  from valid_rates vr
  where not exists (
    select 1
    from public.matter_rate_overrides mro
    where mro.matter_id = vr.matter_id
      and mro.active = true
      and lower(trim(mro.rate_code)) = lower(trim(vr.rate_code))
  )
  returning id
)
select
  (select count(*) from source_cost_rows) as source_rows_count,
  (select count(*) from ensure_accounts) as accounts_created,
  (select count(*) from up_matter) as matters_updated,
  (select count(*) from ins_matter) as matters_inserted,
  (select count(*) from valid_rates) as valid_rate_rows,
  (select count(*) from up_rates) as rates_updated,
  (select count(*) from ins_rates) as rates_inserted;

commit;
"@

Set-Content -Path $OutSql -Value $sql -Encoding UTF8

Write-Output ("FILES_SCANNED={0}" -f $files.Count)
Write-Output ("COST_ROWS_RAW={0}" -f $rawRows.Count)
Write-Output ("COST_ROWS_FINAL={0}" -f $rows.Count)
if ($ExcludeSpecialCodes.Count -gt 0) {
  Write-Output ("EXCLUDED_CODES={0}" -f (($ExcludeSpecialCodes | ForEach-Object { BuildCode $_ }) -join ","))
}
if ($collisionRemaps.Count -gt 0) {
  foreach ($m in ($collisionRemaps | Sort-Object base_code, source_file)) {
    Write-Output ("SPECIAL_CODE_REMAP={0}|{1}|{2}|rows={3}" -f $m.base_code, $m.source_file, $m.remapped_code, $m.row_count)
  }
}
Write-Output ("OUTPUT_SQL={0}" -f ([System.IO.Path]::GetFullPath($OutSql)))
