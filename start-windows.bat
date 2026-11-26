@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
if errorlevel 1 (
  echo.
  echo O JARVIS encontrou um problema. Leia a mensagem acima.
  pause
)
endlocal
