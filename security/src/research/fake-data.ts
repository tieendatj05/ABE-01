// DỮ LIỆU GIẢ cho nghiên cứu. Không có người thật: mã bệnh nhân BN-GIA-xxxx, CCCD bắt đầu "999" (đầu số tỉnh không tồn tại),
// họ tên ghép ngẫu nhiên từ danh sách chung, điện thoại 0000.... Mỗi mục chứa một "canary" riêng để kiểm thử rò rỉ
// (tìm chuỗi canary trong kho/ gói tin: thấy = lộ bản rõ).
export interface FakePatient {
  code: string;
  hanhchinh: { hoTen: string; ngaySinh: string; gioiTinh: 'Nam' | 'Nu'; cccd: string; diaChi: string; dienThoai: string; canary: string };
  lamsangNhi: { chieuCao: number; canNang: number; tinhTrang: string; ketLuan: string; canary: string };
  lamsangMat: { thiLucPhai: string; thiLucTrai: string; tatKhucXa: string; ketLuan: string; canary: string };
}

const HO = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui'];
const DEM = ['Van', 'Thi', 'Minh', 'Ngoc', 'Quoc', 'Thanh'];
const TEN = ['An', 'Binh', 'Chi', 'Dung', 'Giang', 'Hanh', 'Khoa', 'Lan', 'Mai', 'Nam', 'Phuc', 'Quynh'];
const NHI = ['Phat trien the chat binh thuong', 'Thieu can nhe', 'Thua can', 'Viem hong tai phat', 'Can theo doi dinh duong'];
const MAT = ['10/10', '9/10', '8/10', '7/10', '5/10'];

/** PRNG xác định (mulberry32) để dữ liệu tái lập được. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function fakePatients(n: number, seed = 20261030): FakePatient[] {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const digits = (k: number) => Array.from({ length: k }, () => Math.floor(r() * 10)).join('');
  return Array.from({ length: n }, (_, i) => {
    const no = String(i + 1).padStart(4, '0');
    const tag = `${seed.toString(36)}${no}`;
    return {
      code: `BN-GIA-${no}`,
      hanhchinh: {
        hoTen: `${pick(HO)} ${pick(DEM)} ${pick(TEN)}`, ngaySinh: `20${String(10 + Math.floor(r() * 10))}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`,
        gioiTinh: r() < 0.5 ? 'Nam' : 'Nu', cccd: `999${digits(9)}`, diaChi: `So ${Math.floor(r() * 200)} duong gia, phuong gia, TP gia`, dienThoai: `0000${digits(6)}`,
        canary: `CANARY-HC-${tag}`,
      },
      lamsangNhi: { chieuCao: 100 + Math.floor(r() * 60), canNang: 20 + Math.floor(r() * 40), tinhTrang: pick(NHI), ketLuan: `Nhi: ${pick(NHI)}`, canary: `CANARY-NHI-${tag}` },
      lamsangMat: { thiLucPhai: pick(MAT), thiLucTrai: pick(MAT), tatKhucXa: r() < 0.3 ? 'Can thi nhe' : 'Khong', ketLuan: `Mat: ${pick(NHI)}`, canary: `CANARY-MAT-${tag}` },
    };
  });
}
