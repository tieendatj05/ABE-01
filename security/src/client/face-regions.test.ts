import { describe, expect, it } from 'vitest';
import { FACE_MESH_POINTS, faceRegionsFromMesh } from './face-regions.js';

// Bộ điểm mốc TỔNG HỢP (không phải khuôn mặt thật): đặt các điểm chính ở vị trí giống một khuôn mặt chính diện trong ảnh 800x800.
function syntheticMesh(): number[][] {
  const m: number[][] = Array.from({ length: FACE_MESH_POINTS }, () => [400, 400, 0]);
  const put = (ids: number[], x0: number, y0: number, x1: number, y1: number) => ids.forEach((i, k) => { const t = k / Math.max(1, ids.length - 1); m[i] = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * ((k % 2) / 1), 0]; });
  put([33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], 270, 330, 370, 345);      // mắt
  put([362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398], 430, 330, 530, 345);
  put([70, 63, 105, 66, 107, 55, 65, 52, 53, 46], 270, 300, 370, 310);                                         // lông mày
  put([300, 293, 334, 296, 336, 285, 295, 282, 283, 276], 430, 300, 530, 310);
  put([6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327, 129, 358, 49, 279, 48, 278, 64, 294, 219, 439], 360, 350, 440, 440);   // mũi
  put([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185], 340, 470, 460, 500); // môi
  m[234] = [250, 400, 0]; m[454] = [550, 400, 0]; m[152] = [400, 580, 0]; m[10] = [400, 200, 0];             // má 2 bên, cằm, trán
  return m;
}

describe('faceRegionsFromMesh', () => {
  const regions = faceRegionsFromMesh(syntheticMesh(), 800, 800);
  const by = (label: string) => regions.find((r) => r.label === label)!;

  it('tạo đủ 5 vùng với đúng khoa: mắt→Mat; mũi và hai tai→TMH; miệng+hàm→RHM', () => {
    expect(regions.map((r) => r.label)).toEqual(['vung-mat', 'vung-mui', 'vung-tai-1', 'vung-tai-2', 'vung-mieng-ham']);
    expect(by('vung-mat').khoas).toEqual(['Mat']);
    expect([by('vung-mui'), by('vung-tai-1'), by('vung-tai-2')].every((r) => r.khoas.join() === 'TMH')).toBe(true);
    expect(by('vung-mieng-ham').khoas).toEqual(['RHM']);
  });

  it('mắt nằm trên mũi, mũi nằm trên miệng và các vùng này không chồng nhau theo chiều dọc', () => {
    const mat = by('vung-mat').rect, mui = by('vung-mui').rect, mieng = by('vung-mieng-ham').rect;
    expect(mat.y + mat.h).toBeLessThanOrEqual(mui.y);
    expect(mui.y + mui.h).toBeLessThanOrEqual(mieng.y);
  });

  it('hai tai nằm hai bên mặt (một bên trái, một bên phải) và mọi vùng nằm trong khung ảnh', () => {
    const t1 = by('vung-tai-1').rect, t2 = by('vung-tai-2').rect, mat = by('vung-mat').rect;
    expect(t1.x + t1.w).toBeLessThan(mat.x + mat.w / 2);
    expect(t2.x).toBeGreaterThan(mat.x + mat.w / 2);
    for (const r of regions) expect(r.rect.x >= 0 && r.rect.y >= 0 && r.rect.x + r.rect.w <= 800 && r.rect.y + r.rect.h <= 800 && r.rect.w >= 4 && r.rect.h >= 4).toBe(true);
  });

  it('cắt vùng vào khung ảnh nhỏ hơn và từ chối bộ điểm không hợp lệ', () => {
    const small = faceRegionsFromMesh(syntheticMesh(), 500, 450);
    for (const r of small) expect(r.rect.x + r.rect.w <= 500 && r.rect.y + r.rect.h <= 450).toBe(true);
    expect(faceRegionsFromMesh([], 800, 800)).toEqual([]);
    expect(faceRegionsFromMesh(syntheticMesh().slice(0, 100), 800, 800)).toEqual([]);
    const bad = syntheticMesh(); bad[10] = [NaN, 200, 0];
    expect(faceRegionsFromMesh(bad, 800, 800)).toEqual([]);
  });
});
