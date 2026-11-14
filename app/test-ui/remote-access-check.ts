// KIỂM TRA TRUY CẬP TỪ XA qua đường hầm Cloudflare THẬT (cần Internet + cloudflared): máy chủ thử (dữ liệu trống, tạm thời) ở chế độ tài khoản,
// bật công tắc, lấy địa chỉ https công khai, rồi đăng nhập / ghi / đọc / giải mã ABE QUA INTERNET và thử các đường dẫn nhạy cảm (phải bị chặn).
//   npx tsx app/test-ui/remote-access-check.ts
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MedClient } from '../../security/src/client/medclient.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';

const data = mkdtempSync(join(tmpdir(), 'ksk-remote-'));
const PORT = 28090, GW = 28099;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
const srv = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'security/src/deploy/demo.ts'], {
  stdio: 'ignore', windowsHide: true,
  env: { ...env, DATA_DIR: data, PORT: String(PORT), MEDABE_ACCOUNTS: '1', MEDABE_NODE_PORTS: '29001,29002,29003', MEDABE_REMOTE_PORT: String(GW), NO_WEB: '1', BYT_PORT: '28095', MEDABE_PUBLIC_PORT: '28096', PARENT_PORT: '28097', MEDABE_OPEN_ENROLLMENT: 'false' },
});
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };
const local = `http://127.0.0.1:${PORT}`;
const status = (url: string, path: string, init: RequestInit = {}) => fetch(url + path, { ...init, signal: AbortSignal.timeout(15000) }).then((r) => r.status, () => 0);
try {
  for (let i = 0; i < 240; i++) { if ((await fetch(`${local}/api/v2/status`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 500)); }
  const temp = /Mat khau TAM: (\S+)/.exec(readFileSync(join(data, 'mat-khau-quan-tri-lan-dau.txt'), 'utf8'))![1];
  const admin = await MedClient.signIn(local, 'quantri01', temp, new MemoryDeviceKeyStore(), { newPassword: 'MatKhau-Admin-2026' });
  const made = await admin.api<{ temporaryPassword: string }>('POST', '/api/v2/admin/users', { username: 'tiepdon@congty.vn', role: 'TIEP_DON' });
  check('mặc định truy cập từ xa TẮT', (await admin.api<{ enabled: boolean }>('GET', '/api/v2/admin/remote')).enabled === false);

  // cổng lọc (cục bộ): đường nhạy cảm bị chặn dù khách gửi kèm token giả
  const gw = `http://127.0.0.1:${GW}`;
  check('cổng lọc cho /api/v2/status', (await status(gw, '/api/v2/status')) === 200);
  for (const [m, p] of [['GET', '/api/admin/devices'], ['GET', '/api/siem/events'], ['POST', '/api/register'], ['GET', '/api/v2/internal/remote'], ['POST', '/api/v2/internal/tickets/redeem'], ['GET', '/api/v2/evidence/raw'], ['PUT', '/api/v2/admin/remote'], ['GET', '/api/public/parent-records'], ['GET', '/api/records/../admin/devices'], ['GET', '/n/BenhVien/admin/grants']])
    check(`cổng lọc chặn ${m} ${p}`, (await status(gw, p, { method: m, headers: { 'x-service-token': 'x', 'x-admin-token': 'x', 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })) === 404);

  await admin.api('PUT', '/api/v2/admin/remote', { enabled: true });
  let url = '';
  for (let i = 0; i < 40 && !url; i++) { await new Promise((r) => setTimeout(r, 2000)); url = (await admin.api<{ publicUrl: string | null }>('GET', '/api/v2/admin/remote')).publicUrl ?? ''; }
  check('bật công tắc → đường hầm mở và báo địa chỉ https công khai', /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url), url);
  if (!url) throw new Error('không có địa chỉ công khai');
  for (let i = 0; i < 30 && (await status(url, '/api/v2/status')) !== 200; i++) await new Promise((r) => setTimeout(r, 2000));   // đợi DNS lan truyền

  check('từ Internet: /api/v2/status dùng được', (await status(url, '/api/v2/status')) === 200);
  for (const [m, p] of [['GET', '/api/admin/devices'], ['GET', '/api/v2/internal/remote'], ['PUT', '/api/v2/admin/remote'], ['GET', '/api/siem/events']])
    check(`từ Internet: ${m} ${p} bị chặn`, (await status(url, p, { method: m, headers: { 'x-service-token': 'x', 'x-admin-token': 'x', 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })) === 404);
  const cfg = (await (await fetch(`${url}/api/config`)).json()) as { nodes: { org: string; url: string }[] };
  check('cấu hình trả địa chỉ nút qua cùng địa chỉ công khai', cfg.nodes.every((n) => n.url.startsWith(`${url}/n/`)));

  // nhân viên ở xa: đăng nhập, ghi, đọc, giải mã ABE hoàn toàn qua Internet
  const staff = await MedClient.signIn(url, 'tiepdon@congty.vn', made.temporaryPassword, new MemoryDeviceKeyStore(), { newPassword: 'MatKhau-NhanVien-1' });
  check('đăng nhập từ xa (HTTPS công khai) + khoá chỉ mục qua nút ở xa', staff.s.account?.remote === true && /^[0-9a-f]{64}$/.test(staff.s.indexKey));
  await staff.saveMany([{ patientCode: '999000000888', type: 'hanhchinh', khoa: 'KSK', data: { hoTen: 'NGUOI O XA (gia)', cccd: '999000000888' }, group: 'TRUONG-A' }]);
  const rows = await staff.listGroup('TRUONG-A');
  const opened = await staff.openMany(rows);
  check('ghi + liệt kê + giải mã ABE hoàn toàn qua Internet, chữ ký hợp lệ', rows.length === 1 && (opened[0]?.data as { hoTen?: string })?.hoTen === 'NGUOI O XA (gia)' && opened[0]?.signatureValid === true);
  await staff.checkConnection();
  check('kiểm tra kết nối từ xa không gỡ phiên (status + me qua Internet)', staff.business?.open === true);
  const a = await admin.api<{ records: { action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=200');
  const loginIp = /ip=([0-9a-fA-F:.]+)/.exec(a.records.filter((r) => r.action === 'v2.login').map((r) => r.detail).find((d) => !d.includes('ip=127.0.0.1')) ?? '')?.[1];
  check('nhật ký ghi IP khách THẬT (không phải 127.0.0.1) cho đăng nhập qua đường hầm', !!loginIp, loginIp ?? '');

  await admin.api('PUT', '/api/v2/admin/remote', { enabled: false });
  let closed = false;
  for (let i = 0; i < 15 && !closed; i++) { await new Promise((r) => setTimeout(r, 2000)); closed = !(await admin.api<{ publicUrl: string | null }>('GET', '/api/v2/admin/remote')).publicUrl; }
  check('tắt công tắc → đường hầm đóng, địa chỉ bị xoá', closed);
} catch (e) { console.error('LỖI:', e); failed++; }
finally {
  try { execSync(`taskkill /pid ${srv.pid} /T /F`, { stdio: 'ignore' }); } catch { /* đã tắt */ }
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nTRUY CẬP TỪ XA: tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
