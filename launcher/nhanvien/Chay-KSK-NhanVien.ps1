param([string]$MayChu = '')
# Chay tren MAY NHAN VIEN (Windows). Kiem tra mang toi may chu KSK, ghi san dia chi may chu, roi mo app.
# Dung: nhap dup "Chay-KSK-NhanVien.cmd" (hoac: powershell -ExecutionPolicy Bypass -File Chay-KSK-NhanVien.ps1 -MayChu 192.168.x.x)
$ErrorActionPreference = 'Continue'
$exe = Join-Path $PSScriptRoot 'KSK-NhanVien-win32-x64\KSK-NhanVien.exe'
if (!(Test-Path -LiteralPath $exe)) { Write-Host "Khong thay $exe - hay giai nen CA thu muc roi chay lai." -ForegroundColor Red; Read-Host 'Enter de thoat'; exit 1 }

$cfgFile = Join-Path $PSScriptRoot 'may-chu.txt'
if (!$MayChu -and (Test-Path $cfgFile)) { $MayChu = (Get-Content $cfgFile -Raw).Trim() }
if (!$MayChu) { $MayChu = Read-Host 'Nhap IP may chu (may chay KSK.exe, vd 192.168.1.39)' }
$MayChu = $MayChu -replace '^https?://', '' -replace ':\d+/?$', '' -replace '/$', ''

Write-Host "`n=== 1. May nay ===" -ForegroundColor Cyan
Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
  ForEach-Object { Write-Host ("  {0}: {1}" -f $_.InterfaceAlias, $_.IPv4Address.IPAddress) }

Write-Host "`n=== 2. Kiem tra ket noi toi may chu $MayChu ===" -ForegroundColor Cyan
$ports = @(@(8090, 'kho du lieu ma hoa'), @(9001, 'nut cap khoa 1'), @(9002, 'nut cap khoa 2'), @(9003, 'nut cap khoa 3'), @(8095, 'cong Bo Y te (lien thong)'))
$bad = 0
foreach ($pp in $ports) {
  $p = $pp[0]
  $c = New-Object Net.Sockets.TcpClient
  $ok = $false
  try { $ok = $c.ConnectAsync($MayChu, $p).Wait(2000) -and $c.Connected } catch { } finally { $c.Close() }
  if ($ok) { Write-Host ("  [OK]  cong {0} - {1}" -f $p, $pp[1]) -ForegroundColor Green }
  else { Write-Host ("  [LOI] cong {0} - {1}" -f $p, $pp[1]) -ForegroundColor Red; $bad++ }
}
try {
  $null = Invoke-RestMethod "http://${MayChu}:8090/api/config" -TimeoutSec 5
  Write-Host '  [OK]  May chu KSK tra loi dung' -ForegroundColor Green
} catch { Write-Host "  [LOI] Khong goi duoc http://${MayChu}:8090/api/config" -ForegroundColor Red; $bad++ }

if ($bad) {
  Write-Host "`nCo $bad muc loi. Kiem tra:" -ForegroundColor Yellow
  Write-Host '  - Hai may cung Wi-Fi/LAN (khong dung Wi-Fi khach / mang co "AP isolation").'
  Write-Host '  - May chu dang MO KSK.exe va da chay Cau-Hinh-Mang-LAN.cmd (mo tuong lua).'
  Write-Host '  - IP may chu dung (tren may chu go: ipconfig).'
  if ((Read-Host 'Van mo app? (c/k)') -ne 'c') { exit 1 }
} else {
  Set-Content -Path $cfgFile -Value $MayChu -Encoding ascii
}

# Lan dau (chua dang ky): ghi san dia chi may chu de app ket noi dung cho, khong phai do tim.
$data = Join-Path $env:APPDATA 'KSK-NhanVien'
$settings = Join-Path $data 'settings.json'
if (!(Test-Path (Join-Path $data 'vault.json'))) {
  New-Item -ItemType Directory -Force $data | Out-Null
  Set-Content -Path $settings -Value ('{"storage":"http://' + $MayChu + ':8090"}') -Encoding ascii
  Write-Host "`nLan dau: da ghi dia chi may chu http://${MayChu}:8090" -ForegroundColor Cyan
}

Write-Host "`n=== 3. Mo KSK-NhanVien ===" -ForegroundColor Cyan
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
Write-Host 'Da mo. Co the dong cua so nay.'
Start-Sleep 3
