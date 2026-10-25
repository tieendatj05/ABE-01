# Biểu tượng + logo NỀN TRONG SUỐT cho app KSK từ launcher\art\ksk-logo-source.png (logo vàng hình bầu dục trên nền trắng).
# Tách nền theo độ bão hoà màu: vàng rất rực, nền trắng/xám/bóng đổ gần như không có màu -> trong suốt (kể cả vùng trắng bên trong vòng).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'ico-lib.ps1')
. (Join-Path $PSScriptRoot 'matte-lib.ps1')

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$bytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'ksk-logo-source.png')); $ms0 = New-Object IO.MemoryStream (,$bytes)
$src = New-Object Drawing.Bitmap ([Drawing.Image]::FromStream($ms0))
$box = New-Object Drawing.Rectangle
# điểm xuất phát thêm: hai điểm trắng bên trong vòng bầu dục (hai bên chữ K)
$seeds = [int[]]@([int]($src.Width * 0.20), [int]($src.Height * 0.50), [int]($src.Width * 0.80), [int]($src.Height * 0.50))
$cut = [Matte2]::Cut($src, $seeds, 46, 110, [ref]$box)
Write-Host "logo: $($box.Width)x$($box.Height) trong anh $($src.Width)x$($src.Height)"

function New-Icon([int]$s, [double]$pad) {
  $bmp = New-Object Drawing.Bitmap $s, $s, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([Drawing.Color]::Transparent)
  $avail = $s * (1 - 2 * $pad)
  $k = [Math]::Min($avail / $box.Width, $avail / $box.Height)
  $tw = [single]($box.Width * $k); $th = [single]($box.Height * $k)
  $g.DrawImage($cut, (New-Object Drawing.RectangleF(([single](($s - $tw) / 2)), ([single](($s - $th) / 2)), $tw, $th)), (New-Object Drawing.RectangleF($box.X, $box.Y, $box.Width, $box.Height)), [Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); return ,$bmp
}
$pv = New-Icon 512 0.04
$pv.Save((Join-Path $PSScriptRoot 'ksk-logo-transparent.png'), [Drawing.Imaging.ImageFormat]::Png)
$pv.Save((Join-Path $root 'app\web\public\ksk-logo.png'), [Drawing.Imaging.ImageFormat]::Png); $pv.Dispose()
Write-Ico @(16, 24, 32, 48, 64, 128, 256) { param($s) New-Icon $s 0.02 } (Join-Path $root 'launcher\ksk.ico')
Write-Host "Da tao launcher\ksk.ico (nen trong suot) va app\web\public\ksk-logo.png"
