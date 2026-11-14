// KIỂM TRA SẴN SÀNG TRƯỚC KHI DEMO (chỉ đọc): máy chủ có đúng bản chính sách, các tài khoản mẫu đăng nhập được không, đang trong giờ làm việc không,
// dữ liệu mẫu đã nạp chưa. In gợi ý việc cần làm nếu thiếu.     npx tsx app/test-ui/demo-kiem-tra-san-sang.ts
import { existsSync, readdirSync } from 'node:fs';
import { cleanupDevices, DEMO_URL, demoFetch, loginDemo } from './demo-util.js';
import { UNITS } from '../web/src/data/catalog.js';

let bad = 0;
const line = (good: boolean, msg: string, hint = '') => { console.log(`${good ? '✓' : '✗'} ${msg}${!good && hint ? '\n    → ' + hint : ''}`); if (!good) bad++; };

console.log(`Máy chủ: ${DEMO_URL}\n`);
let st: { policyVersion?: string; businessOpen?: boolean; nextOpenAt?: string | null } | null = null;
try { st = await (await demoFetch(`${DEMO_URL}/api/v2/status`)).json() as typeof st; } catch { /* below */ }
line(!!st, 'máy chủ trả lời', 'Chưa chạy? Bấm biểu tượng "KSK Demo (ban moi)" hoặc Khoi-Dong-Lai-Demo.cmd');
if (!st) process.exit(1);
const [maj, min] = (st.policyVersion ?? '0.0.0').split('.').map(Number);
line(maj > 2 || (maj === 2 && min >= 3), `bản chính sách ${st.policyVersion} (cần ≥ 2.3.0: khoa Thần kinh + vai trò Giám sát + MFA là thuộc tính ABE)`, 'Máy chủ đang chạy bản cũ: chạy Khoi-Dong-Lai-Demo.cmd');
line(!!st.businessOpen, `đang trong giờ làm việc${st.businessOpen ? '' : ' — ĐÃ ĐÓNG, mở lại lúc ' + st.nextOpenAt}`, 'Đăng nhập quantri02 → Quản trị tài khoản → Lịch giờ làm việc → mở cửa');

const accounts = ['tiepdon01', 'nhaplieu01', 'nhaplieu02', 'bsnhi01', 'bsmat01', 'bstmh01', 'bsrhm01', 'bsthankinh01', 'bsnhimat01', 'bsksk01', 'ketluan01', 'ktv01', 'quantri02', 'giamsat01'];
const ok: string[] = [], missing: string[] = [];
let td: Awaited<ReturnType<typeof loginDemo>> | null = null;
for (const u of accounts) {
  try { const c = await loginDemo(u); ok.push(u); if (u === 'tiepdon01') td = c; }
  catch (e) { const m = (e as Error).message; missing.push(`${u} (${/DEVICE_LIMIT/.test(m) ? 'hết số thiết bị' : /BAD_CRED|ROLE|USER/.test(m) ? 'chưa có tài khoản' : m.slice(0, 40)})`); }
}
line(!missing.length, `tài khoản mẫu đăng nhập được: ${ok.length}/${accounts.length}`, `Thiếu: ${missing.join(', ')}. DEVICE_LIMIT → npx tsx app/test-ui/demo-don-thiet-bi.ts ; chưa có tài khoản → khởi động lại bản mới`);

if (td) {
  const rows = await td.listGroup(UNITS[0].ma);
  const names = (await td.openMany(rows.slice(0, 400))).map((o) => (o?.data as { hoTen?: string } | undefined)?.hoTen ?? '').filter(Boolean);
  const gia = names.filter((n) => /\(gia\)/i.test(n));
  line(rows.length > 0, `đơn vị đang chọn có ${rows.length} hồ sơ hành chính (${gia.length} bệnh nhân GIẢ trong ${Math.min(rows.length, 400)} hồ sơ đầu)`, 'Chạy: npx tsx app/test-ui/demo-chung-minh-abe.ts hoặc anh-upenn-demo.ts để nạp bệnh nhân giả');
  if (gia.length) console.log('   ví dụ tên để tra:', [...new Set(gia)].slice(0, 6).join(' · '));
}
const data = process.env.UPENN_OUT ?? 'E:/TLCN/du-lieu-anh';
const nUpenn = existsSync(data) ? readdirSync(data).filter((d) => /^UPENN-GBM-/.test(d)).length : 0;
line(nUpenn > 0, `ảnh MRI thật UPENN-GBM trên đĩa: ${nUpenn} bệnh nhân (${data})`, 'Chạy: npx tsx app/test-ui/tai-upenn.ts');
await cleanupDevices();
console.log(bad ? `\n${bad} mục chưa sẵn sàng.` : '\nSẴN SÀNG DEMO.');
process.exit(bad ? 1 : 0);
