param(
  [Parameter(Mandatory=$true)]
  [string]$BackupPath
)

$env:DB_TYPE = "postgres"
$env:DB_PORT = "5432"
$env:DB_DATABASE = "postgres"
$env:DB_SSL = "true"
$env:DB_SSL_REJECT_UNAUTHORIZED = "false"

if (-not $env:DB_HOST) {
  $env:DB_HOST = Read-Host "Host do Supabase"
}

if (-not $env:DB_USER) {
  $env:DB_USER = Read-Host "Usuario do banco Supabase"
}

if (-not $env:DB_PASSWORD) {
  $securePassword = Read-Host "Senha do banco Supabase" -AsSecureString
  $env:DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  )
}

node scripts\restore-json.js $BackupPath
