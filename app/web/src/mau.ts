// MẪU MẶC ĐỊNH do người dùng tự lưu cho phần Khám lâm sàng (tương ứng nút "Lưu mẫu / Xóa mẫu mặc định" của phần mềm KSK cũ, thư mục MacDinh6-18).
// Mẫu chỉ chứa nội dung kết quả khám thường gặp ("bình thường", "cận thị"...) — KHÔNG có thông tin bệnh nhân — nên lưu ngay trong trình duyệt của máy này.
import type { LamSangData } from './data/catalog.js';

export type Mau = Record<string, LamSangData>;       // khoa -> kết quả từng mục
const KEY = 'medabe.mauLamSang';

export function docMau(): Record<string, Mau> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Mau>;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}
function ghi(all: Record<string, Mau>) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* đầy bộ nhớ / không có localStorage: mẫu chỉ dùng trong phiên này */ } }

export function luuMau(ten: string, mau: Mau): Record<string, Mau> {
  const all = { ...docMau(), [ten.trim()]: mau };
  ghi(all);
  return all;
}
export function xoaMau(ten: string): Record<string, Mau> {
  const all = { ...docMau() };
  delete all[ten];
  ghi(all);
  return all;
}
