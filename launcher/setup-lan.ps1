$ErrorActionPreference = 'Stop'
$taskScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'open-firewall.ps1'))
if (!(Test-Path -LiteralPath $taskScript)) { throw 'Khong tim thay open-firewall.ps1' }
$taskPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if ($taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { & $taskScript; exit $LASTEXITCODE }
$taskProcess = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $taskScript + '"') -Wait -PassThru
exit $taskProcess.ExitCode
