// KIỂM TRA ảnh mặt đã nạp (anh-mat-that-demo.ts): mỗi tài khoản đọc lại ảnh của người đầu danh sách và đo phần điểm ảnh nhận được.
//   npx tsx app/test-ui/anh-mat-that-kiem-tra.ts [CCCD giả, mặc định 999000100001] [--luu=THƯ_MỤC để lưu PNG từng tài khoản thấy]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listImages, openImage } from '../../security/src/client/imaging.js';
import { encodePng } from '../../security/src/research/fake-image.js';
import { cleanupDevices, loginDemo } from './demo-util.js';

const cccd = process.argv.find((a) => /^\d{12}$/.test(a)) ?? '999000100001';
const out = process.argv.find((a) => a.startsWith('--luu='))?.slice(6);
if (out) mkdirSync(resolve(out), { recursive: true });
const rows: [string, string][] = [['nhaplieu01', 'thấy cả mặt'], ['bsmat01', 'chỉ mắt'], ['bstmh01', 'chỉ mũi + tai'], ['bsrhm01', 'chỉ miệng + hàm'], ['bsnhi01', 'không thấy gì'], ['bsksk01', 'không thấy gì'], ['tiepdon01', 'không thấy gì']];
let bad = 0;
console.log(`Bệnh nhân CCCD ${cccd}`);
for (const [user, expect] of rows) {
  const c = await loginDemo(user);
  const gs = await listImages(c, cccd);
  const v = gs.length ? await openImage(c, gs[0].rows) : null;
  let pct = 0;
  if (v && v.width > 0) { let n = 0; const d = v.pixels.data; for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++; pct = (100 * n) / (v.pixels.w * v.pixels.h); if (out) writeFileSync(join(resolve(out), `${user}.png`), v.original ? Buffer.from(v.original.bytes) : encodePng(v.pixels)); }
  // người nhập nhận ẢNH GỐC (v.original); v.pixels chỉ là các vùng
  const ok = expect === 'thấy cả mặt' ? !!v && !v.limited && !!v.original : expect === 'không thấy gì' ? !v || pct === 0 : pct > 1 && pct < 40;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${user.padEnd(11)} kỳ vọng ${expect.padEnd(16)} → ${v ? `${pct.toFixed(1)}% điểm ảnh, ${v.regions.length} vùng${v.limited ? ', bản giới hạn' : ', ảnh gốc'}` : 'không có ảnh'}`);
}
await cleanupDevices();
console.log(bad ? `\n${bad} tài khoản KHÔNG đúng kỳ vọng.` : '\nTất cả đúng kỳ vọng.');
process.exit(bad ? 1 : 0);
