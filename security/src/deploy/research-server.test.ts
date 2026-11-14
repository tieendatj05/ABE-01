// Kiểm thử "bấm là chạy": chạy ĐÚNG lệnh của biểu tượng (research-server.ts), dùng thật, TẮT HẲN, bật lại và xác nhận dữ liệu/tài khoản còn nguyên.
// Lần đầu có thể tự build jar/giao diện (1-2 phút). Không mở trình duyệt, không đụng kho chứng chỉ Windows (RESEARCH_NO_BROWSER/NO_CERT).
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tlsFetch } from '../common/tls.js';
import { PasswordChangeRequiredError, ResearchClient } from '../research/client.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { totpCode } from '../research/totp.js';

const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
const TSX = resolve('node_modules/tsx/dist/cli.mjs');
const dataDir = mkdtempSync(join(tmpdir(), 'medabe-server-'));
let proc: ChildProcess | undefined;
let ports: { api: number; ui: number; web: number; lookup: number; byt: number; nodes: number[] };

function start(): Promise<{ ui: string; web: string; api: string; ca: string }> {
  return new Promise((resolveReady, reject) => {
    proc = spawn(process.execPath, [TSX, 'security/src/deploy/research-server.ts'], {
      env: { ...process.env, RESEARCH_DATA_DIR: dataDir, RESEARCH_PORT: String(ports.api), RESEARCH_UI_PORT: String(ports.ui), RESEARCH_WEB_PORT: String(ports.web), RESEARCH_LOOKUP_PORT: String(ports.lookup), RESEARCH_BYT_PORT: String(ports.byt), RESEARCH_NODE_PORTS: ports.nodes.join(','), RESEARCH_NO_BROWSER: '1', RESEARCH_NO_CERT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    const onData = (d: Buffer) => { out += d.toString(); const m = /READY (\{.*\})/.exec(out); if (m) resolveReady(JSON.parse(m[1])); };
    proc.stdout!.on('data', onData); proc.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('exit', (c) => reject(new Error(`research-server thoát (${c}) trước khi sẵn sàng:\n${out.slice(-1500)}`)));
  });
}
function stopHard() {
  if (!proc?.pid) return;
  proc.removeAllListeners('exit');
  try { execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch { /* đã tắt */ }
  proc = undefined;
}
afterAll(() => stopHard());

describe('máy chủ nghiên cứu bấm-là-chạy: dữ liệu bền qua lần tắt/mở', () => {
  it('lần 1: khởi động, đổi mật khẩu tạm, tạo nhân viên, lưu hồ sơ; tắt hẳn; lần 2: mọi thứ còn nguyên', async () => {
    ports = { api: await freePort(), ui: await freePort(), web: await freePort(), lookup: await freePort(), byt: await freePort(), nodes: [await freePort(), await freePort(), await freePort()] };
    const first = await start();
    const mk = (ca: string, store: MemoryDeviceKeyStore, base: string) => new ResearchClient({ baseUrl: base, fetch: tlsFetch(readFileSync(ca, 'utf8')), store });

    // giao diện được phục vụ; chỉ cho LAN
    const html = await fetch(first.ui).then((r) => r.text());
    expect(html).toContain('<div id="root">');
    expect(await fetch(first.web).then((r) => r.text())).toContain('<div id="root">');         // app nhân viên được phục vụ

    // tài khoản quản trị đầu tiên: mật khẩu tạm lưu trong tệp, buộc đổi
    const temp = /Mat khau TAM: (\S+)/.exec(readFileSync(join(dataDir, 'mat-khau-quan-tri-lan-dau.txt'), 'utf8'))![1];
    const adminStore = new MemoryDeviceKeyStore();
    await expect(mk(first.ca, adminStore, first.api).signIn('quantri01', temp)).rejects.toBeInstanceOf(PasswordChangeRequiredError);
    const admin = mk(first.ca, adminStore, first.api);
    expect((await admin.signIn('quantri01', temp, { newPassword: 'MatKhau-Admin-2026' })).role).toBe('QUAN_TRI');
    // Quản trị BẮT BUỘC xác thực hai lớp: chưa nhập mã thì mọi việc quản trị bị chặn (428); đăng ký + nhập mã xong mới làm được
    await expect(admin.call('GET', '/api/v2/admin/users')).rejects.toMatchObject({ status: 428 });
    const { secret } = await admin.call<{ secret: string }>('POST', '/api/v2/auth/mfa/enroll', { password: 'MatKhau-Admin-2026' });
    await admin.call('POST', '/api/v2/auth/mfa/verify', { code: totpCode(secret, Math.floor(Date.now() / 1000), 0) });
    const made = await admin.call<{ username: string; temporaryPassword: string }>('POST', '/api/v2/admin/users', { phone: '0905 555 123', displayName: 'Bac si Nhi (ben)', role: 'BAC_SI', khoa: 'Nhi' });
    const docStore = new MemoryDeviceKeyStore();
    const doc = mk(first.ca, docStore, first.api);
    await doc.signIn(made.username, made.temporaryPassword, { newPassword: 'MatKhau-BS-2026' });
    await doc.saveSection('baseline', { patientCode: 'BN-GIA-BEN', section: 'lamsang.Nhi', data: { canary: 'CANARY-BEN-BASELINE' } });
    await doc.saveSection('abe', { patientCode: 'BN-GIA-BEN', section: 'lamsang.Nhi', data: { canary: 'CANARY-BEN-ABE' } });
    stopHard();                                                   // tắt hẳn (cả cây tiến trình: tsx, Spring, nút)
    await new Promise((r) => setTimeout(r, 1500));

    // lần 2: cùng thư mục dữ liệu
    const second = await start();
    expect(second.api).toBe(first.api);
    const doc2 = mk(second.ca, docStore, second.api);             // cùng máy của bác sĩ (khoá ký còn trong kho cục bộ)
    expect((await doc2.signIn(made.username, 'MatKhau-BS-2026')).khoa).toBe('Nhi');          // tài khoản + mật khẩu mới còn
    const views = await doc2.readPatient('baseline', 'BN-GIA-BEN');
    expect(views.find((v) => v.section === 'lamsang.Nhi')).toMatchObject({ status: 'OPEN', data: { canary: 'CANARY-BEN-BASELINE' } });    // KEK cố định: giải mã được sau khi khởi động lại
    const abe = await doc2.readPatient('abe', 'BN-GIA-BEN');
    expect(abe.find((v) => v.section === 'lamsang.Nhi')).toMatchObject({ status: 'OPEN', data: { canary: 'CANARY-BEN-ABE' } });          // share nút + tham số ABE cố định
    const admin2 = mk(second.ca, adminStore, second.api);
    await admin2.signIn('quantri01', 'MatKhau-Admin-2026');
    await expect(admin2.call('GET', '/api/v2/admin/users')).rejects.toMatchObject({ status: 428 });     // phiên mới sau khi khởi động lại: lại phải nhập mã (bí mật MFA còn sau khi tắt/mở)
    await admin2.call('POST', '/api/v2/auth/mfa/verify', { code: totpCode(secret, Math.floor(Date.now() / 1000), 1) });
    const users = await admin2.call<{ username: string; mustChangePassword: boolean }[]>('GET', '/api/v2/admin/users');
    expect(users.map((u) => u.username).sort()).toEqual(['0905555123', 'quantri01']);
    expect(users.every((u) => !u.mustChangePassword)).toBe(true);
    await expect(mk(second.ca, new MemoryDeviceKeyStore(), second.api).signIn('quantri01', temp)).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });   // mật khẩu tạm đã vô hiệu
    expect(existsSync(join(dataDir, 'tls', 'ca.p12'))).toBe(false);                            // khoá riêng của CA đã bị xoá sau khi cấp chứng chỉ
    stopHard();
  }, 600_000);
});
