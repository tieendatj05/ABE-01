# Biểu tượng + logo NỀN TRONG SUỐT cho app tra cứu (phụ huynh) từ launcher\art\parent-logo-source.png (nền trắng).
# Cách tách: từ các mép ảnh, loang (flood fill) qua mọi điểm "trắng/xám nhạt không có màu" -> nền (gồm cả bóng đổ bên dưới).
# Vùng trắng nằm TRONG logo (viền chữ thập trong trái tim) bị bao kín bởi màu khác nên không bị xoá.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'ico-lib.ps1')
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Matte {
  public static Bitmap Cut(Bitmap src, out Rectangle box) {
    int w = src.Width, h = src.Height;
    var rs = src.LockBits(new Rectangle(0,0,w,h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int n = Math.Abs(rs.Stride) * h; byte[] px = new byte[n]; Marshal.Copy(rs.Scan0, px, 0, n); int st = rs.Stride; src.UnlockBits(rs);
    bool[] bg = new bool[w*h]; var q = new Queue<int>();
    Func<int,int,bool> isBg = (x, y) => { int i = y*st + x*4; int B = px[i], G = px[i+1], R = px[i+2]; int mx = Math.Max(R,Math.Max(G,B)), mn = Math.Min(R,Math.Min(G,B)); return (mx - mn) < 34 && mn > 150; };
    for (int x = 0; x < w; x++) { q.Enqueue(x); q.Enqueue((h-1)*w + x); }
    for (int y = 0; y < h; y++) { q.Enqueue(y*w); q.Enqueue(y*w + w-1); }
    while (q.Count > 0) {
      int p = q.Dequeue(); if (bg[p]) continue; int x = p % w, y = p / w; if (!isBg(x, y)) continue; bg[p] = true;
      if (x > 0) q.Enqueue(p-1); if (x < w-1) q.Enqueue(p+1); if (y > 0) q.Enqueue(p-w); if (y < h-1) q.Enqueue(p+w);
    }
    // viền: điểm không phải nền nhưng sát nền và còn sáng -> làm mờ dần để không còn quầng trắng quanh mép
    var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    var rd = bmp.LockBits(new Rectangle(0,0,w,h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
    byte[] o = new byte[n];
    int minX = w, minY = h, maxX = 0, maxY = 0;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int i = y*st + x*4; int p = y*w + x;
      double a = bg[p] ? 0 : 1;
      if (!bg[p]) {
        bool near = (x>0&&bg[p-1])||(x<w-1&&bg[p+1])||(y>0&&bg[p-w])||(y<h-1&&bg[p+w]);
        if (near) { int mn = Math.Min(px[i], Math.Min(px[i+1], px[i+2])); if (mn > 190) a = 0.25; else if (mn > 150) a = 0.6; }
      }
      o[i] = px[i]; o[i+1] = px[i+1]; o[i+2] = px[i+2]; o[i+3] = (byte)(a*255);
      if (a > 0.5) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    Marshal.Copy(o, 0, rd.Scan0, n); bmp.UnlockBits(rd);
    box = new Rectangle(minX, minY, maxX-minX+1, maxY-minY+1);
    return bmp;
  }
}
'@ -ReferencedAssemblies System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$srcPath = Join-Path $PSScriptRoot 'parent-logo-source.png'
$ico = Join-Path $root 'launcher\phuhuynh.ico'
$pub = Join-Path $root 'app\parent\public'
$bytes = [IO.File]::ReadAllBytes($srcPath); $ms0 = New-Object IO.MemoryStream (,$bytes)
$src = New-Object Drawing.Bitmap ([Drawing.Image]::FromStream($ms0))
$box = New-Object Drawing.Rectangle
$cut = [Matte]::Cut($src, [ref]$box)
Write-Host "logo: $($box.Width)x$($box.Height) tai ($($box.X),$($box.Y)) trong anh $($src.Width)x$($src.Height)"

# Vẽ logo (nền trong suốt) vào khung vuông s x s, chừa lề pad
function New-Icon([int]$s, [double]$pad) {
  $bmp = New-Object Drawing.Bitmap $s, $s, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([Drawing.Color]::Transparent)
  $avail = $s * (1 - 2 * $pad)
  $k = [Math]::Min($avail / $box.Width, $avail / $box.Height)
  $tw = [single]($box.Width * $k); $th = [single]($box.Height * $k)
  $dst = New-Object Drawing.RectangleF(([single](($s - $tw) / 2)), ([single](($s - $th) / 2)), $tw, $th)
  $g.DrawImage($cut, $dst, (New-Object Drawing.RectangleF($box.X, $box.Y, $box.Width, $box.Height)), [Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return ,$bmp
}
function ToPngBytes($bmp) { $m = New-Object IO.MemoryStream; $bmp.Save($m, [Drawing.Imaging.ImageFormat]::Png); return ,$m.ToArray() }

foreach ($sz in 192, 512) { $pb = New-Icon $sz 0.06; [IO.File]::WriteAllBytes((Join-Path $pub "icon-$sz.png"), (ToPngBytes $pb)); $pb.Dispose() }
$pv = New-Icon 512 0.06; [IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'parent-logo-transparent.png'), (ToPngBytes $pv)); $pv.Dispose()

Write-Ico @(16, 24, 32, 48, 64, 128, 256) { param($s) New-Icon $s 0.03 } $ico
Write-Host "Da tao phuhuynh.ico, icon-192/512.png (nen trong suot)"
