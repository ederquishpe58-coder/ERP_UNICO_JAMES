param(
  [switch]$TransmitirSriTest
)

$ErrorActionPreference = "Stop"

$blessP12 = "E:\xlm declaraciones\02 JOSE LANCHIMBA\Semestre 2026\PRIMER SEMESTRE\MANUEL CLEMENTE LANCHIMBA TUTILLO 1717637084-280324133625.p12"
$imperioP12 = "E:\XML BORRADOR BLESS\SANDY ANAHI LANCHIMBA TIPANLUISA 1727970137-190625114031.p12"

if (-not (Test-Path -LiteralPath $blessP12)) {
  throw "No se encontro el certificado P12 de Bless Flower."
}
if (-not (Test-Path -LiteralPath $imperioP12)) {
  throw "No se encontro el certificado P12 de Imperio Flowers."
}

$blessSecret = Read-Host "Contrasena P12 de Bless Flower" -AsSecureString
$imperioSecret = Read-Host "Contrasena P12 de Imperio Flowers" -AsSecureString
$blessPassword = [System.Net.NetworkCredential]::new("", $blessSecret).Password
$imperioPassword = [System.Net.NetworkCredential]::new("", $imperioSecret).Password

try {
  $env:SRI_P12_PATH_BLESS = $blessP12
  $env:SRI_P12_PATH_IMPERIO = $imperioP12
  $env:SRI_P12_PASSWORD_BLESS = $blessPassword
  $env:SRI_P12_PASSWORD_IMPERIO = $imperioPassword
  $env:SRI_TEST_TRANSMIT = if ($TransmitirSriTest) { "1" } else { "0" }

  node scripts/services/sri/validate-sri-secure-signatures.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "La validacion local de certificados o firma SRI fallo."
  }
} finally {
  Remove-Item Env:SRI_P12_PATH_BLESS -ErrorAction SilentlyContinue
  Remove-Item Env:SRI_P12_PATH_IMPERIO -ErrorAction SilentlyContinue
  Remove-Item Env:SRI_P12_PASSWORD_BLESS -ErrorAction SilentlyContinue
  Remove-Item Env:SRI_P12_PASSWORD_IMPERIO -ErrorAction SilentlyContinue
  Remove-Item Env:SRI_TEST_TRANSMIT -ErrorAction SilentlyContinue
  $blessPassword = $null
  $imperioPassword = $null
}
