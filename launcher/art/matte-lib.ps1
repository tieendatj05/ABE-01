# Tách nền trắng khỏi logo bằng "loang" từ các điểm xuất phát (mép ảnh + điểm trong vòng): chỉ xoá vùng trắng/xám nhạt NỐI LIỀN với nền;
# các vùng sáng nằm trong thân logo (ánh kim của chữ K, viền chữ thập) bị bao kín bởi màu khác nên được giữ lại.
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Matte2 {
  public static Bitmap Cut(Bitmap src, int[] seeds, int chromaMax, int minBright, out Rectangle box) {
    int w = src.Width, h = src.Height;
    var rs = src.LockBits(new Rectangle(0,0,w,h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int n = Math.Abs(rs.Stride) * h; byte[] px = new byte[n]; Marshal.Copy(rs.Scan0, px, 0, n); int st = rs.Stride; src.UnlockBits(rs);
    bool[] bg = new bool[w*h]; var q = new Queue<int>();
    Func<int,int,bool> isBg = (x, y) => { int i = y*st + x*4; int B = px[i], G = px[i+1], R = px[i+2]; int mx = Math.Max(R,Math.Max(G,B)), mn = Math.Min(R,Math.Min(G,B)); return (mx - mn) < chromaMax && mn > minBright; };
    for (int x = 0; x < w; x++) { q.Enqueue(x); q.Enqueue((h-1)*w + x); }
    for (int y = 0; y < h; y++) { q.Enqueue(y*w); q.Enqueue(y*w + w-1); }
    for (int k = 0; k + 1 < seeds.Length; k += 2) q.Enqueue(seeds[k+1]*w + seeds[k]);
    while (q.Count > 0) {
      int p = q.Dequeue(); if (bg[p]) continue; int x = p % w, y = p / w; if (!isBg(x, y)) continue; bg[p] = true;
      if (x > 0) q.Enqueue(p-1); if (x < w-1) q.Enqueue(p+1); if (y > 0) q.Enqueue(p-w); if (y < h-1) q.Enqueue(p+w);
    }
    var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    var rd = bmp.LockBits(new Rectangle(0,0,w,h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
    byte[] o = new byte[n]; int minX = w, minY = h, maxX = 0, maxY = 0;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int i = y*st + x*4; int p = y*w + x; double a = bg[p] ? 0 : 1;
      if (!bg[p]) {
        bool near = (x>0&&bg[p-1])||(x<w-1&&bg[p+1])||(y>0&&bg[p-w])||(y<h-1&&bg[p+w]);
        if (near) { int mn = Math.Min(px[i], Math.Min(px[i+1], px[i+2])); if (mn > 200) a = 0.2; else if (mn > 160) a = 0.55; }
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
