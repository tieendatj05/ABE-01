# Tạo biểu tượng "KSK Phu huynh" (ứng dụng tra cứu trên máy tính) trên Desktop.
param([string]$Exe = '')
$root = Split-Path -Parent $PSScriptRoot
if (-not $Exe) { $Exe = Join-Path $root 'release\KSK-PhuHuynh-win32-x64\KSK-PhuHuynh.exe' }
if (-not (Test-Path $Exe)) { Write-Host "Chua co $Exe - chay: npm run parent:pack"; exit 1 }
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
foreach ($old in 'MedABE Phu huynh.lnk') { $p = Join-Path $desktop $old; if (Test-Path $p) { Remove-Item $p -Force } }
$lnk = $ws.CreateShortcut((Join-Path $desktop 'KSK Phu huynh.lnk'))
$lnk.TargetPath = $Exe
$lnk.WorkingDirectory = Split-Path $Exe
$lnk.IconLocation = (Join-Path $root 'launcher\phuhuynh.ico') + ',0'   # dạng "đường dẫn,chỉ số"
$lnk.Description = 'Tra cuu ket qua kham suc khoe'
$lnk.Save()
Write-Host "Da tao: $desktop\KSK Phu huynh.lnk"
