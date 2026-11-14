// NÂNG CẤP HỆ THỐNG CŨ: chạy máy chủ nhúng (demo.ts) ở chế độ TÀI KHOẢN trên một BẢN SAO dữ liệu thật và kiểm tra dữ liệu cũ đọc được bằng tài khoản mới.
//   OLD_DATA=<thư mục bản sao dữ liệu máy chủ> npx tsx app/test-ui/upgrade-old-data-check.ts
import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MedClient } from '../../security/src/client/medclient.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';

const data = resolve(process.env.OLD_DATA ?? '');
if (!existsSync(join(data, 'db', 'medabe.mv.db'))) throw new Error('Đặt OLD_DATA = thư mục BẢN SAO dữ liệu máy chủ (có db/medabe.mv.db)');
const PORT = 18090, NODES = '19001,19002,19003', UNIT = process.env.UNIT ?? 'THCS-TAN-TIEN';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
const srv = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'security/src/deploy/demo.ts'], {
  stdio: 'ignore', windowsHide: true,
  env: { ...env, DATA_DIR: data, PORT: String(PORT), MEDABE_ACCOUNTS: '1', MEDABE_NODE_PORTS: NODES, NO_WEB: '1', BYT_PORT: '18091', MEDABE_PUBLIC_PORT: '18092', PARENT_PORT: '18093', MEDABE_OPEN_ENROLLMENT: 'false' },
});
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };
const base = `http://127.0.0.1:${PORT}`;
try {
  for (let i = 0; i < 240; i++) { if ((await fetch(`${base}/api/v2/status`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 500)); }
  check('máy chủ khởi động trên dữ liệu cũ ở chế độ tài khoản', (await fetch(`${base}/api/v2/status`)).ok);
  check('đăng ký thiết bị cũ ("nhập tên") đã đóng', (await fetch(`${base}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' })).status === 410);
  check('có bản sao lưu CSDL trước khi bật tài khoản', existsSync(join(data, 'db-truoc-khi-bat-tai-khoan', 'medabe.mv.db')));
  const temp = /Mat khau TAM: (\S+)/.exec(readFileSync(join(data, 'mat-khau-quan-tri-lan-dau.txt'), 'utf8'))![1];
  const login = (u: string, p: string, newPassword?: string) => MedClient.signIn(base, u, p, new MemoryDeviceKeyStore(), { newPassword });
  const admin = await login('quantri01', temp, 'MatKhau-Admin-2026');
  const mk = async (email: string, role: string, khoa?: string) => {
    const r = await admin.api<{ temporaryPassword: string }>('POST', '/api/v2/admin/users', { username: email, role, khoa, displayName: email });
    return login(email, r.temporaryPassword, 'MatKhau-NhanVien-1');
  };
  const td = await mk('tiepdon@congty.vn', 'TIEP_DON');
  const bs = await mk('bacsi.nhi@congty.vn', 'BAC_SI', 'Nhi');
  const rows = await td.listGroup(UNIT);
  check(`Tiếp đón (tài khoản mới) liệt kê được hồ sơ CŨ của đơn vị ${UNIT}`, rows.length > 0, `${rows.length} dòng`);
  const sample = rows.slice(0, 50);
  const opened = await td.openMany(sample);
  const ok = opened.filter((o) => o && (o.data as { hoTen?: string }).hoTen);
  check('giải mã được dữ liệu cũ bằng khoá cấp theo tài khoản (không cần máy/thiết bị cũ)', ok.length === sample.length, `${ok.length}/${sample.length}`);
  check('chữ ký người lập của dữ liệu cũ vẫn xác minh được', opened.every((o) => o?.signatureValid), `ví dụ: ${(ok[0]?.data as { hoTen?: string })?.hoTen}`);
  const asDoctor = await bs.openMany((await bs.listGroup(UNIT)).slice(0, 20));
  check('Bác sĩ (tài khoản mới) cũng đọc được Hành chính cũ', asDoctor.filter(Boolean).length === 20);
  const id = await td.saveMany([{ patientCode: '999000000777', type: 'hanhchinh', khoa: 'KSK', data: { hoTen: 'NGUOI THU NANG CAP (gia)', cccd: '999000000777' }, group: UNIT }]);
  check('ghi hồ sơ mới vào cùng đơn vị bằng tài khoản', id.length === 1);
  const again = await td.listGroup(UNIT);
  check('hồ sơ mới nằm chung danh sách với hồ sơ cũ', again.length === rows.length + 1);
} catch (e) { console.error('LỖI:', e); failed++; }
finally {
  try { execSync(`taskkill /pid ${srv.pid} /T /F`, { stdio: 'ignore' }); } catch { /* đã tắt */ }
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nNÂNG CẤP TRÊN DỮ LIỆU CŨ: tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
