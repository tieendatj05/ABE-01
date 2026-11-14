// NẠP ẢNH MRI NÃO THẬT (bộ UPENN-GBM, đã ẩn danh, CC BY 4.0) vào MÁY CHỦ DEMO đang chạy, qua đúng đường đi của sản phẩm:
//   DICOM -> trợ lý gợi ý (khoa Thần kinh) -> mã hoá ABE theo vùng -> bác sĩ Thần kinh đọc được vùng; khoa khác không nhận gì.
//   npx tsx app/test-ui/tai-upenn.ts                       (tải trước vào E:\TLCN\du-lieu-anh\)
//   npx tsx app/test-ui/anh-upenn-demo.ts --ke-hoach       (CHỈ IN kế hoạch: ai nhận bao nhiêu ảnh — không cần máy chủ, không ghi gì)
//   npx tsx app/test-ui/anh-upenn-demo.ts                  (nạp thật; chạy lại sẽ bỏ qua bệnh nhân đã có ảnh)
//   Tuỳ chọn: --chuoi=N (số chuỗi, mặc định 24)  --lat=M (số lát mỗi chuỗi, mặc định 16)  --tat-ca (nạp MỌI chuỗi + lát: RẤT NẶNG, vài GB và hàng giờ)  --demo-tai
// CÁC CHUỖI ẢNH được CHỌN NGẪU NHIÊN rồi GÁN NGẪU NHIÊN (hạt giống cố định => kế hoạch lặp lại được) cho 10 BỆNH NHÂN GIẢ có tên tiếng Việt và CCCD giả
// (sinh theo cấu trúc CCCD thật, xem bảng in ra). KHÔNG đụng vào CSDL bệnh nhân THẬT: ảnh MRI của người khác gắn vào hồ sơ thật sẽ làm sai hồ sơ.
// LƯU Ý TRUNG THỰC: vùng "tai" (--demo-tai) là khung khoanh tay MINH HOẠ phân quyền, KHÔNG phải xác định giải phẫu. Dữ liệu gốc đã xoá khuôn mặt nên không có mắt/mũi/răng.
// Ghi nguồn: Bakas S. et al., UPENN-GBM (v2), TCIA, DOI 10.7937/TCIA.709X-DN49, CC BY 4.0.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { adviseImage } from '../../security/src/client/advisor.js';
import { dicomToRgba, parseDicom, sortSlices } from '../../security/src/client/dicom.js';
import { listImages, saveImage } from '../../security/src/client/imaging.js';
import { fakePatients } from '../../security/src/research/fake-data.js';
import { encodePng } from '../../security/src/research/fake-image.js';
import { UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';
import { cleanupDevices, loginDemo } from './demo-util.js';

const ROOT = resolve(process.env.UPENN_OUT ?? 'E:/TLCN/du-lieu-anh');
const flag = (n: string) => process.argv.includes(n);
const num = (n: string, d: number) => { const a = process.argv.find((x) => x.startsWith(n + '=')); const v = a ? Number(a.split('=')[1]) : d; return Number.isInteger(v) && v > 0 ? v : d; };
const demoTai = flag('--demo-tai'), planOnly = flag('--ke-hoach'), everything = flag('--tat-ca');
const MAX_SERIES = everything ? Infinity : num('--chuoi', 24);
const PER_SERIES = everything ? Infinity : num('--lat', 16);
const SEED = 20261110, POOL = 10;
if (!existsSync(ROOT)) throw new Error(`Chưa có dữ liệu ở ${ROOT}. Chạy trước: npx tsx app/test-ui/tai-upenn.ts`);
const sources = readdirSync(ROOT).filter((d) => /^UPENN-GBM-\d{5}/.test(d)).sort();
if (!sources.length) throw new Error('Không có thư mục UPENN-GBM-* nào. Chạy trước: npx tsx app/test-ui/tai-upenn.ts');

// ---- nhóm bệnh nhân GIẢ: tên tiếng Việt + CCCD giả đầu 999 (không trùng CCCD thật)
const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry(SEED);

/**
 * Số CCCD GIẢ nhưng ĐÚNG CẤU TRÚC CCCD 12 số: [3 số mã tỉnh/thành][1 số giới tính + thế kỷ: 0/1 = nam/nữ sinh 1900-1999, 2/3 = nam/nữ sinh 2000-2099]
 * [2 số cuối năm sinh — khớp ngày sinh trong hồ sơ][6 số ngẫu nhiên]. Sinh theo hạt giống nên lặp lại được; không có ý nghĩa với người thật nào.
 * LƯU Ý: mọi số đúng cấu trúc đều CÓ THỂ trùng ngẫu nhiên với số của một người thật; nên tên vẫn gắn "(gia)", chỉ nằm trong CSDL demo và không xuất ra ngoài.
 */
const PROVINCES = ['001', '079', '048', '075', '092', '031', '056', '062', '087', '038', '040', '077', '033', '052', '064', '068'];
const rndCccd = mulberry(SEED + 7);
function realisticCccd(ngaySinh: string, gioiTinh: 'nam' | 'nu', used: Set<string>): string {
  const year = Number(ngaySinh.slice(0, 4)) || 2012;
  const sex = (year >= 2000 ? 2 : 0) + (gioiTinh === 'nu' ? 1 : 0);
  for (;;) {
    const tail = String(Math.floor(rndCccd() * 1_000_000)).padStart(6, '0');
    const c = `${PROVINCES[Math.floor(rndCccd() * PROVINCES.length)]}${sex}${String(year % 100).padStart(2, '0')}${tail}`;
    if (!used.has(c) && !/(\d)\1{4}/.test(tail)) { used.add(c); return c; }                // không trùng nhau, không có dãy lặp kiểu 55555
  }
}
const usedCccd = new Set<string>();
const people = fakePatients(POOL, SEED).map((p) => {
  const gioiTinh: 'nam' | 'nu' = String(p.hanhchinh.gioiTinh).toLowerCase() === 'nu' ? 'nu' : 'nam';
  const ngaySinh = p.hanhchinh.ngaySinh as string;
  return { name: p.hanhchinh.hoTen as string, cccd: realisticCccd(ngaySinh, gioiTinh, usedCccd), ngaySinh, gioiTinh };
});

// ---- chọn ngẫu nhiên các chuỗi (chỉ liệt kê thư mục, chưa đọc DICOM)
const allSeries = sources.flatMap((src) => readdirSync(join(ROOT, src)).sort().map((tag) => ({ src, tag })));
for (let i = allSeries.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [allSeries[i], allSeries[j]] = [allSeries[j], allSeries[i]]; }
const chosen = allSeries.slice(0, MAX_SERIES === Infinity ? allSeries.length : MAX_SERIES);

interface Plan { src: string; tag: string; raw: number; kept: number; person: (typeof people)[number]; items: { px: ReturnType<typeof dicomToRgba>; adv: ReturnType<typeof adviseImage> }[] }
const plans: Plan[] = [];
for (const { src, tag } of chosen) {
  const dir = join(ROOT, src, tag);
  const slices = sortSlices(readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.dcm')).map((f) => parseDicom(new Uint8Array(readFileSync(join(dir, f))))));
  const content = slices.map((s) => { const px = dicomToRgba(s); return { px, adv: adviseImage(px, s.meta) }; }).filter((x) => x.adv.decision !== 'BO_QUA_LAT');
  if (!content.length) continue;                                                         // chuỗi toàn lát rỗng: bỏ
  const items = content.length > PER_SERIES ? Array.from({ length: PER_SERIES }, (_, k) => content[Math.round((k * (content.length - 1)) / (PER_SERIES - 1 || 1))]) : content;
  plans.push({ src, tag, raw: slices.length, kept: items.length, person: people[Math.floor(rand() * POOL)], items });
}

// ---- in kế hoạch (luôn in)
const total = plans.reduce((n, p) => n + p.kept, 0);
console.log(`\nThư mục có ${allSeries.length} chuỗi ảnh từ ${sources.length} bệnh nhân UPENN-GBM. Chọn NGẪU NHIÊN ${plans.length} chuỗi, mỗi chuỗi tối đa ${PER_SERIES === Infinity ? 'tất cả' : PER_SERIES} lát có nội dung => ${total} ảnh.`);
console.log(`Gán NGẪU NHIÊN cho ${POOL} bệnh nhân GIẢ:\n`);
console.log('Họ tên (giả)'.padEnd(26), 'CCCD giả'.padEnd(14), 'Số ảnh'.padEnd(8), 'Chuỗi được gán');
for (const p of people) {
  const mine = plans.filter((x) => x.person === p);
  const n = mine.reduce((a, x) => a + x.kept, 0);
  const lab = mine.map((x) => `${x.src.slice(-5)}/${x.tag === 'flair' ? 'FLAIR' : 'T1'}`);
  console.log(p.name.padEnd(26), p.cccd.padEnd(14), String(n).padEnd(8), mine.length ? `${mine.length} chuỗi: ${lab.slice(0, 5).join(', ')}${lab.length > 5 ? ', …' : ''}` : '(không có ảnh — vẫn có hồ sơ để tra tên)');
}
if (planOnly) { console.log('\n(--ke-hoach: chưa ghi gì vào máy chủ)'); process.exit(0); }
if (everything && !process.argv.includes('--yes')) { console.log(`\n--tat-ca sẽ nạp ${total} ảnh (ước ~${Math.round(total * 0.25 / 60)} phút và vài GB dữ liệu). Thêm --yes để chạy thật.`); process.exit(1); }

// ---- nạp thật
const nl = await loginDemo('nhaplieu01');
const td = await loginDemo('tiepdon01');
await td.saveMany(people.map((p) => ({ patientCode: p.cccd, type: 'hanhchinh' as const, khoa: 'KSK', group: UNITS[0].ma,
  data: { ...blank.hanhchinh(), hoTen: p.name, cccd: p.cccd, ngaySinh: p.ngaySinh, gioiTinh: p.gioiTinh as 'nam' | 'nu', lop: '-', nguonChiTra: 'BHYT' } })));
console.log(`\n✓ đã tạo ${people.length} hồ sơ hành chính GIẢ (tên mã hoá ABE; tra theo tên được vì giải mã trên máy bạn)`);

const have = new Set<string>();                                // bệnh nhân đã có ảnh từ lần chạy trước => bỏ qua (chạy lại an toàn)
for (const p of people) if ((await listImages(nl, p.cccd)).length) have.add(p.cccd);
for (const pl of plans) {
  const code = pl.person.cccd;
  if (have.has(code)) { console.log(`= ${pl.person.name}: đã có ảnh từ lần trước, bỏ qua ${pl.src}/${pl.tag}`); continue; }
  const seriesId = crypto.randomUUID(); const t0 = performance.now();
  for (const [k, it] of pl.items.entries()) {
    const regions = it.adv.regions.map((r) => ({ rect: r.rect, khoas: r.khoas, label: r.label }));
    if (demoTai && pl.tag.startsWith('t1') && k >= pl.items.length * 0.15 && k < pl.items.length * 0.4) {      // các lát thấp: hai khung bên (tai) cho TMH — minh hoạ
      const { w, h } = it.px;
      regions.push({ rect: { x: Math.round(w * 0.02), y: Math.round(h * 0.3), w: Math.round(w * 0.22), h: Math.round(h * 0.22) }, khoas: ['TMH'], label: 'vung-tai-trai (minh hoa, khoanh tay)' });
      regions.push({ rect: { x: Math.round(w * 0.76), y: Math.round(h * 0.3), w: Math.round(w * 0.22), h: Math.round(h * 0.22) }, khoas: ['TMH'], label: 'vung-tai-phai (minh hoa, khoanh tay)' });
    }
    await saveImage(nl, { patientCode: code, original: { mime: 'image/png', bytes: encodePng(it.px) }, pixels: it.px, modality: 'MRI', regions, series: { id: seriesId, index: k, count: pl.items.length } });
  }
  console.log(`✓ ${pl.person.name} (CCCD giả ${code}) ← ${pl.src}/${pl.tag}: ${pl.kept} ảnh — ${Math.round((performance.now() - t0) / 1000)} giây`);
}
await cleanupDevices();
console.log('\nXong. Mở http://localhost:5180 → đăng nhập bsthankinh01 (Passw0rd-BTK1) → Ảnh CT/MRI → gõ họ tên (một phần, không dấu) hoặc CCCD ở bảng trên.\nSo sánh với bsmat01 (không thấy gì) và bstmh01 (chỉ thấy vùng tai nếu nạp bằng --demo-tai).');
