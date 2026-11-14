// CHỨNG MINH TÊN BỆNH NHÂN ĐƯỢC MÃ HOÁ trên máy chủ demo đang chạy (chỉ đọc):
//   npx tsx app/test-ui/ten-ma-hoa.ts "nguyen van an"      (họ tên một phần, không phân biệt hoa/thường/dấu) hoặc CCCD 12 số
// In ra: (1) máy chủ LƯU gì cho hồ sơ hành chính (bản mã hex, chính sách ABE) và kiểm tra bản lưu KHÔNG chứa tên/CCCD dạng rõ;
//        (2) mỗi tài khoản mẫu đăng nhập thật và thấy tên hay chỉ thấy ổ khoá.
import { cleanupDevices, loginDemo, loginGiamSat, resolvePatients } from './demo-util.js';
import type { MedClient, RecordRow } from '../../security/src/client/medclient.js';

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) throw new Error('Cú pháp: npx tsx app/test-ui/ten-ma-hoa.ts <họ tên | CCCD>');
const cccd = (await resolvePatients([arg]))[0];
if (!cccd) { await cleanupDevices(); throw new Error('Không tìm thấy bệnh nhân (tên được tra trong hồ sơ hành chính mà tài khoản Tiếp đón đọc được)'); }

const td = await loginDemo('tiepdon01');
const row = (await td.listRecords(cccd)).find((r) => r.type === 'hanhchinh') as (RecordRow & { envelope: { v?: number; headerId?: string; abe?: { policy: string; rows: unknown[] }; ciphertext?: string; wrappedDek?: string } }) | undefined;
if (!row) { await cleanupDevices(); throw new Error('Bệnh nhân này chưa có hồ sơ hành chính'); }
const plain = (await td.openMany([row]))[0]?.data as { hoTen?: string; cccd?: string } | undefined;
// Hồ sơ dùng "khoá chung" (v3): chính sách + khoá AES bị bọc nằm ở TIÊU ĐỀ khoá do máy chủ lưu; bản ghi chỉ có bản mã.
const hdr = row.envelope.v === 3 && row.envelope.headerId ? (await td.api<{ policy: string; wrappedDek: string; abe: { rows: unknown[] } }[]>('GET', `/api/headers?ids=${row.envelope.headerId}`))[0] : undefined;
const policyText = (hdr?.policy ?? row.envelope.abe?.policy ?? '').replace(/#\d{4}W\d{2}\.\d+/g, '');
const wrapped = hdr?.wrappedDek ?? row.envelope.wrappedDek ?? '';
// Chỉ kiểm tra phần MÃ HOÁ (bản mã + tiêu đề khoá), không kiểm các trường nhãn như loại bản ghi ("hanhchinh" chứa chữ "chi" — không phải tên).
const stored = JSON.stringify({ envelope: row.envelope, header: hdr ?? null });
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

console.log(`\n=== (1) MÁY CHỦ LƯU GÌ cho hồ sơ hành chính của "${plain?.hoTen}" ===`);
console.log('chính sách ABE :', policyText || '(không đọc được)');
console.log('bản mã AES-GCM :', `${(row.envelope.ciphertext?.length ?? 0) / 2} byte`, (row.envelope.ciphertext ?? '').slice(0, 64) + '…');
console.log('khoá AES bị bọc:', wrapped.slice(0, 48) + '…', hdr ? `(+ ${hdr.abe.rows.length} hàng ABE; chỉ người thoả chính sách mới mở được)` : '');
const nameParts = (plain?.hoTen ?? '').replace(/\(gia\)/i, '').trim().split(/\s+/).filter((x) => x.length > 2);
const leaks = [plain?.cccd ?? '', ...nameParts].filter((t) => t && fold(stored).includes(fold(t)));
console.log(leaks.length ? `✗ BẢN LƯU CÓ CHỨA DẠNG RÕ: ${leaks.join(', ')}` : `✓ bản lưu KHÔNG chứa họ tên hay CCCD dạng rõ (đã tìm: ${[plain?.cccd, ...nameParts].join(', ')})`);
console.log('(máy chủ chỉ có "chỉ mục mù" = HMAC của CCCD để tra cứu; không có khoá giải mã nào)');

console.log(`\n=== (2) AI THẤY ĐƯỢC TÊN (mỗi tài khoản đăng nhập thật, giải mã thật trên máy này) ===`);
console.log('tài khoản'.padEnd(14), 'vai trò'.padEnd(26), 'kết quả');
const accounts: [string, string][] = [['tiepdon01', 'Tiếp đón'], ['bsnhi01', 'Bác sĩ Nhi'], ['bsmat01', 'Bác sĩ Mắt'], ['bsthankinh01', 'Bác sĩ Thần kinh'], ['bsksk01', 'Bác sĩ Khám chung'],
  ['nhaplieu01', 'Nhập liệu 1'], ['nhaplieu02', 'Nhập liệu 2'], ['quantri02', 'Quản trị'], ['giamsat01', 'Giám sát']];
for (const [u, label] of accounts) {
  let out: string;
  try {
    const c: MedClient | null = u === 'giamsat01' ? await loginGiamSat('Chung minh ma hoa ten benh nhan (demo)') : await loginDemo(u);   // Giám sát phải qua MFA mới đọc được
    if (!c) { console.log(u.padEnd(14), label.padEnd(26), '(cần mã MFA: xem GIAMSAT_TOTP_SECRET)'); continue; }
    const mine = (await c.listRecords(cccd)).filter((r) => r.type === 'hanhchinh');
    const name = mine.length ? ((await c.openMany(mine))[0]?.data as { hoTen?: string } | undefined)?.hoTen : undefined;
    out = name ? `THẤY TÊN: ${name}` : mine.length ? '🔒 có bản mã nhưng không giải mã được' : '🔒 máy chủ không trả hồ sơ nào (không thuộc quyền)';
  } catch (e) {
    const m = (e as Error).message;
    out = /chỉ mục/.test(m) ? '🔒 không có khoá chỉ mục: không tra được hồ sơ' : /DEVICE_LIMIT/.test(m) ? '(hết số thiết bị — chạy demo-don-thiet-bi.ts)' : /BAD_CREDENTIALS|ROLE|USERNAME/.test(m) ? '(tài khoản chưa có trên máy chủ này — cần máy chủ bản mới)' : m.slice(0, 70);
  }
  console.log(u.padEnd(14), label.padEnd(26), out);
}
await cleanupDevices();
console.log('\nKết luận: MỌI họ tên bệnh nhân đều nằm trong hồ sơ hành chính đã mã hoá; ô tra theo tên chỉ hoạt động trên máy của người đã giải mã được hồ sơ đó.');
