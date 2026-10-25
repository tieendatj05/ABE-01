# Chạy bản nhân viên với kho dữ liệu source data-demo trên chính máy này.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskServer = Join-Path $taskRoot 'release\KSK-win32-x64\KSK.exe'
$taskServerScript = Join-Path $taskRoot 'release\KSK-win32-x64\resources\server\server.mjs'
$taskJar = Join-Path $taskRoot 'security\storage\target\medabe-storage-0.1.0.jar'
$taskEmployee = Join-Path $taskRoot 'release\KSK-NhanVien-win32-x64\KSK-NhanVien.exe'
$taskData = Join-Path $taskRoot 'data-demo'
$taskStarted = $null
function Test-TaskServer {
  try { return (Invoke-WebRequest 'http://127.0.0.1:8090/api/config' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}
try {
  if (!(Test-Path -LiteralPath $taskEmployee)) { throw 'Khong tim thay ban KSK-NhanVien.' }
  if (!(Test-TaskServer)) {
    foreach ($taskFile in @($taskServer, $taskServerScript, $taskJar)) {
      if (!(Test-Path -LiteralPath $taskFile)) { throw "Thieu tep: $taskFile" }
    }
    # Kiểm tra các cổng trước; không mở thêm một kho dữ liệu cạnh máy chủ đang chạy dở.
    foreach ($taskPort in @(8090,9001,9002,9003)) {
      $taskProbe = [Net.Sockets.TcpClient]::new()
      try { $taskProbe.Connect('127.0.0.1', $taskPort); throw "Cong $taskPort dang duoc su dung. Kiem tra may chu dang chay truoc." }
      catch [Net.Sockets.SocketException] { }
      finally { $taskProbe.Dispose() }
    }
    New-Item -ItemType Directory -Path $taskData -Force | Out-Null
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:DATA_DIR = $taskData
    $env:JAR_PATH = $taskJar
    $env:JAVA_BIN = Join-Path $taskRoot 'release\KSK-win32-x64\resources\server\jre\bin\java.exe'
    $env:NO_WEB = '1'
    $env:PUBLIC_HOST = '127.0.0.1'
    $env:PARENT_DIST = Join-Path $taskRoot 'release\KSK-win32-x64\resources\server\parent'
    $taskStarted = Start-Process -FilePath $taskServer -ArgumentList ('"' + $taskServerScript + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'local-server.log') -RedirectStandardError (Join-Path $taskData 'local-server-error.log') -PassThru
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Write-Host 'Dang bat may chu voi kho data-demo...'
    for ($taskAttempt = 0; $taskAttempt -lt 90; $taskAttempt++) {
      if (Test-TaskServer) { break }
      if ($taskStarted.HasExited) { throw 'May chu dung som. Xem data-demo/local-server-error.log.' }
      Start-Sleep -Milliseconds 500
    }
    if (!(Test-TaskServer)) { throw 'May chu chua san sang. Xem log trong data-demo.' }
  }
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Start-Process -FilePath $taskEmployee -WorkingDirectory $taskRoot
  Write-Host 'Da mo KSK-NhanVien. Chon may chu http://127.0.0.1:8090 va dung Cong ty.'
  Write-Host 'May chu chay nen. Dung KSK.exe cho kho nhung rieng; khong chay dong thoi hai kho tren cong 8090.'
} catch {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host 'Nhan Enter de dong'
  exit 1
}
