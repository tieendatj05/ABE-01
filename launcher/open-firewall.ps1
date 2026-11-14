$ErrorActionPreference = 'Stop'
# Chỉ mở dịch vụ KSK cho thiết bị cùng LocalSubnet trên mọi hồ sơ mạng Windows. Chạy bằng Administrator.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Hay mo PowerShell bang "Run as administrator" roi chay lai.'; exit 1
}
foreach ($p in 5174, 8090, 8095, 9001, 9002, 9003) {
  Remove-NetFirewallRule -DisplayName "KSK-$p" -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "KSK-$p" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow -Profile Any -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block | Out-Null
}
Remove-NetFirewallRule -DisplayName 'KSK-Discovery-UDP' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'KSK-Discovery-UDP' -Direction Inbound -Protocol UDP -LocalPort 43821 -Action Allow -Profile Any -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block | Out-Null
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress
Write-Host "Xong. Ung dung nhan vien tu tim may chu khi cung LAN. Tren dien thoai cung WiFi co the mo http://${ip}:5174 de xem thu, NHUNG trinh duyet dien thoai chi giai ma duoc o trang HTTPS. De dung that (ke ca 4G): chay npm run public:tunnel va dung dia chi https cua no. Xem HUONG_DAN_APP_DIEN_THOAI.md"

$taskEmployee = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\release\KSK-NhanVien-win32-x64\KSK-NhanVien.exe'))
if (Test-Path -LiteralPath $taskEmployee) {
  Remove-NetFirewallRule -DisplayName 'KSK-NhanVien-Discovery-Reply' -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName 'KSK-NhanVien-Discovery-Reply' -Direction Inbound -Program $taskEmployee -Protocol UDP -RemotePort 43821 -RemoteAddress LocalSubnet -Profile Any -EdgeTraversalPolicy Block -Action Allow | Out-Null
}
