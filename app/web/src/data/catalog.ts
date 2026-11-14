// Danh mục dùng trong phiếu khám. Dân tộc, nghề nghiệp, tỉnh/xã, ICD-10 và chỉ số xét nghiệm là DANH MỤC CHUẨN (mã theo quy định), đổi từ file danh mục
// bằng tools/import-danhmuc.mjs (xem app/web/src/data/gen/README.md). Các mục còn lại (mẫu phiếu, đơn vị mẫu, tiền sử...) là dữ liệu mẫu tự soạn.
import dantocData from './gen/dantoc.json';
import diachiData from './gen/diachi.json';
import mauxnData from './gen/mauxn.json';
import nghenghiepData from './gen/nghenghiep.json';
import xetnghiemData from './gen/xetnghiem.json';

export const TEMPLATES = [
  { id: 'adult', ten: '1. Giấy khám sức khoẻ cho người từ đủ 18 tuổi trở lên', child: false },
  { id: 'child', ten: '2. Giấy KSK và KSK định kỳ dùng cho người từ đủ 06 đến dưới 18 tuổi', child: true },
] as const;

export interface Unit { ma: string; ten: string }

// Đơn vị (trường/công ty) có sẵn + đơn vị người dùng tự thêm trong ứng dụng (lưu trên máy này). Mã đơn vị sinh từ tên theo quy tắc cố định,
// nên nhập CÙNG tên trên hai máy thì ra CÙNG mã và hai máy thấy chung một danh sách (máy chủ chỉ thấy HMAC của mã này).
export const UNITS: Unit[] = [
  { ma: 'THCS-TAN-TIEN', ten: '04 - TRƯỜNG THCS TÂN TIẾN - TP. ĐỒNG NAI' },
  { ma: 'TRUONG-A', ten: '01 - TRƯỜNG THPT MẪU A - QUẬN 1 - TP.HCM' },
  { ma: 'TRUONG-B', ten: '02 - TRƯỜNG THCS MẪU B - THỦ ĐỨC - TP.HCM' },
  { ma: 'CTY-C', ten: '03 - CÔNG TY TNHH MẪU C - BIÊN HÒA - ĐỒNG NAI' },
  // Các đơn vị đã nhập từ các file Excel cũ (E:/NHAP LIEU). Để CỐ ĐỊNH trong mã nguồn: danh sách do người dùng tự thêm chỉ nằm trong trình duyệt
  // (localStorage) nên đổi trình duyệt/cửa sổ ẩn danh là mất tên trường dù dữ liệu vẫn còn trên máy chủ.
  { ma: '05-XUAN-HOA', ten: '05- Xuân Hòa' },
  { ma: 'TH-THCS-PHU-AN', ten: '06 - TRƯỜNG TH THCS PHÚ AN' },
  { ma: 'TIN-DUC', ten: '07 - TÍN ĐỨC' },
  { ma: 'TH-CHU-VAN-AN', ten: '08 - TRƯỜNG TH CHU VĂN AN' },
  { ma: 'VO-TRUONG-TOAN', ten: '09 - TRƯỜNG VÕ TRƯỜNG TOẢN' },
  { ma: 'CNM-LONGWELL', ten: '10 - CÔNG TY CNM LONGWELL' },
  { ma: 'TH-PHUOC-TAN', ten: '11 - TRƯỜNG TH PHƯỚC TÂN' },
];

const BUILT_IN = UNITS.length;       // các đơn vị có sẵn ở trên; chỉ phần thêm sau đó mới lưu vào trình duyệt
const UNITS_KEY = 'medabe.units';
let unitsVersion = 0;
const unitListeners = new Set<() => void>();
export const subscribeUnits = (l: () => void) => { unitListeners.add(l); return () => void unitListeners.delete(l); };
export const unitsSnapshot = () => unitsVersion;

/** Tên -> mã đơn vị: bỏ dấu, chữ hoa, ký tự lạ thành dấu gạch ngang (vd "Trường THCS Lê Lợi" -> "TRUONG-THCS-LE-LOI"). */
export const unitCode = (ten: string) =>
  ten.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

try {
  for (const u of JSON.parse(localStorage.getItem(UNITS_KEY) ?? '[]') as Unit[]) {
    if (u && typeof u.ma === 'string' && typeof u.ten === 'string' && u.ma && !UNITS.some((x) => x.ma === u.ma)) UNITS.push({ ma: u.ma, ten: u.ten });
  }
} catch { /* không có localStorage hoặc dữ liệu hỏng: chỉ dùng danh sách có sẵn */ }

/** Thêm một trường/công ty. Trả về đơn vị (đã có thì trả về đơn vị cũ), hoặc ném lỗi nếu tên không hợp lệ. */
export function addUnit(rawName: string): Unit {
  const ten = rawName.trim().replace(/\s+/g, ' ');
  const ma = unitCode(ten);
  if (ten.length < 3 || ma.length < 3) throw new Error('Tên trường/công ty cần ít nhất 3 ký tự (chữ hoặc số)');
  const have = UNITS.find((u) => u.ma === ma);
  if (have) return have;
  const unit = { ma, ten };
  UNITS.push(unit);
  try { localStorage.setItem(UNITS_KEY, JSON.stringify(UNITS.slice(BUILT_IN))); } catch { /* vẫn dùng được trong phiên này */ }
  unitsVersion++;
  unitListeners.forEach((l) => l());
  return unit;
}

/** 60 dân tộc theo danh mục chuẩn (Kinh đứng đầu). */
export const DAN_TOC: string[] = (dantocData as [string, string][]).map(([, ten]) => ten);
export const DOI_TUONG = ['Học sinh', 'Sinh viên', 'Người lao động', 'Cán bộ, viên chức', 'Khác'];
export const NGUON_CHI_TRA = ['Người sử dụng lao động', 'Bảo hiểm y tế', 'Tự túc', 'Nhà trường / Doanh nghiệp', 'Ngân sách nhà nước'];
export const NHOM_MAU = ['A', 'B', 'AB', 'O', 'Chưa xác định'];
export const QUAN_HE = ['Cha', 'Mẹ', 'Ông/Bà', 'Anh/Chị', 'Họ hàng', 'Khác'];
/** Nghề nghiệp theo danh mục chuẩn, dạng "02 - Lực lượng công an" (đúng kiểu ô chọn của phần mềm KSK). */
export const NGHE_NGHIEP: string[] = (nghenghiepData as [string, string][]).map(([ma, ten]) => ma + ' - ' + ten);

const D = diachiData as unknown as { tinh: [string, string][]; xa: Record<string, string[]> };
/** Tỉnh/thành phố -> danh sách xã/phường (34 tỉnh, hơn 3.300 xã/phường). */
export const DIA_CHI: Record<string, string[]> = Object.fromEntries(D.tinh.map(([ma, ten]) => [ten, D.xa[ma] ?? []]));

export const TIEN_SU = ['Tim mạch', 'Hô hấp', 'Tiêu hoá', 'Thận - Tiết niệu', 'Thần kinh', 'Tâm thần', 'Dị ứng', 'Đã phẫu thuật', 'Bệnh truyền nhiễm', 'Cận thị / tật khúc xạ'];

/** Khám lâm sàng theo chuyên khoa: mỗi chuyên khoa là một bản ghi mã hoá riêng (chỉ bác sĩ khoa đó đọc được). Mỗi mục có kết quả + phân loại. */
export const LAM_SANG = [
  { khoa: 'Nhi', ten: 'Khám Nhi khoa', muc: ['Tuần hoàn', 'Hô hấp', 'Tiêu hoá', 'Thận - Tiết niệu - Sinh dục', 'Thần kinh', 'Tâm thần'] },
  { khoa: 'Mat', ten: 'Khám Mắt', muc: ['Mắt phải không kính', 'Mắt trái không kính', 'Mắt phải có kính', 'Mắt trái có kính', 'Bệnh lý mắt'] },
  { khoa: 'TMH', ten: 'Khám Tai - Mũi - Họng', muc: ['Tai trái (nói thường)', 'Tai phải (nói thường)', 'Tai trái (nói thầm)', 'Tai phải (nói thầm)', 'Các bệnh TMH'] },
  { khoa: 'RHM', ten: 'Khám Răng - Hàm - Mặt', muc: ['Hàm trên', 'Hàm dưới', 'Các bệnh RHM'] },
] as const;
export const PHAN_LOAI = ['1', '2', '3', '4', '5'];
export interface LsItem { kq: string; loai: string }
export type LamSangData = Record<string, LsItem>;
/** Kết quả mặc định khi chọn "Bình thường": đúng giá trị mặc định của phần mềm KSK (tai 5m/0,5m, sức nhai 100%, thị lực 10/10, các ô bệnh để trống). */
const BINH_THUONG: Record<string, string> = {
  'Mắt phải không kính': '10/10', 'Mắt trái không kính': '10/10', 'Mắt phải có kính': '', 'Mắt trái có kính': '',
  'Tai trái (nói thường)': '5', 'Tai phải (nói thường)': '5', 'Tai trái (nói thầm)': '0.5', 'Tai phải (nói thầm)': '0.5',
  'Hàm trên': 'sức nhai 100%', 'Hàm dưới': 'sức nhai 100%',
  'Bệnh lý mắt': '', 'Các bệnh TMH': '', 'Các bệnh RHM': '',
};
const fill = (muc: readonly string[]): LamSangData =>
  Object.fromEntries(muc.map((m) => { const kq = BINH_THUONG[m] ?? 'Bình thường'; return [m, { kq, loai: kq === '' && /có kính/.test(m) ? '' : '1' }]; }));
const both = (muc: readonly string[], ...rules: { match: RegExp; kq: string; loai: string }[]) => {
  const d = fill(muc);
  for (const r of rules) for (const m of muc) if (r.match.test(m)) d[m] = { kq: r.kq, loai: r.loai };
  return d;
};
const CAN_THI = { match: /Bệnh lý mắt/, kq: 'Cận thị', loai: '3' };
const SAU_RANG = { match: /Các bệnh RHM/, kq: 'Sâu răng', loai: '3' };
/** Mẫu nhanh (tương ứng thư mục MacDinh6-18 của phần mềm KSK). */
export const MAU_NHANH: Record<string, (muc: readonly string[]) => LamSangData> = {
  'Bình thường': (muc) => fill(muc),
  'Bình thường + cận thị': (muc) => both(muc, CAN_THI),
  'Bình thường + sâu răng': (muc) => both(muc, SAU_RANG),
  'Cận thị + sâu răng': (muc) => both(muc, CAN_THI, SAU_RANG),
};

export interface XetNghiem {
  ma: string; ten: string; dv: string;
  nam: [number, number] | null; nu: [number, number] | null;   // khoảng tham chiếu số (null: không có khoảng số, vd "(-) hoặc (+)")
  tcNam: string; tcNu: string;                                   // khoảng tham chiếu nguyên văn
}
/** 391 chỉ số xét nghiệm theo danh mục chuẩn (mã H.. huyết học, S.. sinh hoá, V.. ...). */
export const XET_NGHIEM: XetNghiem[] = xetnghiemData as XetNghiem[];
const XN_BY_MA = new Map(XET_NGHIEM.map((x) => [x.ma, x]));
export const xetNghiemOf = (ma: string) => XN_BY_MA.get(ma);
/** Mẫu xét nghiệm có sẵn ("Ksk thường quy") cho người lớn và cho 6-18 tuổi. */
export const MAU_XN: { adult: { ten: string; ma: string[] }[]; child: { ten: string; ma: string[] }[] } = mauxnData;
/** Tìm chỉ số theo mã hoặc tên (không phân biệt dấu/hoa thường). */
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const XN_INDEX = XET_NGHIEM.map((x) => fold(x.ma + ' ' + x.ten));
export const searchXetNghiem = (q: string, limit = 20): XetNghiem[] => {
  const k = fold(q.trim());
  return k ? XET_NGHIEM.filter((_, i) => XN_INDEX[i].includes(k)).slice(0, limit) : [];
};

// ICD-10 (hơn 12.000 mã) khá nặng nên chỉ nạp khi cần (lần đầu mở ô chẩn đoán).
export type IcdEntry = [string, string];
let icdPromise: Promise<IcdEntry[]> | undefined;
export const loadIcd = (): Promise<IcdEntry[]> => (icdPromise ??= import('./gen/icd.json').then((m) => m.default as unknown as IcdEntry[]));
/** Tìm theo mã (bắt đầu bằng) hoặc theo tên (chứa), không phân biệt dấu. */
export function searchIcd(all: IcdEntry[], q: string, limit = 30): IcdEntry[] {
  const k = fold(q.trim());
  if (k.length < 2) return [];
  const byCode = all.filter(([ma]) => fold(ma).startsWith(k));
  const byName = byCode.length >= limit ? [] : all.filter(([ma, ten]) => !fold(ma).startsWith(k) && fold(ten).includes(k));
  return [...byCode, ...byName].slice(0, limit);
}

export type Sex = 'nam' | 'nu';
export function flag(ma: string, val: number, sex: Sex): 'thap' | 'cao' | 'binhthuong' {
  const r = XN_BY_MA.get(ma)?.[sex];
  if (!r) return 'binhthuong';
  return val < r[0] ? 'thap' : val > r[1] ? 'cao' : 'binhthuong';
}
