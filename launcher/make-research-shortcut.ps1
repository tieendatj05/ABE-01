# Tạo biểu tượng "MedABE May chu nghien cuu" trên Desktop: bấm là khởi động máy chủ nghiên cứu CP-ABE (Spring HTTPS + 3 nút cấp khoá + giao diện) và mở trình duyệt.
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'Chay-MayChu-NghienCuu.cmd'
if (-not (Test-Path $target)) { Write-Host "Khong thay $target"; exit 1 }
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'MedABE May chu nghien cuu.lnk'))
$lnk.TargetPath = $target
$lnk.WorkingDirectory = $root
$lnk.IconLocation = (Join-Path $root 'launcher\ksk-admin.ico') + ',0'
$lnk.WindowStyle = 1
$lnk.Description = 'Khoi dong may chu nghien cuu CP-ABE (tai khoan ca nhan, ABAC, gio lam viec) va mo giao dien'
$lnk.Save()
Write-Host "Da tao: $desktop\MedABE May chu nghien cuu.lnk"
