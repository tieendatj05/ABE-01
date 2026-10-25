# Ghi file .ico tương thích rộng: khung nhỏ dạng BMP (DIB 32-bit + mặt nạ AND) như Windows cổ điển, riêng 256x256 dạng PNG.
# (Khung PNG ở cỡ nhỏ đôi khi không được Windows/Explorer hiển thị -> biểu tượng trắng.)
Add-Type -AssemblyName System.Drawing
function Get-BmpFrame([Drawing.Bitmap]$bmp) {
  $s = $bmp.Width
  $rect = New-Object Drawing.Rectangle 0, 0, $s, $s
  $d = $bmp.LockBits($rect, [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $d.Stride; $raw = New-Object byte[] ($stride * $s)
  [Runtime.InteropServices.Marshal]::Copy($d.Scan0, $raw, 0, $raw.Length); $bmp.UnlockBits($d)
  $ms = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ms
  $w.Write([uint32]40); $w.Write([int32]$s); $w.Write([int32]($s * 2)); $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]0); $w.Write([uint32]($s * $s * 4)); $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
  for ($y = $s - 1; $y -ge 0; $y--) { $w.Write($raw, $y * $stride, $s * 4) }            # điểm ảnh BGRA, từ dưới lên
  $maskRow = [int]([Math]::Ceiling($s / 32.0) * 4)
  $w.Write((New-Object byte[] ($maskRow * $s)))                                          # mặt nạ AND = 0 (dùng kênh alpha)
  $w.Flush(); return ,$ms.ToArray()
}
function Get-PngFrame([Drawing.Bitmap]$bmp) { $m = New-Object IO.MemoryStream; $bmp.Save($m, [Drawing.Imaging.ImageFormat]::Png); return ,$m.ToArray() }
function Write-Ico([int[]]$sizes, [scriptblock]$render, [string]$path) {
  $frames = @()
  foreach ($s in $sizes) { $b = & $render $s; $frames += , $(if ($s -ge 256) { Get-PngFrame $b } else { Get-BmpFrame $b }); $b.Dispose() }
  $ms = New-Object IO.MemoryStream; $wr = New-Object IO.BinaryWriter $ms
  $wr.Write([uint16]0); $wr.Write([uint16]1); $wr.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $d = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $wr.Write([byte]$d); $wr.Write([byte]$d); $wr.Write([byte]0); $wr.Write([byte]0); $wr.Write([uint16]1); $wr.Write([uint16]32)
    $wr.Write([uint32]$frames[$i].Length); $wr.Write([uint32]$offset); $offset += $frames[$i].Length
  }
  foreach ($f in $frames) { $wr.Write([byte[]]$f) }
  $wr.Flush(); [IO.File]::WriteAllBytes($path, $ms.ToArray())
}
