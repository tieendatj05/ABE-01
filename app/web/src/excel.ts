// Đọc danh sách học sinh/người khám từ file Excel (.xlsx) và đổi sang mục Hành chính. Tự nhận cột theo TÊN TIÊU ĐỀ nên
// chịu được file có cột trống xen kẽ. Không có mật mã ở đây - chỉ phân tích dữ liệu; việc mã hoá do SDK bảo mật làm khi lưu.
import { blank, type HanhChinh } from './model.js';

export type Cell = string | number | boolean | Date | null | undefined;
export type Row = Cell[];

/** Bỏ dấu + chữ thường + gọn khoảng trắng: "Họ và tên bố, mẹ" -> "ho va ten bo, me". */
export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

type Field = 'lop' | 'hoTen' | 'gioiTinh' | 'ngaySinh' | 'danToc' | 'cccd' | 'ngayCap' | 'noiCap' | 'gh.hoTen' | 'gh.cccd' | 'tinh' | 'phuongXa' | 'diaChi' | 'nhomMau' | 'doiTuong' | 'dienThoai';

// Thứ tự quan trọng: mẫu cụ thể đặt trước mẫu chung (vd "ma dinh danh ... cua bo, me" trước "so cmnd/cccd").
const RULES: [Field, (h: string) => boolean][] = [
  ['gh.cccd', (h) => /(ma dinh danh|cccd).*(bo|me|giam ho)/.test(h)],
  ['gh.hoTen', (h) => /(ho va ten|ho ten).*(bo|me|giam ho)/.test(h)],
  ['ngayCap', (h) => /^ngay cap/.test(h)],
  ['noiCap', (h) => /^noi cap/.test(h)],
  ['cccd', (h) => /(cmnd|cccd|dinh danh)/.test(h) && !/(bo|me|giam ho)/.test(h)],
  ['hoTen', (h) => h === 'ho ten' || h === 'ho va ten'],
  ['gioiTinh', (h) => /^gioi tinh/.test(h)],
  ['ngaySinh', (h) => /^ngay sinh/.test(h)],
  ['danToc', (h) => /^dan toc/.test(h)],
  ['tinh', (h) => /^tinh/.test(h)],
  ['phuongXa', (h) => /^(xa|phuong)/.test(h)],
  ['diaChi', (h) => /^noi o hien tai/.test(h)],
  ['nhomMau', (h) => /^nhom mau/.test(h)],
  ['doiTuong', (h) => /^doi tuong/.test(h)],
  ['dienThoai', (h) => /^(dien thoai|sdt|so dien thoai)/.test(h)],
  ['lop', (h) => h === 'lop'],
];

export interface Mapped { headerRow: number; cols: Partial<Record<Field, number>>; missing: Field[] }

/** Tìm dòng tiêu đề (dòng đầu tiên nhận được >= 4 cột đã biết) và ánh xạ cột. */
export function mapHeader(rows: Row[]): Mapped | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols: Partial<Record<Field, number>> = {};
    rows[i].forEach((cell, idx) => {
      const h = norm(cell);
      if (!h) return;
      const hit = RULES.find(([f, test]) => cols[f] === undefined && test(h));
      if (hit) cols[hit[0]] = idx;
    });
    if (Object.keys(cols).length >= 4 && cols.hoTen !== undefined) {
      const need: Field[] = ['hoTen', 'ngaySinh', 'cccd'];
      return { headerRow: i, cols, missing: need.filter((f) => cols[f] === undefined) };
    }
  }
  return null;
}

const s = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const digits = (v: Cell, width = 12) => {
  if (typeof v === 'number') return String(Math.trunc(v)).padStart(width, '0'); // CCCD bị Excel đổi thành số: khôi phục số 0 đầu
  return s(v).replace(/[^\d]/g, '');
};

/** dd/mm/yyyy, d/m/yyyy, yyyy-mm-dd, Date, số serial Excel -> yyyy-mm-dd ('' nếu không đọc được). */
export function parseDate(v: Cell): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400_000)).toISOString().slice(0, 10);
  const t = s(v);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return ok(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  return m ? ok(+m[1], +m[2], +m[3]) : '';
}
function ok(y: number, mo: number, d: number): string {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : '';
}

export interface Imported { row: number; lop: string; data: HanhChinh }

export function rowsToHanhChinh(rows: Row[], m: Mapped, defaults: { nguonChiTra: string }): Imported[] {
  const c = m.cols;
  const g = (r: Row, f: Field) => (c[f] === undefined ? undefined : r[c[f]!]);
  const out: Imported[] = [];
  rows.slice(m.headerRow + 1).forEach((r, i) => {
    if (!r || !r.some((x) => x != null && String(x).trim() !== '')) return;          // bỏ dòng trống
    const h = blank.hanhchinh();
    const gt = norm(g(r, 'gioiTinh'));
    out.push({
      row: m.headerRow + i + 2,
      lop: s(g(r, 'lop')),
      data: {
        ...h,
        lop: s(g(r, 'lop')),
        hoTen: s(g(r, 'hoTen')).toUpperCase(),
        gioiTinh: /^(nu|2|f)/.test(gt) ? 'nu' : 'nam',
        ngaySinh: parseDate(g(r, 'ngaySinh')),
        cccd: digits(g(r, 'cccd')),
        ngayCap: parseDate(g(r, 'ngayCap')),
        noiCap: s(g(r, 'noiCap')),
        danToc: s(g(r, 'danToc')) || 'Kinh',
        doiTuong: s(g(r, 'doiTuong')),
        nguonChiTra: defaults.nguonChiTra,
        nhomMau: s(g(r, 'nhomMau')),
        dienThoai: digits(g(r, 'dienThoai'), 10),
        tinh: s(g(r, 'tinh')),
        phuongXa: s(g(r, 'phuongXa')),
        diaChi: s(g(r, 'diaChi')),
        giamHo: { hoTen: s(g(r, 'gh.hoTen')), quanHe: '', cccd: digits(g(r, 'gh.cccd')), dienThoai: '' },
        trangThai: 'chua',
      },
    });
  });
  return out;
}

// ---------- Sheet kết quả khám ("Thêm xét nghiệm"): chiều cao, cân nặng, mạch, huyết áp, nhi, mắt, TMH, RHM, phân loại ----------
import { LAM_SANG, MAU_NHANH, type LamSangData } from './data/catalog.js';
import type { KetLuan, TheLuc } from './model.js';

type RField = 'cccd' | 'chieuCao' | 'canNang' | 'mach' | 'huyetAp' | 'nhi' | 'matPK' | 'matTK' | 'matPC' | 'matTC' | 'benhMat' | 'tmh' | 'rhm' | 'loai';
const RRULES: [RField, (h: string) => boolean][] = [
  ['cccd', (h) => /(cmnd|cccd|dinh danh)/.test(h) && !/(bo|me|giam ho)/.test(h)],
  ['chieuCao', (h) => /^chieu cao/.test(h)], ['canNang', (h) => /^can nang/.test(h)], ['mach', (h) => h === 'mach'], ['huyetAp', (h) => /^huyet ap/.test(h)],
  ['nhi', (h) => h === 'nhi'],
  ['matPK', (h) => /^mat phai khong kinh/.test(h)], ['matTK', (h) => /^mat trai khong kinh/.test(h)],
  ['matPC', (h) => /^mat phai co kinh/.test(h)], ['matTC', (h) => /^mat trai co kinh/.test(h)], ['benhMat', (h) => /^benh ly mat/.test(h)],
  ['tmh', (h) => /^tai mui hong/.test(h)], ['rhm', (h) => /^rang ham mat/.test(h)], ['loai', (h) => /^phan loai/.test(h)],
];
export interface ResultMapped { headerRow: number; cols: Partial<Record<RField, number>> }
export function mapResultHeader(rows: Row[]): ResultMapped | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols: Partial<Record<RField, number>> = {};
    rows[i].forEach((cell, idx) => { const h = norm(cell); const hit = h && RRULES.find(([f, t]) => cols[f] === undefined && t(h)); if (hit) cols[hit[0]] = idx; });
    if (cols.cccd !== undefined && Object.keys(cols).length >= 2) return { headerRow: i, cols };
  }
  return null;
}
/** Số thập phân kiểu Việt Nam "150,5" -> "150.5" (ô nhập số của phiếu khám chỉ nhận dấu chấm). */
const dec = (x: string) => x.replace(/,/g, ".");
const isNormal = (v: string) => /^(binh thuong|10\/10|9\/10|8\/10|tot|khong)/.test(norm(v));
export interface ResultRow { row: number; cccd: string; thecuc?: TheLuc; lamsang: Partial<Record<'Nhi' | 'Mat' | 'TMH' | 'RHM', LamSangData>>; ketluan?: KetLuan }

export function rowsToResults(rows: Row[], m: ResultMapped): ResultRow[] {
  const c = m.cols;
  const v = (r: Row, f: RField) => (c[f] === undefined ? '' : s(r[c[f]!]));
  const out: ResultRow[] = [];
  rows.slice(m.headerRow + 1).forEach((r, i) => {
    if (!r || !r.some((x) => x != null && String(x).trim() !== '')) return;
    const cccd = c.cccd === undefined ? '' : digits(r[c.cccd]);
    const loai = /^[1-5]/.test(v(r, 'loai')) ? v(r, 'loai').slice(0, 1) : '';
    const ha = /^(\d{2,3})\s*[/-]\s*(\d{2,3})$/.exec(v(r, 'huyetAp'));
    const row: ResultRow = { row: m.headerRow + i + 2, cccd, lamsang: {} };
    if (v(r, 'chieuCao') || v(r, 'canNang') || v(r, 'mach') || ha) {
      row.thecuc = { chieuCao: dec(v(r, 'chieuCao')), canNang: dec(v(r, 'canNang')), mach: dec(v(r, 'mach')), huyetApTT: ha?.[1] ?? '', huyetApTTr: ha?.[2] ?? '', nhipTho: '', nhietDo: '', loai: Number(loai || 1) };
    }
    const spec = (khoa: 'Nhi' | 'Mat' | 'TMH' | 'RHM', vals: Record<string, string>) => {
      const k = LAM_SANG.find((x) => x.khoa === khoa)!;
      const base = MAU_NHANH['Bình thường'](k.muc);
      let any = false;
      for (const [name, val] of Object.entries(vals)) if (val) { base[name] = { kq: val, loai: isNormal(val) ? '1' : loai || '1' }; any = true; }  // mục bình thường luôn loại 1; phân loại tổng chỉ gắn vào mục bất thường
      if (any) row.lamsang[khoa] = base;
    };
    const nhi = v(r, 'nhi');
    spec('Nhi', Object.fromEntries(LAM_SANG[0].muc.map((n) => [n, nhi])));
    spec('Mat', { 'Mắt phải không kính': v(r, 'matPK'), 'Mắt trái không kính': v(r, 'matTK'), 'Mắt phải có kính': v(r, 'matPC'), 'Mắt trái có kính': v(r, 'matTC'), 'Bệnh lý mắt': v(r, 'benhMat') });
    const tmh = v(r, 'tmh');
    spec('TMH', Object.fromEntries(LAM_SANG[2].muc.map((n) => [n, tmh])));
    const rhm = v(r, 'rhm');
    spec('RHM', Object.fromEntries(LAM_SANG[3].muc.map((n) => [n, rhm])));
    if (loai) row.ketluan = { loai: Number(loai), ketLuan: '', chanDoan: [], ngay: new Date().toISOString().slice(0, 10) };
    out.push(row);
  });
  return out;
}
