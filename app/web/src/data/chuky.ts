// Thư viện chữ ký bác sĩ (ảnh chữ ký tay) cho khung "Họ tên và chữ ký bác sĩ" ở phần Khám lâm sàng.
// Ảnh là minh hoạ hiển thị; chữ ký có giá trị là chữ ký số ECDSA trong từng bản ghi (✔ / ✘ vẫn do mật mã quyết định).
// Danh sách bác sĩ + ảnh lấy từ bộ danh mục mẫu của phần mềm KSK (ChuKy/<MaBS>.png, DanhMucJson/ksk_bacsi.json); 011 chưa có ảnh.
const urls = import.meta.glob('./chuky/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface BacSiChuKy { ma: string; ten: string; src: string }

const DANH_SACH: [string, string][] = [
  ['001', 'Võ Lương Vinh'], ['002', 'Trần Anh Tuyên'], ['003', 'Phạm Vi Long'], ['004', 'Tô Ánh Tuyết'], ['005', 'Nguyễn Văn Nhớ'],
  ['006', 'Nguyễn Viết Hiền'], ['007', 'Võ Thị Hoàng Yến'], ['008', 'Lê Kim Hương'], ['009', 'Lê Mỹ Duyên'], ['010', 'Nguyễn Đăng Vinh'],
  ['012', 'Trần Trung Thuận'], ['013', 'Bùi Văn Dũng Anh'], ['014', 'Nguyễn Thành Long'], ['015', 'Mai Hữu Thiết'],
];

const BAC_SI: BacSiChuKy[] = DANH_SACH.flatMap(([ma, ten]) => {
  const src = urls[`./chuky/${ma}.png`];
  return src ? [{ ma, ten, src }] : [];
});

/** Chuyên khoa lâm sàng của ứng dụng -> bác sĩ mặc định (theo chuyên khoa trong danh mục KSK; Nhi dùng bác sĩ Nội vì danh mục không có Nhi). */
const MAC_DINH: Record<string, string> = { Nhi: '001', Mat: '010', TMH: '004', RHM: '009' };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface ChuKyChon extends BacSiChuKy {
  /** true: khớp theo tên người ký; false: chữ ký mẫu mặc định của chuyên khoa. */
  theoTen: boolean;
}

/** Chọn ảnh chữ ký cho một khối lâm sàng: ưu tiên bác sĩ trùng tên với người ký, nếu không thì bác sĩ mặc định của chuyên khoa. */
export function chuKyFor(tenNguoiKy: string, khoa: string): ChuKyChon | null {
  const n = norm(tenNguoiKy);
  const byName = n ? BAC_SI.find((b) => n.includes(norm(b.ten))) : undefined;
  if (byName) return { ...byName, theoTen: true };
  const def = BAC_SI.find((b) => b.ma === MAC_DINH[khoa]);
  return def ? { ...def, theoTen: false } : null;
}
