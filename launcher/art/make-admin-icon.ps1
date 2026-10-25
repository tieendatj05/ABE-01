# Biểu tượng cho bản QUẢN TRỊ (KSK.exe) từ ảnh do người dùng cung cấp - khác launcher\ksk.ico (dùng cho bản nhân viên).
# Nền trắng/xám nhạt quanh khung thẻ bo góc được tách thành TRONG SUỐT (loang từ 4 góc ảnh), giữ nguyên màu bên trong thẻ.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'ico-lib.ps1')
. (Join-Path $PSScriptRoot 'matte-lib.ps1')

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$srcPath = $args[0]
if (-not $srcPath) { throw 'Dùng: make-admin-icon.ps1 <đường dẫn ảnh nguồn>' }
$bytes = [IO.File]::ReadAllBytes($srcPath)
$ms0 = New-Object IO.MemoryStream (,$bytes)
$raw = New-Object Drawing.Bitmap ([Drawing.Image]::FromStream($ms0))

# Loang nền từ 4 góc ảnh (nền trắng/xám nhạt quanh thẻ bo góc); ngưỡng rộng hơn bản gốc vì nền ở đây hơi ngả xanh, không trắng tuyệt đối.
$seeds = [int[]]@()
$box = New-Object Drawing.Rectangle
$src = [Matte2]::Cut($raw, $seeds, 60, 170, [ref]$box)
Write-Host "the logo: $($box.Width)x$($box.Height) trong anh $($raw.Width)x$($raw.Height)"

# Đệm ảnh (không vuông) vào khung vuông theo đúng khung thẻ đã tách nền, giữ nguyên toàn bộ icon gốc thay vì cắt mất mép.
$side = [Math]::Max($box.Width, $box.Height)
$square = New-Object Drawing.Bitmap $side, $side, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gq = [Drawing.Graphics]::FromImage($square)
$gq.Clear([Drawing.Color]::Transparent)
$gq.DrawImage($src, [int](($side - $box.Width) / 2), [int](($side - $box.Height) / 2), (New-Object Drawing.Rectangle($box.X, $box.Y, $box.Width, $box.Height)), [Drawing.GraphicsUnit]::Pixel)
$gq.Dispose()

function New-Icon([int]$s) {
  $bmp = New-Object Drawing.Bitmap $s, $s, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([Drawing.Color]::Transparent)
  $g.DrawImage($square, (New-Object Drawing.RectangleF(0, 0, $s, $s)), (New-Object Drawing.RectangleF(0, 0, $side, $side)), [Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); return ,$bmp
}
Write-Ico @(16, 24, 32, 48, 64, 128, 256) { param($s) New-Icon $s } (Join-Path $root 'launcher\ksk-admin.ico')
(New-Icon 512).Save((Join-Path $root 'app\web\public\ksk-logo-admin.png'), [Drawing.Imaging.ImageFormat]::Png)
Write-Host "Da tao launcher\ksk-admin.ico va app\web\public\ksk-logo-admin.png (nen trong suot)"
