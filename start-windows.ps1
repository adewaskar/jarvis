$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js não encontrado. Execute install-windows.ps1." }
if (-not (Test-Path (Join-Path $root "node_modules"))) { throw "Dependências ausentes. Execute install-windows.ps1." }

$env:JARVIS_BRIDGE_HOST = "127.0.0.1"
$env:PORT = "5173"
$logOut = Join-Path $env:TEMP "jarvis-startup.log"
$logErr = Join-Path $env:TEMP "jarvis-startup-error.log"
Remove-Item $logOut,$logErr -Force -ErrorAction SilentlyContinue
Write-Host "Iniciando JARVIS. Mantenha esta janela aberta; Ctrl+C encerra." -ForegroundColor Cyan

$browser = $null
foreach ($candidate in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe")) {
  if (Test-Path $candidate) { $browser = $candidate; break }
}
$process = Start-Process -FilePath (Get-Command node).Source -ArgumentList "scripts/start.mjs" -WorkingDirectory $root -PassThru -NoNewWindow -RedirectStandardOutput $logOut -RedirectStandardError $logErr
try {
  $deadline = (Get-Date).AddSeconds(90)
  $opened = $false
  while (-not $process.HasExited) {
    $recentOutput = @()
    if (Test-Path $logOut) {
      $recentOutput = @(Get-Content $logOut -Tail 25)
      $recentOutput | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path $logErr) { Get-Content $logErr -Tail 8 | ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
    if (-not $opened -and (Get-Date) -lt $deadline) {
      # Vite may select 5174-5199 if 5173 is already in use. Read the actual
      # local URL from Vite output rather than assuming the default port.
      $appUrl = $null
      foreach ($line in $recentOutput) {
        if ($line -match 'http://localhost:(\d+)') {
          $appUrl = "http://localhost:$($matches[1])"
          break
        }
      }
      if ($appUrl) {
        try {
          $response = Invoke-WebRequest -Uri $appUrl -TimeoutSec 2 -UseBasicParsing
          if ($response.StatusCode -eq 200) {
            if ($browser) { Start-Process -FilePath $browser -ArgumentList $appUrl } else { Start-Process $appUrl }
            $opened = $true
            Write-Host "JARVIS disponível no navegador: $appUrl" -ForegroundColor Green
          }
        } catch {}
      }
    }
    Start-Sleep -Seconds 2
    $process.Refresh()
  }
  if ($process.ExitCode -ne 0) { throw "JARVIS encerrou com código $($process.ExitCode). Consulte os logs acima." }
} finally {
  if (-not $process.HasExited) {
    # Terminate the complete Node/Vite/bridge process tree so no child is left behind.
    & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    Start-Sleep -Milliseconds 500
  }
}
