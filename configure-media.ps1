$ErrorActionPreference = "Stop"
$folder = Join-Path $HOME ".jarvis"
$file = Join-Path $folder "media.json"
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$settings = @{}
if (Test-Path $file) {
  try {
    $loaded = Get-Content -Raw -Path $file | ConvertFrom-Json
    foreach ($property in $loaded.PSObject.Properties) { $settings[$property.Name] = $property.Value }
  } catch { throw "O arquivo atual de mídia não pôde ser lido. Corrija-o antes de continuar." }
}
function Convert-SecureToPlainText([Security.SecureString]$Secret) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
Write-Host ""
Write-Host "J.A.R.V.I.S. - geração de imagens e voz" -ForegroundColor Cyan
Write-Host "As chaves ficam neste perfil do Windows e não são enviadas ao modelo de conversa."
Write-Host "A geração de imagens usa a API OpenAI e pode ter cobrança própria."
Write-Host "A geração de arquivos de voz usa a API ElevenLabs e pode ter cobrança própria."
Write-Host "Pressione Enter para manter qualquer chave já salva ou deixar o recurso sem configurar."
Write-Host ""
$imageSecret = Read-Host "Chave da API OpenAI para gerar imagens" -AsSecureString
if ($imageSecret.Length -gt 0) { $settings.openaiApiKey = Convert-SecureToPlainText $imageSecret }
$voiceSecret = Read-Host "Chave da API ElevenLabs para gerar arquivos de voz" -AsSecureString
if ($voiceSecret.Length -gt 0) { $settings.elevenLabsApiKey = Convert-SecureToPlainText $voiceSecret }
$voiceId = Read-Host "ID de voz ElevenLabs (Enter para manter o atual ou usar o padrão)"
if (-not [string]::IsNullOrWhiteSpace($voiceId)) {
  if ($voiceId -notmatch '^[A-Za-z0-9_-]{6,100}$') { throw "ID de voz inválido." }
  $settings.voiceId = $voiceId.Trim()
}
$settings.imageModel = "gpt-image-2.6-flare"
$json = $settings | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($file, $json, [System.Text.UTF8Encoding]::new($false))
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $file /inheritance:r /grant:r "$($identity):(F)" | Out-Null
Write-Host ""
Write-Host "Configuração de mídia salva em $file" -ForegroundColor Green
Write-Host "Reinicie o J.A.R.V.I.S. para atualizar as capacidades de voz e mídia."
Write-Host "Sem uma chave OpenAI, a geração de imagens fica indisponível."
Write-Host "Sem uma chave ElevenLabs, a geração de arquivos de voz fica indisponível; respostas faladas ainda podem usar a voz do Windows."
