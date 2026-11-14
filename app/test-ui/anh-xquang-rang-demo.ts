// THÊM MỖI NGƯỜI MỘT ẢNH X-QUANG BỘ RĂNG (toàn hàm) để bác sĩ Răng-Hàm-Mặt xem được bên trong hàm răng của người đó có bao nhiêu răng.
//   Mỗi ảnh = ảnh gốc (CHỈ người nhập/tác giả + Giám sát qua MFA đọc được) + MỘT vùng phủ toàn ảnh gán cho khoa RHM → bác sĩ RHM thấy cả phim, các khoa khác không thấy gì.
//   Người nhận: những ai ĐÃ có ảnh mặt (LONGWELL: danh sách da-gan-CNM-LONGWELL.csv; CTY-C: 50 hồ sơ mẫu 9990001xxxxx).
//
// NGUỒN ẢNH: "Panoramic radiography database" (598 phim toàn hàm, Owandy I-max Touch, Khoa Nha, ĐH Quốc gia Asunción, Paraguay), CC BY 4.0, DOI 10.5281/zenodo.4457648.
//   Trích dẫn: Román, J.C.M. et al. (2021), Sensors 21, 3110, https://doi.org/10.3390/s21093110
// LƯU Ý: ảnh X-quang là của NGƯỜI KHÁC (đã công bố công khai), gán NGẪU NHIÊN cho hồ sơ demo — KHÔNG phải răng của chính người trong hồ sơ. Chỉ dùng để trình diễn quyền ABE theo vùng.
//
//   npx tsx app/test-ui/anh-xquang-rang-demo.ts --ke-hoach       (chỉ in kế hoạch)
//   npx tsx app/test-ui/anh-xquang-rang-demo.ts                  (nạp thật; chạy lại sẽ bỏ qua người đã có ảnh X-quang răng)
//   Tuỳ chọn: --png=THƯ_MỤC_PNG (mặc định E:/TLCN/du-lieu-anh/_XQUANG_RANG/png)  --longwell=TỆP.csv  --don-vi-cty-c=CTY-C
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listImages, saveImage } from '../../security/src/client/imaging.js';
import { cleanupDevices, loginDemo } from './demo-util.js';
import { readPng } from './png-util.js';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(n + '='))?.slice(n.length + 1) ?? d;
const planOnly = process.argv.includes('--ke-hoach');
const BASE = resolve('E:/TLCN/du-lieu-anh/_XQUANG_RANG');
const PNG_DIR = resolve(arg('--png', join(BASE, 'png')));
const LONGWELL = resolve(arg('--longwell', 'E:/TLCN/du-lieu-anh/_ANH_MAT_THAT/da-gan-CNM-LONGWELL.csv'));
for (const f of [PNG_DIR, LONGWELL]) if (!existsSync(f)) throw new Error('Thiếu ' + f);

const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry(20261113);
const shuffle = <T,>(a: T[]) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

const files = readdirSync(PNG_DIR).filter((f) => /\.png$/i.test(f)).sort();
const longwell = readFileSync(LONGWELL, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(',')[0]).filter((x) => /^\d{12}$/.test(x));
const ctyC = Array.from({ length: 50 }, (_, i) => `9990001${String(i + 1).padStart(5, '0')}`);
const targets = [...longwell.map((cccd) => ({ cccd, unit: 'CNM-LONGWELL' })), ...ctyC.map((cccd) => ({ cccd, unit: 'CTY-C' }))];
if (files.length < targets.length) console.log(`(!) Chỉ có ${files.length} phim cho ${targets.length} người: người cuối sẽ không có phim.`);
const pool = shuffle(files);
const plan = targets.map((t, i) => ({ ...t, file: pool[i] })).filter((p) => p.file);
console.log(`\nCó ${files.length} phim X-quang toàn hàm. Kế hoạch: gán NGẪU NHIÊN, mỗi phim một người, cho ${plan.length} người (${longwell.length} LONGWELL + ${ctyC.length} CTY-C có ảnh mặt).`);
if (planOnly) { console.log('(--ke-hoach: chưa ghi gì)'); process.exit(0); }

const nl = await loginDemo('nhaplieu01');
let saved = 0, skipped = 0, noFace = 0; const done: string[] = []; const t0 = performance.now();
const csv = join(BASE, 'da-gan-xquang.csv');
try {
  for (const p of plan) {
    const imgs = await listImages(nl, p.cccd);
    if (!imgs.length) { noFace++; continue; }                // chỉ gán cho người đã có ảnh (mặt) — nghĩa là tác giả là nhaplieu01
    if (imgs.length >= 2) { skipped++; continue; }           // đã có thêm ảnh thứ hai (X-quang răng)
    const bytes = new Uint8Array(readFileSync(join(PNG_DIR, p.file)));
    const px = readPng(bytes);
    await saveImage(nl, {
      patientCode: p.cccd, original: { mime: 'image/png', bytes }, pixels: px, modality: 'KHAC',
      regions: [{ rect: { x: 0, y: 0, w: px.w, h: px.h }, khoas: ['RHM'], label: 'xquang-bo-rang-toan-ham' }],
    });
    saved++; done.push(`${p.cccd},${p.file}`);
    if (saved % 10 === 0) console.log(`  … đã mã hoá ${saved} phim (${Math.round((performance.now() - t0) / 1000)} giây)`);
  }
} finally {
  // ghi nối (chạy lại không mất danh sách cũ); chỉ có mã hồ sơ + tên tệp phim, không có họ tên
  const old = existsSync(csv) ? readFileSync(csv, 'utf8').trim().split(/\r?\n/).slice(1) : [];
  writeFileSync(csv, 'ma_ho_so_cccd,ma_phim\n' + [...old, ...done].join('\n') + '\n');
  await cleanupDevices();                                  // luôn thu hồi thiết bị tạm, kể cả khi lỗi giữa chừng
}
console.log(`\n✓ X-quang răng: lưu mới ${saved}, bỏ qua ${skipped} (đã có), ${noFace} người chưa có ảnh mặt nên không gán — ${Math.round((performance.now() - t0) / 1000)} giây`);
console.log('Ghi nguồn: Román et al. (2021), Panoramic radiography database, Zenodo 10.5281/zenodo.4457648, CC BY 4.0.');
