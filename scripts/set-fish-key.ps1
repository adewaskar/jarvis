# Save FISH_API_KEY into .env.local without echoing it.
#
# The prompt is masked, the key is never printed, and .env.local is gitignored
# (*.local), so it cannot be committed. Only the bridge reads it; the browser
# only ever sees VITE_ names.
#
#   powershell -ExecutionPolicy Bypass -File scripts\set-fish-key.ps1

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.local'

$secure = Read-Host 'Paste your Fish Audio API key (input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $key) { Write-Host 'No key entered; nothing changed.'; exit 1 }

$lines = @()
if (Test-Path $envFile) {
  $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*(export\s+)?FISH_API_KEY\s*=' })
}
$lines += "FISH_API_KEY=$key"
if (-not ($lines | Where-Object { $_ -match '^\s*(export\s+)?FISH_VOICE_ID\s*=\s*\S' })) {
  $lines += 'FISH_VOICE_ID=14129c3e320149449d6bada6862f7338'
}
# UTF-8 without a BOM: Node's env-file parser would read a BOM into the first name.
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
$key = $null

Write-Host "Saved FISH_API_KEY to .env.local (length hidden). Restart JARVIS to use it."
Write-Host 'Using the free model (s2.1-pro-free). Set FISH_MODEL in .env.local to choose a paid one.'
