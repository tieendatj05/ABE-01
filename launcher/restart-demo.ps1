# KHOI DONG LAI may chu DEMO (ban moi): dung DUNG may chu demo cua thu muc nay roi chay lai bang jar/chinh sach moi.
# AN TOAN: chi dung 2 loai tien trinh co dong lenh tro vao THU MUC NAY: (1) node chay security/src/deploy/research-server.ts, (2) java chay medabe-storage-*.jar cua thu muc nay.
# KHONG dung KSK.exe, KSK-TaiKhoan hay bat ky java/node nao khac. Du lieu o data-research\ duoc GIU NGUYEN.
#   -DryRun : chi LIET KE tien trinh se dung, khong dung/chay gi.     -Yes : khong hoi xac nhan.
#   -StopOnly : chi DUNG may chu (de thay jar), khong chay lai.
param([switch]$Yes, [switch]$DryRun, [switch]$StopOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jarDir = Join-Path $root 'security\storage\target'

function Test-Ours($p) {
    $cl = $p.CommandLine
    if (-not $cl) { return $false }
    if ($p.Name -eq 'node.exe' -and $cl -match 'security[/\\]src[/\\]deploy[/\\]research-server\.ts') { return $true }   # tien trinh cha (tsx cli) va con, duong dan tuong doi hoac tuyet doi
    if ($p.Name -eq 'java.exe' -and $cl -like "*$jarDir*medabe-storage*.jar*") { return $true }
    return $false
}
$targets = @(Get-CimInstance Win32_Process | Where-Object { Test-Ours $_ })

if (-not $targets.Count) { Write-Host 'Khong thay may chu demo nao dang chay cua thu muc nay.' }
else {
    Write-Host 'Tien trinh may chu demo cua thu muc nay:'
    $targets | ForEach-Object { '  PID {0,-7} {1}' -f $_.ProcessId, $_.Name }
}
if ($DryRun) { Write-Host '(-DryRun: khong dung va khong chay gi)'; exit 0 }
if ($targets.Count) {
    if (-not $Yes) { $a = Read-Host 'Dong y DUNG cac tien trinh tren va chay lai? (y/n)'; if ($a -notmatch '^(y|yes|co|c)$') { Write-Host 'Da huy.'; exit 0 } }
    foreach ($t in $targets) {
        # tien trinh con co the da chet theo tien trinh cha (taskkill /T) -> bo qua loi "not found"
        if (Get-Process -Id $t.ProcessId -ErrorAction SilentlyContinue) { try { & taskkill /T /F /PID $t.ProcessId 2>&1 | Out-Null } catch { } }
    }
    Start-Sleep -Seconds 3
}
if ($StopOnly) { Write-Host 'Da dung may chu demo (-StopOnly: khong chay lai).'; exit 0 }

if (-not (Get-ChildItem $jarDir -Filter 'medabe-storage-*.jar' -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 20MB })) {
    Write-Host 'CANH BAO: jar Spring thieu hoac la ban "mong" (< 20 MB). Build lai: cd security\storage; .\mvnw -DskipTests package' -ForegroundColor Yellow
}
Write-Host 'Dang chay lai may chu demo (cua so moi)...'
Start-Process -FilePath (Join-Path $root 'Chay-Demo-KSK-Moi.cmd') -WorkingDirectory $root
Write-Host 'Xong. Doi khoang 15-20 giay roi mo http://localhost:5180 (hoac chay: npx tsx app/test-ui/demo-kiem-tra-san-sang.ts).'
