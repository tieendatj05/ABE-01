// NẠP ẢNH MẶT NGƯỜI THẬT (bộ "Face Research Lab London Set", 102 người lớn, ảnh cười chính diện, CC BY 4.0, DOI 10.6084/m9.figshare.5047666.v5;
// tất cả người trong ảnh đã ký đồng ý cho dùng ảnh minh hoạ nghiên cứu) vào MÁY CHỦ DEMO đang chạy, qua đúng đường đi của sản phẩm:
//   ảnh mặt -> khoanh vùng (mắt / mũi+tai / miệng+hàm) -> mã hoá ABE từng vùng -> bác sĩ Mắt chỉ giải mã được đôi mắt, TMH chỉ mũi+tai, RHM chỉ miệng+hàm.
//
// DỮ LIỆU: họ tên + giới tính lấy từ tệp JSON do bạn cung cấp (mặc định E:/TLCN/du-lieu-anh/_ANH_MAT_THAT/nhan-vien-50.json, nằm NGOÀI kho mã).
// Mọi thứ khác là GIẢ: CCCD giả (999…), ngày sinh giả, và KHUÔN MẶT KHÔNG PHẢI của người mang tên đó — ảnh được gán NGẪU NHIÊN theo giới tính.
// Toạ độ vùng do mô hình FaceMesh chạy cục bộ tạo sẵn (landmarks.json cạnh ảnh); trước khi gán, ảnh được xếp ưu tiên những khuôn mặt LỘ RĂNG khi cười.
//
//   npx tsx app/test-ui/anh-mat-that-demo.ts --ke-hoach      (CHỈ IN kế hoạch, không cần máy chủ, không ghi gì; tên được rút gọn thành chữ cái đầu, thêm --hien-ten để hiện đủ)
//   npx tsx app/test-ui/anh-mat-that-demo.ts                  (nạp thật; chạy lại sẽ bỏ qua người đã có ảnh)
//   Tuỳ chọn: --don-vi=MA (mặc định CTY-C)  --anh=THƯ_MỤC  --nhan-vien=TỆP.json
// Ghi nguồn khi trình bày: DeBruine, L. & Jones, B. (2017), Face Research Lab London Set, figshare, CC BY 4.0.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { listImages, saveImage, type Rect, type Rgba } from '../../security/src/client/imaging.js';
import { UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';
import { cleanupDevices, loginDemo } from './demo-util.js';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(n + '='))?.slice(n.length + 1) ?? d;
const flag = (n: string) => process.argv.includes(n);
const DIR = resolve(arg('--anh', 'E:/TLCN/du-lieu-anh/_ANH_MAT_THAT'));
const STAFF = resolve(arg('--nhan-vien', join(DIR, 'nhan-vien-50.json')));
const UNIT = arg('--don-vi', 'CTY-C');
const planOnly = flag('--ke-hoach'), showNames = flag('--hien-ten');
// --co-san: KHÔNG tạo hồ sơ mới; chọn NGẪU NHIÊN trong các hồ sơ ĐÃ CÓ của đơn vị (đọc bằng nhaplieu01, người nhập) và gán ảnh cho đến khi hết ảnh theo từng giới tính.
const COSAN = flag('--co-san');
for (const f of [join(DIR, 'png800'), join(DIR, 'landmarks.json'), join(DIR, 'london_faces_info.csv'), STAFF]) if (!existsSync(f)) throw new Error(`Thiếu ${f}`);
if (!UNITS.some((u) => u.ma === UNIT)) throw new Error(`Không có đơn vị ${UNIT}. Có: ${UNITS.map((u) => u.ma).join(', ')}`);

// ---- giải mã PNG 8 bit (RGB hoặc RGBA, không xen kẽ) — đủ cho ảnh do System.Drawing xuất
function readPng(buf: Uint8Array): Rgba {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0; const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = v.getUint32(o); const type = String.fromCharCode(...buf.subarray(o + 4, o + 8)); const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { const d = new DataView(body.buffer, body.byteOffset); w = d.getUint32(0); h = d.getUint32(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    if (type === 'IDAT') idat.push(Buffer.from(body));
    o += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6) || interlace) throw new Error(`PNG không hỗ trợ (bit ${depth}, loại ${ctype}, xen kẽ ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp; const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), dst = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0, b = up[i], c = i >= bpp ? up[i - bpp] : 0;
      let add = 0;
      if (ft === 1) add = a; else if (ft === 2) add = b; else if (ft === 3) add = (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      dst[i] = (src[i] + add) & 255;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = px[i * bpp]; data[i * 4 + 1] = px[i * bpp + 1]; data[i * 4 + 2] = px[i * bpp + 2]; data[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255; }
  return { w, h, data };
}

// ---- dữ liệu đầu vào
type Box = { x0: number; y0: number; x1: number; y1: number };
interface Mark { mat: Box; mui: Box; mieng: Box; taiP: Box; taiT: Box; lip: Box }
const marks = JSON.parse(readFileSync(join(DIR, 'landmarks.json'), 'utf8')) as Record<string, Mark>;
const info = new Map(readFileSync(join(DIR, 'london_faces_info.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(','); return [c[0], { gender: c[2], eth: c[3] }] as const; }));
let pre: Awaited<ReturnType<typeof loginDemo>> | undefined;
const staffAll: { hoTen: string; gioiTinh: 'nam' | 'nu'; cccd?: string }[] = [];
if (COSAN) {
  pre = await loginDemo('nhaplieu01');
  const rows = await pre.listGroup(UNIT);
  for (const o of await pre.openMany(rows)) { const d = o?.data as { hoTen?: string; cccd?: string; gioiTinh?: 'nam' | 'nu' } | undefined; if (d?.cccd && d.hoTen && d.gioiTinh) staffAll.push({ hoTen: d.hoTen, gioiTinh: d.gioiTinh, cccd: d.cccd }); }
  console.log(`Đơn vị ${UNIT}: đọc được ${staffAll.length} hồ sơ có sẵn (do nhaplieu01 nhập).`);
} else staffAll.push(...(JSON.parse(readFileSync(STAFF, 'utf8')) as { hoTen: string; gioiTinh: 'nam' | 'nu' }[]));

const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry(20261112);
const shuffle = <T,>(a: T[]) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

/** Tỉ lệ điểm ảnh "trắng, ít màu" trong khung môi: dấu hiệu lộ răng. */
function teethRatio(px: Rgba, lip: Box): number {
  const x0 = Math.round(lip.x0 + 0.1 * (lip.x1 - lip.x0)), x1 = Math.round(lip.x1 - 0.1 * (lip.x1 - lip.x0)), y0 = Math.round(lip.y0 + 0.2 * (lip.y1 - lip.y0)), y1 = Math.round(lip.y1 - 0.2 * (lip.y1 - lip.y0));
  let n = 0, hit = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * px.w + x) * 4, r = px.data[i], g = px.data[i + 1], b = px.data[i + 2]; n++; if (Math.min(r, g, b) > 160 && Math.max(r, g, b) - Math.min(r, g, b) < 55) hit++; }
  return n ? hit / n : 0;
}
const TEETH_MIN = 0.06;
const faces = Object.keys(marks).sort().map((id) => {
  const bytes = new Uint8Array(readFileSync(join(DIR, 'png800', `${id}.png`)));
  const px = readPng(bytes);
  return { id, bytes, px, teeth: teethRatio(px, marks[id].lip), gender: info.get(id)?.gender ?? '?', eth: info.get(id)?.eth ?? '' };
});
const pool = (g: 'male' | 'female') => { const all = faces.filter((f) => f.gender === g); return [...shuffle(all.filter((f) => f.teeth >= TEETH_MIN)), ...shuffle(all.filter((f) => f.teeth < TEETH_MIN))]; };
const pools = { nam: pool('male'), nu: pool('female') };
const staff = COSAN ? [] as typeof staffAll : staffAll;
if (COSAN) {
  const left = { nam: pools.nam.length, nu: pools.nu.length };
  for (const s of shuffle(staffAll)) { if (left[s.gioiTinh] > 0) { left[s.gioiTinh]--; staff.push(s); } }
}
const need = { nam: staff.filter((s) => s.gioiTinh === 'nam').length, nu: staff.filter((s) => s.gioiTinh === 'nu').length };
if (need.nam > pools.nam.length || need.nu > pools.nu.length) throw new Error(`Không đủ ảnh: cần ${need.nu} nữ + ${need.nam} nam, có ${pools.nu.length} nữ + ${pools.nam.length} nam`);

// ---- ghép: ngẫu nhiên theo giới tính (người có răng được ưu tiên)
const initials = (s: string) => s.split(' ').map((w) => w[0] + '.').join('');
const people = staff.map((s, i) => {
  const face = pools[s.gioiTinh].shift()!;
  const year = 1984 + Math.floor(rand() * 19), month = 1 + Math.floor(rand() * 12), day = 1 + Math.floor(rand() * 28);
  return { ...s, cccd: s.cccd ?? `9990001${String(i + 1).padStart(5, '0')}`, ngaySinh: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, face };
});
const withTeeth = people.filter((p) => p.face.teeth >= TEETH_MIN).length;
console.log(`\nCó ${faces.length} khuôn mặt thật (${faces.filter((f) => f.gender === 'female').length} nữ, ${faces.filter((f) => f.gender === 'male').length} nam); ${faces.filter((f) => f.teeth >= TEETH_MIN).length} khuôn mặt lộ răng khi cười.`);
console.log(`Gán NGẪU NHIÊN theo giới tính cho ${people.length} người ${COSAN ? `được chọn ngẫu nhiên trong ${staffAll.length} hồ sơ của đơn vị` : 'đầu danh sách'} (${need.nu} nữ, ${need.nam} nam); ${withTeeth}/${people.length} người nhận ảnh lộ răng. Đơn vị: ${UNIT}.\n`);
if (!COSAN) console.log('STT'.padEnd(5), 'Họ tên'.padEnd(26), 'CCCD giả'.padEnd(14), 'Ảnh'.padEnd(6), 'Lộ răng');
if (!COSAN) for (const [i, p] of people.entries()) console.log(String(i + 1).padEnd(5), (showNames ? p.hoTen : initials(p.hoTen)).padEnd(26), p.cccd.padEnd(14), p.face.id.padEnd(6), p.face.teeth >= TEETH_MIN ? `có (${(p.face.teeth * 100).toFixed(0)}%)` : 'không rõ');
if (planOnly) { console.log('\n(--ke-hoach: chưa ghi gì vào máy chủ)'); process.exit(0); }

// ---- nạp thật
const clampRect = (b: Box, w: number, h: number): Rect => { const x = Math.max(0, Math.round(b.x0)), y = Math.max(0, Math.round(b.y0)); return { x, y, w: Math.max(4, Math.min(w - x, Math.round(b.x1) - x)), h: Math.max(4, Math.min(h - y, Math.round(b.y1) - y)) }; };
const nl = pre ?? await loginDemo('nhaplieu01');
const td = COSAN ? nl : await loginDemo('tiepdon01');
const fresh: typeof people = [];
for (const p of COSAN ? [] : people) { const rows = await td.listRecords(p.cccd).catch(() => []); if (!rows.some((r) => r.type === 'hanhchinh')) fresh.push(p); }
if (fresh.length) {
  await td.saveMany(fresh.map((p) => ({ patientCode: p.cccd, type: 'hanhchinh' as const, khoa: 'KSK', group: UNIT,
    data: { ...blank.hanhchinh(), hoTen: p.hoTen, cccd: p.cccd, ngaySinh: p.ngaySinh, gioiTinh: p.gioiTinh, lop: '-', nguonChiTra: 'BHYT' } })));
}
console.log(`\n✓ hồ sơ hành chính: tạo mới ${fresh.length}, đã có sẵn ${people.length - fresh.length}`);
let saved = 0, skipped = 0; const t0 = performance.now();
for (const p of people) {
  if ((await listImages(nl, p.cccd)).length) { skipped++; continue; }
  const m = marks[p.face.id], { w, h } = p.face.px;
  const regions = [
    { rect: clampRect(m.mat, w, h), khoas: ['Mat'], label: 'vung-mat (mat+long may)' },
    { rect: clampRect(m.mui, w, h), khoas: ['TMH'], label: 'vung-mui' },
    { rect: clampRect(m.taiP, w, h), khoas: ['TMH'], label: 'vung-tai-trai-anh' },
    { rect: clampRect(m.taiT, w, h), khoas: ['TMH'], label: 'vung-tai-phai-anh' },
    { rect: clampRect(m.mieng, w, h), khoas: ['RHM'], label: 'vung-mieng-ham (rang)' },
  ];
  await saveImage(nl, { patientCode: p.cccd, original: { mime: 'image/png', bytes: p.face.bytes }, pixels: p.face.px, modality: 'KHAC', regions });
  saved++; if (saved % 10 === 0) console.log(`  … đã mã hoá ${saved} ảnh (${Math.round((performance.now() - t0) / 1000)} giây)`);
}
console.log(`✓ ảnh mặt: lưu mới ${saved}, bỏ qua ${skipped} (đã có ảnh) — ${Math.round((performance.now() - t0) / 1000)} giây`);
if (COSAN) {
  const f = join(DIR, `da-gan-${UNIT}.csv`);
  writeFileSync(f, 'ma_ho_so_cccd,ma_anh\n' + people.map((p) => `${p.cccd},${p.face.id}`).join('\n') + '\n');   // chỉ mã hồ sơ + mã ảnh, KHÔNG có họ tên
  console.log(`Danh sách người đã được gán ảnh (chỉ mã hồ sơ + mã ảnh, không có tên): ${f}`);
}
await cleanupDevices();
console.log(`\nXong. Mở http://localhost:5180 → chọn đơn vị "${UNITS.find((u) => u.ma === UNIT)!.ten}" → đăng nhập bsmat01 → Ảnh CT/MRI → gõ họ tên (một phần, không dấu) hoặc CCCD.\nbsmat01 chỉ thấy đôi mắt; bstmh01 chỉ thấy mũi + hai tai; bsrhm01 chỉ thấy miệng + hàm; nhaplieu01 thấy cả khuôn mặt.\nGhi nguồn ảnh: Face Research Lab London Set (DeBruine & Jones, 2017), CC BY 4.0.`);
