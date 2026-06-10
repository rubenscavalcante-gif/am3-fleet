param(
  [string]$AdminEmail = "",
  [switch]$Force
)

$env:DB_TYPE = "postgres"
$env:DB_PORT = "5432"
$env:DB_DATABASE = "postgres"
$env:DB_SSL = "true"
$env:DB_SSL_REJECT_UNAUTHORIZED = "false"

if (-not $env:DB_HOST) {
  $env:DB_HOST = "aws-1-sa-east-1.pooler.supabase.com"
}

if (-not $env:DB_USER) {
  $env:DB_USER = "postgres.tmcdslecowxoztikmdbp"
}

if (-not $env:DB_PASSWORD) {
  $securePassword = Read-Host "Senha do banco Supabase" -AsSecureString
  $env:DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  )
}

if (-not $env:FLEETDESK_BACKUP_DIR) {
  $env:FLEETDESK_BACKUP_DIR = Join-Path (Get-Location) "backups"
}

$arguments = @("scripts\reset-operational-data.js")

if ($AdminEmail) {
  $arguments += "--admin-email=$AdminEmail"
}

if ($Force) {
  $arguments += "--force"
} else {
  $arguments += "--dry-run"
}

node $arguments
