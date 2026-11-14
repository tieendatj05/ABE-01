// XEM ẢNH ĐƯỢC MÃ HOÁ ABE THẾ NÀO trên máy chủ demo (chỉ đọc).
//   npx tsx app/test-ui/anh-ma-hoa.ts 999000000101
// In ra: (1) máy chủ LƯU gì cho từng ảnh/vùng (chính sách CP-ABE, kích thước, bản mã hex), (2) mỗi tài khoản mẫu được máy chủ TRẢ những mục nào
// và GIẢI MÃ được mục nào (bảng "ai xem được gì"), (3) Quản trị nhận được gì.
import { cleanupDevices, loginDemo, resolvePatients } from './demo-util.js';
import { MedClient, type RecordRow } from '../../security/src/client/medclient.js';
import { openImage } from '../../security/src/client/imaging.js';

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) throw new Error('Cú pháp: npx tsx app/test-ui/anh-ma-hoa.ts <CCCD 12 số | họ tên>');
const cccd = (await resolvePatients([arg]))[0];
if (!cccd) { await cleanupDevices(); throw new Error('Không tìm thấy bệnh nhân'); }
const login = loginDemo;
const short = (s: string, n = 56) => (s.length > n ? s.slice(0, n) + '…' : s);

const author = await login('nhaplieu01');
const rows = (await author.listRecords(cccd)).filter((r) => r.type === 'anh' || r.type === 'vung');
console.log(`\n=== (1) MÁY CHỦ LƯU GÌ cho CCCD ${cccd} (nhìn bằng tài khoản người nhập) ===`);
console.log('Máy chủ KHÔNG có khoá giải mã nào. Mỗi dòng dưới đây là một "phong bì": dữ liệu AES-256-GCM + khoá AES được CP-ABE khoá theo chính sách.\n');
for (const r of rows as (RecordRow & { envelope: { abe: { policy: string; rows: unknown[] }; ciphertext: string; wrappedDek: string } })[]) {
  console.log(`• ${r.type === 'anh' ? 'ẢNH GỐC ' : 'VÙNG    '} id ${r.id.slice(0, 8)}…  khoa=${r.khoa}${r.type === 'anh' ? '' : ''}`);
  console.log(`    chính sách CP-ABE : ${r.envelope.abe.policy.replace(/#\d{4}W\d{2}\.\d+/g, '')}`);
  console.log(`    bản mã AES-GCM    : ${r.envelope.ciphertext.length / 2} byte  ${short(r.envelope.ciphertext)}`);
  console.log(`    khoá AES bị bọc   : ${short(r.envelope.wrappedDek, 40)}  (+ ${r.envelope.abe.rows.length} hàng ABE; chỉ người thoả chính sách mới mở được)`);
}

console.log('\n=== (2) AI XEM ĐƯỢC GÌ (mỗi tài khoản đăng nhập thật, giải mã thật trên máy này) ===');
const names = ['nhaplieu01', 'nhaplieu02', 'bsnhi01', 'bsmat01', 'bstmh01', 'bsrhm01', 'bsnhimat01', 'bsksk01', 'ketluan01', 'tiepdon01'];
console.log('tài khoản'.padEnd(13), 'máy chủ trả'.padEnd(13), 'giải mã được'.padEnd(14), 'ảnh gốc'.padEnd(9), 'các vùng đọc được');
for (const u of names) {
  const c = await login(u);
  const mine = (await c.listRecords(cccd)).filter((r) => r.type === 'anh' || r.type === 'vung');
  const groups = new Map<string, RecordRow[]>();
  for (const r of mine) (groups.get(r.refId!) ?? groups.set(r.refId!, []).get(r.refId!)!).push(r);
  let dec = 0, regs: string[] = [], orig = false;
  for (const g of groups.values()) { const v = await openImage(c, g); if (v) { dec += v.regions.length + (v.original ? 1 : 0); orig ||= !!v.original; regs = regs.concat(v.regions.map((x) => x.khoas.join('+'))); } }
  console.log(u.padEnd(13), String(mine.length).padEnd(13), String(dec).padEnd(14), (orig ? 'CÓ' : 'không').padEnd(9), regs.join(', ') || '—');
}
console.log('\n=== (3) QUẢN TRỊ ===');
console.log('Tài khoản Quản trị không có thuộc tính ABE nào và không có khoá chỉ mục: không tra được hồ sơ, gọi API theo id nhận 403, không giải mã được (xem test authorship.e2e).');
await cleanupDevices();
console.log('\nGhi nhớ: "máy chủ trả" < tổng số mục nghĩa là máy chủ đã LOẠI các mục không thuộc quyền (bác sĩ không nhận bản mã của ảnh gốc/vùng khoa khác).');
