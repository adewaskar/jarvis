$ErrorActionPreference = "Stop"
$folder = Join-Path $HOME ".jarvis"
$file = Join-Path $folder "provider.json"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

function Read-CloudConfig([string]$Provider, [string]$BaseUrl) {
  if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = Read-Host "URL base OpenAI-compatible do provedor"
  }
  try { $uri = [Uri]$BaseUrl } catch { throw "URL inválida." }
  if ($uri.Scheme -notin @("http", "https")) { throw "A URL deve usar HTTP ou HTTPS." }
  $model = Read-Host "Nome exato do modelo disponível no provedor"
  if ([string]::IsNullOrWhiteSpace($model)) { throw "Informe o nome do modelo." }
  $secure = Read-Host "API key (será gravada somente neste computador)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if ([string]::IsNullOrWhiteSpace($key)) { throw "A chave não pode ficar vazia." }
  return @{ provider = $Provider; baseUrl = $BaseUrl.TrimEnd('/'); model = $model; apiKey = $key }
}

Write-Host ""
Write-Host "J.A.R.V.I.S. - configuração do cérebro de IA" -ForegroundColor Cyan
Write-Host "Automático tenta Ollama local primeiro e usa um provedor reserva se necessário."
Write-Host "APIs na nuvem podem cobrar pelo uso; confira as condições da sua conta."
Write-Host ""
Write-Host "1 - Automático (Ollama local, depois um provedor reserva opcional)"
Write-Host "2 - Ollama local"
Write-Host "3 - OpenAI API"
Write-Host "4 - OpenRouter"
Write-Host "5 - Groq"
Write-Host "6 - Together AI"
Write-Host "7 - DeepSeek API"
Write-Host "8 - Google Gemini API"
Write-Host "9 - Outro endpoint compatível com OpenAI"
$choice = Read-Host "Escolha (1-9)"

$local = @{ provider = "auto"; baseUrl = "http://127.0.0.1:11434/v1"; model = "qwen3-vl:4b"; apiKey = "ollama" }
$config = $null
if ($choice -eq "1") {
  $localModel = Read-Host "Modelo local Ollama (Enter para qwen3-vl:4b)"
  if ([string]::IsNullOrWhiteSpace($localModel)) { $localModel = "qwen3-vl:4b" }
  $local.model = $localModel
  $config = $local
  Write-Host ""
  Write-Host "Provedor reserva para quando o Ollama estiver indisponível:"
  Write-Host "0 - Nenhum"
  Write-Host "1 - OpenAI"
  Write-Host "2 - OpenRouter"
  Write-Host "3 - Groq"
  Write-Host "4 - Together AI"
  Write-Host "5 - DeepSeek"
  Write-Host "6 - Google Gemini"
  $fallbackChoice = Read-Host "Escolha (0-6)"
  $fallbacks = @{
    "1" = @{ provider = "openai"; baseUrl = "https://api.openai.com/v1" }
    "2" = @{ provider = "openrouter"; baseUrl = "https://openrouter.ai/api/v1" }
    "3" = @{ provider = "groq"; baseUrl = "https://api.groq.com/openai/v1" }
    "4" = @{ provider = "together"; baseUrl = "https://api.together.xyz/v1" }
    "5" = @{ provider = "deepseek"; baseUrl = "https://api.deepseek.com/v1" }
    "6" = @{ provider = "gemini"; baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai" }
  }
  if ($fallbackChoice -ne "0") {
    if (-not $fallbacks.ContainsKey($fallbackChoice)) { throw "Opção de reserva inválida." }
    $fallbackInfo = $fallbacks[$fallbackChoice]
    $config.fallback = Read-CloudConfig $fallbackInfo.provider $fallbackInfo.baseUrl
  }
} elseif ($choice -eq "2") {
  $model = Read-Host "Modelo Ollama (Enter para qwen3-vl:4b)"
  if ([string]::IsNullOrWhiteSpace($model)) { $model = "qwen3-vl:4b" }
  $config = @{ provider = "ollama"; baseUrl = "http://127.0.0.1:11434/v1"; model = $model; apiKey = "ollama" }
} else {
  $providers = @{
    "3" = @{ provider = "openai"; baseUrl = "https://api.openai.com/v1" }
    "4" = @{ provider = "openrouter"; baseUrl = "https://openrouter.ai/api/v1" }
    "5" = @{ provider = "groq"; baseUrl = "https://api.groq.com/openai/v1" }
    "6" = @{ provider = "together"; baseUrl = "https://api.together.xyz/v1" }
    "7" = @{ provider = "deepseek"; baseUrl = "https://api.deepseek.com/v1" }
    "8" = @{ provider = "gemini"; baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai" }
    "9" = @{ provider = "custom"; baseUrl = "" }
  }
  if (-not $providers.ContainsKey($choice)) { throw "Opção inválida." }
  $item = $providers[$choice]
  $config = Read-CloudConfig $item.provider $item.baseUrl
}

$json = $config | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($file, $json, [System.Text.UTF8Encoding]::new($false))
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $file /inheritance:r /grant:r "$($identity):(F)" | Out-Null
Write-Host ""
Write-Host "Configuração salva em $file" -ForegroundColor Green
Write-Host "As chaves foram gravadas somente neste perfil do Windows. Não as envie por chat."
Write-Host "Feche e abra o JARVIS novamente."
if ($config.provider -eq "auto" -or $config.provider -eq "ollama") {
  Write-Host ""
  Write-Host "Mantenha o Ollama aberto e confirme que o modelo local está instalado."
  Write-Host "Para baixar o modelo: ollama pull $($config.model)"
}
