# Tao bieu tuong "KSK Demo (ban moi)" tren Desktop: bam la chay may chu thu + mo app nhan vien ban moi trong trinh duyet (chay tu ma nguon, chua dong goi).
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'Chay-Demo-KSK-Moi.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'KSK Demo (ban moi).lnk'))
$lnk.TargetPath = $target
$lnk.WorkingDirectory = $root
$lnk.IconLocation = (Join-Path $root 'launcher\ksk.ico') + ',0'
$lnk.Description = 'Demo app nhan vien ban moi (tac gia + anh theo vung) tren may nay, du lieu thu rieng'
$lnk.Save()
Write-Host "Da tao: $desktop\KSK Demo (ban moi).lnk"
