param(
  [ValidateSet("qwen3-vl:2b", "qwen3-vl:4b")]
  [string]$Model = "qwen3-vl:4b"
)
$ErrorActionPreference = "Stop"

function Resolve-OllamaPath {
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
  )
  foreach ($candidate in $candidates) { if (Test-Path $candidate) { return $candidate } }
  return $null
}

Write-Host ""
Write-Host "J.A.R.V.I.S. — configuração da IA local" -ForegroundColor Cyan
Write-Host "Ollama executa o modelo neste computador; não usa o limite do plano Claude."
Write-Host "Modelo padrão: qwen3-vl:4b (aprox. 3,3 GB). Alternativa menor: qwen3-vl:2b (aprox. 1,9 GB)."
Write-Host ""
if (-not $PSBoundParameters.ContainsKey("Model")) {
  Write-Host "1 - qwen3-vl:4b (melhor equilíbrio; 3,3 GB)"
  Write-Host "2 - qwen3-vl:2b (menor e mais leve; 1,9 GB)"
  $selection = Read-Host "Escolha o modelo (Enter = 1)"
  if ($selection -eq "2") { $Model = "qwen3-vl:2b" }
}

$ollama = Resolve-OllamaPath
if (-not $ollama) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget não está disponível. Instale Ollama pelo instalador oficial: https://ollama.com/download/windows"
  }
  Write-Host "Instalando Ollama para Windows via winget..." -ForegroundColor Yellow
  winget install --id Ollama.Ollama --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "A instalação do Ollama falhou (código $LASTEXITCODE)." }
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  $ollama = Resolve-OllamaPath
}
if (-not $ollama) { throw "Ollama foi instalado, mas ollama.exe não foi encontrado. Reinicie o Windows e tente novamente." }

# Qwen3-VL needs Ollama 0.12.7 or newer.
$versionText = (& $ollama --version 2>&1 | Out-String)
$versionMatch = [regex]::Match($versionText, '(\d+\.\d+\.\d+)')
if (-not $versionMatch.Success) {
  throw "Não foi possível identificar a versão do Ollama. Atualize pelo instalador oficial: https://ollama.com/download/windows"
}
$ollamaVersion = [version]$versionMatch.Groups[1].Value
if ($ollamaVersion -lt [version]"0.12.7") {
  Write-Host "Atualizando Ollama: Qwen3-VL precisa da versão 0.12.7 ou mais recente." -ForegroundColor Yellow
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Atualize o Ollama pelo instalador oficial: https://ollama.com/download/windows"
  }
  winget upgrade --id Ollama.Ollama --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "Atualize o Ollama para 0.12.7+ pelo instalador oficial: https://ollama.com/download/windows" }
  $ollama = Resolve-OllamaPath
  $versionText = (& $ollama --version 2>&1 | Out-String)
  $versionMatch = [regex]::Match($versionText, '(\d+\.\d+\.\d+)')
  if (-not $versionMatch.Success -or [version]$versionMatch.Groups[1].Value -lt [version]"0.12.7") {
    throw "Ollama 0.12.7+ ainda não está disponível. Reinicie o Windows e tente novamente."
  }
}

# The desktop app normally starts the local service. Start it when this helper
# is run before the first JARVIS launch.
try {
  & $ollama list *> $null
} catch {}
if ($LASTEXITCODE -ne 0) {
  Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    & $ollama list *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  }
  if (-not $ready) { throw "Ollama não iniciou. Abra o aplicativo Ollama e execute este assistente novamente." }
}

Write-Host ""
Write-Host "Baixando $Model. O download pode ocupar alguns GB e levar algum tempo." -ForegroundColor Yellow
& $ollama pull $Model
if ($LASTEXITCODE -ne 0) { throw "O download do modelo falhou (código $LASTEXITCODE). Confira a conexão e o espaço em disco." }

# Switch to local-first mode while preserving a previously configured cloud
# provider as the automatic fallback when it has a complete API configuration.
$folder = Join-Path $HOME ".jarvis"
$file = Join-Path $folder "provider.json"
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$settings = @{}
if (Test-Path $file) {
  try {
    $existing = Get-Content $file -Raw | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) { $settings[$property.Name] = $property.Value }
  } catch { $settings = @{} }
}
$currentProvider = [string]$settings.provider
if ($currentProvider -and $currentProvider -notin @("auto", "ollama", "claude") -and $settings.apiKey -and $settings.model -and $settings.baseUrl) {
  $settings.fallback = @{
    provider = $currentProvider
    model = [string]$settings.model
    baseUrl = [string]$settings.baseUrl
    apiKey = [string]$settings.apiKey
  }
}
$settings.provider = "auto"
$settings.baseUrl = "http://127.0.0.1:11434/v1"
$settings.model = $Model
$settings.apiKey = "ollama"
[System.IO.File]::WriteAllText($file, ($settings | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $file /inheritance:r /grant:r "$($identity):(F)" | Out-Null
} catch { Write-Warning "Não foi possível ajustar permissões avançadas; mantenha esta pasta protegida no seu perfil do Windows." }

Write-Host ""
Write-Host "Tudo pronto. O JARVIS está configurado para usar $Model localmente." -ForegroundColor Green
Write-Host "Reabra J.A.R.V.I.S. para aplicar a configuração."
Write-Host "A IA local usa recursos do seu PC; velocidade e qualidade variam conforme o hardware."
