# Tạo biểu tượng KSK trên Desktop trỏ thẳng tới KSK.exe (đã gồm máy chủ nhúng, không cần chạy gì thêm).
param([string]$Exe = '')
$root = Split-Path -Parent $PSScriptRoot
if (-not $Exe) { $Exe = Join-Path $root 'release\KSK-win32-x64\KSK.exe' }
if (-not (Test-Path $Exe)) { Write-Host "Chua co $Exe - chay: npm run desktop:pack"; exit 1 }
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
foreach ($old in 'MedABE.lnk') { $p = Join-Path $desktop $old; if (Test-Path $p) { Remove-Item $p -Force } }
$lnk = $ws.CreateShortcut((Join-Path $desktop 'KSK.lnk'))
$lnk.TargetPath = $Exe
$lnk.WorkingDirectory = Split-Path $Exe
$adminIco = Join-Path $root 'launcher\ksk-admin.ico'
$ico = if (Test-Path $adminIco) { $adminIco } else { Join-Path $root 'launcher\ksk.ico' }
$lnk.IconLocation = $ico + ',0'   # dạng "đường dẫn,chỉ số"
$lnk.Description = 'Kham suc khoe - KSK'
$lnk.Save()
Write-Host "Da tao: $desktop\KSK.lnk"
