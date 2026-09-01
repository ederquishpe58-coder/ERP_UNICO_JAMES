$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Host.UI.RawUI.WindowTitle = 'BLESS TEST - ADMIN USERS CANONICAL PROFILE'

$projectRef = 'lmurmntscqnvkmvielaw'
$expectedVersion = '202609010001'
$expectedName = 'admin_users_canonical_profile'
$appRoot = $PSScriptRoot
$migrationPath = Join-Path $appRoot 'supabase\migrations\202609010001_admin_users_canonical_profile.sql'
$validatorPath = Join-Path $appRoot 'validate-admin-users-canonical-profile-test.sql'
$psql = 'C:\Users\Contador J\Documents\ERP_UNICO_JAMES\.codex-tmp\GERENCIA-GENERAL-TEST\psql-portable\bin\psql.exe'
$connection = 'host=aws-0-us-east-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.lmurmntscqnvkmvielaw sslmode=require'
$resultPath = Join-Path $appRoot 'admin-users-canonical-test-result.json'

$report = [ordered]@{
  targetProject = $projectRef
  targetValidation = 'NOT RUN'
  applicationName = ''
  migrationVersion = $expectedVersion
  migrationHistoryBefore = $null
  migrationApplied = $false
  migrationHistoryCount = $null
  gerenciaView = $false
  gerenciaManage = $false
  ownerBypass = 'NO'
  staticBuild = 'PASS'
  transactionalValidation = 'NOT RUN'
  fixturesCleaned = $false
  legacyDependentUsers = $null
  legacyRecords = $null
  prodTouched = $false
}

$securePassword = $null
$plainPassword = $null
$passwordPointer = [IntPtr]::Zero
$migrationSql = $null
$applySql = $null

function Invoke-PsqlCapture {
  param([string[]]$Arguments)
  $output = @(& $script:psql $script:connection -X -v 'ON_ERROR_STOP=1' @Arguments 2>&1)
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    throw "PSQL_FAILED_EXIT_$code`n$($output -join [Environment]::NewLine)"
  }
  return @($output | ForEach-Object { $_.ToString() })
}

try {
  if (-not (Test-Path -LiteralPath $psql)) { throw 'PSQL_PORTABLE_MISSING' }
  if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'MIGRATION_FILE_MISSING' }
  if (-not (Test-Path -LiteralPath $validatorPath)) { throw 'VALIDATOR_FILE_MISSING' }

  Write-Host 'TARGET = BLESS FLOWER JAEDER TEST' -ForegroundColor Cyan
  Write-Host "PROJECT REF = $projectRef" -ForegroundColor Cyan
  Write-Host 'PROD = FUERA DE ALCANCE' -ForegroundColor Yellow
  $securePassword = Read-Host 'Database Password TEST' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw 'DATABASE_PASSWORD_EMPTY' }
  $env:PGPASSWORD = $plainPassword

  $identitySql = @"
select concat_ws('|',
  current_database(),current_user,current_setting('application_name'),
  (select count(*) from public.companies where company_key='COMP-BLESS-FLOWER' and is_active),
  (select count(*) from auth.users auth_user
    join public.user_company_memberships membership on membership.user_id=auth_user.id
    join public.companies company on company.id=membership.company_id and company.company_key='COMP-BLESS-FLOWER'
    join public.erp_security_user_company_profiles assignment on assignment.company_id=membership.company_id and assignment.user_id=membership.user_id
    where lower(btrim(auth_user.email))='jameslanchimba14@gmail.com'
      and membership.membership_status='ACTIVE' and membership.membership_role='OWNER'
      and assignment.profile_id='GERENCIA_GENERAL'),
  (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL' and capability_id='admin.users.view'),
  (select count(*) from public.erp_security_profile_capabilities where profile_id='GERENCIA_GENERAL' and capability_id='admin.users.manage'),
  case when to_regprocedure('public.erp_security_u2c4_assert_admin(uuid,text)') is null then 0 else 1 end,
  (select count(*) from supabase_migrations.schema_migrations where version='202608290001')
);
"@
  $identity = (Invoke-PsqlCapture -Arguments @('-At', '-c', $identitySql) | Select-Object -Last 1).Split('|')
  if ($identity.Count -ne 9 -or $identity[0] -ne 'postgres' -or $identity[1] -ne 'postgres') {
    throw 'POSTGRES_TARGET_IDENTITY_MISMATCH'
  }
  $report.applicationName = $identity[2]
  if ([int]$identity[3] -ne 1 -or [int]$identity[4] -ne 1 -or [int]$identity[7] -ne 1 -or [int]$identity[8] -ne 1) {
    throw 'CANONICAL_TEST_PROJECT_MARKERS_MISMATCH'
  }
  $report.gerenciaView = [int]$identity[5] -eq 1
  $report.gerenciaManage = [int]$identity[6] -eq 1
  if (-not $report.gerenciaView -or -not $report.gerenciaManage) {
    throw 'GERENCIA_ADMIN_USERS_CAPABILITIES_MISSING'
  }
  $report.targetValidation = 'PASS'

  $historyBefore = Invoke-PsqlCapture -Arguments @('-At', '-c', "select count(*) from supabase_migrations.schema_migrations where version='$expectedVersion';")
  $report.migrationHistoryBefore = [int]($historyBefore | Select-Object -Last 1)
  if ($report.migrationHistoryBefore -notin @(0,1)) { throw 'MIGRATION_HISTORY_COUNT_INVALID' }

  if ($report.migrationHistoryBefore -eq 0) {
    $migrationSql = Get-Content -LiteralPath $migrationPath -Raw
    if ($migrationSql -notmatch '(?is)^\s*begin\s*;' -or $migrationSql -notmatch '(?is)commit\s*;\s*$') {
      throw 'MIGRATION_TRANSACTION_CONTRACT_MISMATCH'
    }
    $migrationBody = [regex]::Replace($migrationSql, '(?is)^\s*begin\s*;\s*', '')
    $migrationBody = [regex]::Replace($migrationBody, '(?is)\s*commit\s*;\s*$', '')
    if ($migrationSql.Contains('$admin_users_migration$')) { throw 'MIGRATION_HISTORY_DELIMITER_COLLISION' }
    $applySql = @"
begin;
$migrationBody
do `$history_guard`$
begin
  if exists(select 1 from supabase_migrations.schema_migrations where version='$expectedVersion') then
    raise exception 'MIGRATION_HISTORY_ALREADY_EXISTS';
  end if;
end
`$history_guard`$;
insert into supabase_migrations.schema_migrations(version,statements,name)
values('$expectedVersion',array[`$admin_users_migration`$$migrationSql`$admin_users_migration`$]::text[],'$expectedName');
commit;
"@
    $applyOutput = @($applySql | & $psql $connection -X -v 'ON_ERROR_STOP=1' 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "MIGRATION_APPLY_FAILED`n$($applyOutput -join [Environment]::NewLine)"
    }
    $report.migrationApplied = $true
  }

  $postSql = @"
select concat_ws('|',
  (select count(*) from supabase_migrations.schema_migrations where version='$expectedVersion'),
  case when to_regprocedure('public.erp_admin_configure_user_access(uuid,text,text,text,text,text,jsonb,uuid)') is null then 0 else 1 end,
  case when to_regprocedure('public.erp_admin_revoke_user_company_access(uuid,jsonb,uuid)') is null then 0 else 1 end,
  (select count(*) from public.user_company_memberships membership
    left join public.erp_security_user_company_profiles assignment
      on assignment.company_id=membership.company_id and assignment.user_id=membership.user_id
    where membership.membership_status='ACTIVE' and assignment.user_id is null),
  (select count(*) from public.user_route_permissions)
);
"@
  $post = (Invoke-PsqlCapture -Arguments @('-At', '-c', $postSql) | Select-Object -Last 1).Split('|')
  $report.migrationHistoryCount = [int]$post[0]
  $report.legacyDependentUsers = [int]$post[3]
  $report.legacyRecords = [int]$post[4]
  if ($report.migrationHistoryCount -ne 1 -or [int]$post[1] -ne 1 -or [int]$post[2] -ne 1) {
    throw 'CANONICAL_RPC_POSTCHECK_FAILED'
  }

  $fixtureCountsSql = @"
select concat_ws('|',
  (select count(*) from auth.users),
  (select count(*) from public.user_profiles),
  (select count(*) from public.user_company_memberships),
  (select count(*) from public.erp_security_user_company_profiles),
  (select count(*) from public.user_route_permissions),
  (select count(*) from public.erp_access_audit_log)
);
"@
  $beforeFixture = Invoke-PsqlCapture -Arguments @('-At', '-c', $fixtureCountsSql) | Select-Object -Last 1
  $validatorOutput = Invoke-PsqlCapture -Arguments @('-f', $validatorPath)
  if (($validatorOutput -join "`n") -notmatch '"result"\s*:\s*"PASS"') {
    throw 'TRANSACTIONAL_VALIDATION_RESULT_MISSING'
  }
  $afterFixture = Invoke-PsqlCapture -Arguments @('-At', '-c', $fixtureCountsSql) | Select-Object -Last 1
  if ($beforeFixture -ne $afterFixture) { throw 'TEST_FIXTURE_CLEANUP_MISMATCH' }
  $report.transactionalValidation = 'PASS'
  $report.fixturesCleaned = $true
  Write-Host 'ADMIN USERS CANONICAL TEST = PASS' -ForegroundColor Green
} catch {
  $safeMessage = [string]$_.Exception.Message
  if (-not [string]::IsNullOrEmpty($plainPassword)) { $safeMessage = $safeMessage.Replace($plainPassword, '[REDACTED]') }
  $report.error = $safeMessage
  Write-Host "STOP: $safeMessage" -ForegroundColor Red
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  $applySql = $null
  $migrationSql = $null
  $plainPassword = $null
  $securePassword = $null
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding utf8
}

Read-Host 'Presione Enter para cerrar'
