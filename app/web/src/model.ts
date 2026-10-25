// Mô hình dữ liệu của phiếu khám (phía ứng dụng) + kiểm tra hợp lệ. Việc mã hoá/policy do SDK bảo mật lo, ở đây không có mật mã.
import type { RecordType } from '../../../security/src/index.js';

export interface HanhChinh {
  lop?: string;
  hoTen: string; gioiTinh: 'nam' | 'nu'; ngaySinh: string; cccd: string; ngayCap: string; noiCap: string;
  danToc: string; doiTuong: string; nguonChiTra: string; nhomMau: string; dienThoai: string;
  tinh: string; phuongXa: string; diaChi: string; ngheNghiep?: string;
  giamHo: { hoTen: string; quanHe: string; cccd: string; dienThoai: string };
  trangThai: 'chua' | 'da';
}
export interface LanKham { ngayKham: string; lyDo: string; ghiChu: string }
export interface TienSu { co: string[]; ghiChu: string }
export interface TheLuc { chieuCao: string; canNang: string; mach: string; huyetApTT: string; huyetApTTr: string; nhipTho: string; nhietDo: string; loai: number }
export interface KetLuan { loai: number; ketLuan: string; chanDoan: string[][]; ngay: string }
export interface CanLamSang { gioiTinh: 'nam' | 'nu'; kq: Record<string, string> }

const today = () => new Date().toISOString().slice(0, 10);
export const blank = {
  hanhchinh: (): HanhChinh => ({
    lop: '', hoTen: '', gioiTinh: 'nam', ngaySinh: '', cccd: '', ngayCap: '', noiCap: '', danToc: 'Kinh', doiTuong: '', nguonChiTra: '', nhomMau: '',
    dienThoai: '', tinh: '', phuongXa: '', diaChi: '', ngheNghiep: '', giamHo: { hoTen: '', quanHe: '', cccd: '', dienThoai: '' }, trangThai: 'chua',
  }),
  lankham: (): LanKham => ({ ngayKham: today(), lyDo: 'Khám sức khoẻ định kỳ', ghiChu: '' }),
  tiensu: (): TienSu => ({ co: [], ghiChu: '' }),
  thecuc: (): TheLuc => ({ chieuCao: '', canNang: '', mach: '', huyetApTT: '', huyetApTTr: '', nhipTho: '', nhietDo: '', loai: 1 }),
  ketluan: (): KetLuan => ({ loai: 1, ketLuan: '', chanDoan: [], ngay: today() }),
  canlamsang: (): CanLamSang => ({ gioiTinh: 'nam', kq: {} }),
};

export function tuoi(ngaySinh: string): string {
  const d = new Date(ngaySinh);
  if (!ngaySinh || Number.isNaN(d.getTime())) return '';
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a >= 0 ? String(a) : '';
}
export const bmi = (cao: string, nang: string) => {
  const h = Number(cao) / 100, w = Number(nang);
  return h > 0 && w > 0 ? (w / (h * h)).toFixed(1) : '';
};

/** Lỗi nhập hành chính (các trường có dấu * trong phiếu). Trả về [] nếu hợp lệ. */
export function validateHanhChinh(h: HanhChinh): string[] {
  const e: string[] = [];
  if (!h.hoTen.trim()) e.push('Thiếu họ và tên');
  if (!h.ngaySinh || Number.isNaN(new Date(h.ngaySinh).getTime())) e.push('Ngày sinh không hợp lệ');
  if (!/^\d{12}$/.test(h.cccd)) e.push('Số định danh cá nhân phải gồm 12 chữ số');
  if (!h.nguonChiTra) e.push('Chưa chọn nguồn chi trả');
  if (h.dienThoai && !/^0\d{9}$/.test(h.dienThoai)) e.push('Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0');
  return e;
}

/** Quyền GHI của giao diện (gợi ý cho người dùng). Bảo mật thật nằm ở mã hoá: ai không có thuộc tính thì không đọc được. */
export function canWrite(type: RecordType, attrs: string[], khoa?: string): boolean {
  const has = (a: string) => attrs.includes('MED:' + a);
  switch (type) {
    case 'hanhchinh': return has('Role:TiepDon');
    case 'lankham': case 'tiensu': case 'thecuc': return has('Role:BacSi');
    case 'lamsang': return has('Role:BacSi') && has('Khoa:' + khoa);
    case 'canlamsang': return has('Role:KTV');
    case 'ketluan': return has('Role:KetLuan');
  }
}

// ---------- Kiểm tra chi tiết (dùng cho màn hình Import: Dòng / Họ tên / Cột / Giá trị / Nội dung lỗi) ----------
export interface FieldError { col: string; value: string; msg: string }

export function validateDetailed(h: HanhChinh): FieldError[] {
  const e: FieldError[] = [];
  if (!h.hoTen.trim()) e.push({ col: 'Họ tên', value: '', msg: 'Thiếu họ và tên' });
  if (!h.ngaySinh || Number.isNaN(new Date(h.ngaySinh).getTime())) e.push({ col: 'Ngày sinh', value: h.ngaySinh, msg: 'Ngày sinh không hợp lệ (cần dd/mm/yyyy)' });
  if (!/^\d{12}$/.test(h.cccd)) e.push({ col: 'Số CCCD', value: h.cccd, msg: 'Số định danh cá nhân phải gồm 12 chữ số' });
  if (h.ngayCap && Number.isNaN(new Date(h.ngayCap).getTime())) e.push({ col: 'Ngày cấp', value: h.ngayCap, msg: 'Ngày cấp không hợp lệ' });
  if (h.dienThoai && !/^0\d{9}$/.test(h.dienThoai)) e.push({ col: 'Điện thoại', value: h.dienThoai, msg: 'Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0' });
  if (h.giamHo.cccd && !/^\d{12}$/.test(h.giamHo.cccd)) e.push({ col: 'CCCD người giám hộ', value: h.giamHo.cccd, msg: 'Phải gồm 12 chữ số' });
  return e;
}

/** Kiểm tra theo mẫu phiếu: Mẫu 18 (>= 18 tuổi), Mẫu 6 đến 18, Mẫu dưới 6. */
export type Mau = '18' | '6-18' | 'duoi6';
export function checkMau(h: HanhChinh, mau: Mau): FieldError | null {
  const a = Number(tuoi(h.ngaySinh));
  if (Number.isNaN(a)) return null;
  const ok = mau === '18' ? a >= 18 : mau === '6-18' ? a >= 6 && a < 18 : a < 6;
  const ten = mau === '18' ? 'Mẫu 18' : mau === '6-18' ? 'Mẫu 6 đến 18' : 'Mẫu dưới 6';
  return ok ? null : { col: 'Ngày sinh', value: h.ngaySinh, msg: `Tuổi ${a} không phù hợp ${ten}` };
}
