// Kiểm thử KHÔI PHỤC CỤC BỘ QUẢN TRỊ qua ĐÚNG lệnh khởi động máy chủ (research-server.ts), dữ liệu tạm, cổng ngẫu nhiên:
// đặt RESEARCH_RECOVER_ADMIN=quantri01 → máy chủ sinh mật khẩu TẠM vào tệp mat-khau-khoi-phuc-quan-tri.txt → đăng nhập bằng mật khẩu đó bị buộc đổi → dùng lại được;
// không đặt biến thì KHÔNG có tệp nào và mật khẩu quản trị không bị đụng tới. Lần đầu có thể tự build (1-2 phút).
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tlsFetch } from '../common/tls.js';
import { PasswordChangeRequiredError, ResearchClient } from '../research/client.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';

const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
const TSX = resolve('node_modules/tsx/dist/cli.mjs');
const procs: ChildProcess[] = [];

async function start(dataDir: string, extra: Record<string, string>): Promise<{ api: string; ca: string }> {
  const ports = { api: await freePort(), ui: await freePort(), web: await freePort(), lookup: await freePort(), byt: await freePort(), nodes: [await freePort(), await freePort(), await freePort()] };
  return new Promise((resolveReady, reject) => {
    const proc = spawn(process.execPath, [TSX, 'security/src/deploy/research-server.ts'], {
      env: { ...process.env, RESEARCH_DATA_DIR: dataDir, RESEARCH_PORT: String(ports.api), RESEARCH_UI_PORT: String(ports.ui), RESEARCH_WEB_PORT: String(ports.web), RESEARCH_LOOKUP_PORT: String(ports.lookup), RESEARCH_BYT_PORT: String(ports.byt),
        RESEARCH_NODE_PORTS: ports.nodes.join(','), RESEARCH_NO_BROWSER: '1', RESEARCH_NO_CERT: '1', ...extra },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    procs.push(proc);
    let out = '';
    const onData = (d: Buffer) => { out += d.toString(); const m = /READY (\{.*\})/.exec(out); if (m) resolveReady(JSON.parse(m[1])); };
    proc.stdout!.on('data', onData); proc.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('exit', (c) => reject(new Error(`research-server thoát (${c}) trước khi sẵn sàng:\n${out.slice(-1500)}`)));
  });
}
afterAll(() => { for (const p of procs) { if (!p.pid) continue; p.removeAllListeners('exit'); try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch { /* đã tắt */ } } });

describe('khôi phục cục bộ tài khoản Quản trị bằng lệnh khởi động máy chủ', () => {
  it('đặt RESEARCH_RECOVER_ADMIN: có tệp mật khẩu tạm; mật khẩu tạm buộc đổi; mật khẩu cũ của quản trị chết', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'medabe-recover-'));
    const first = await start(dataDir, { RESEARCH_RECOVER_ADMIN: 'quantri01' });
    const mk = (store: MemoryDeviceKeyStore) => new ResearchClient({ baseUrl: first.api, fetch: tlsFetch(readFileSync(first.ca, 'utf8')), store });
    const file = join(dataDir, 'mat-khau-khoi-phuc-quan-tri.txt');
    expect(existsSync(file)).toBe(true);
    const tmp = /Mat khau TAM: (\S+)/.exec(readFileSync(file, 'utf8'))![1];
    const firstPw = /Mat khau TAM: (\S+)/.exec(readFileSync(join(dataDir, 'mat-khau-quan-tri-lan-dau.txt'), 'utf8'))![1];
    await expect(mk(new MemoryDeviceKeyStore()).signIn('quantri01', firstPw)).rejects.toThrow(/BAD_CREDENTIALS/);           // mật khẩu lần đầu đã chết
    await expect(mk(new MemoryDeviceKeyStore()).signIn('quantri01', tmp)).rejects.toBeInstanceOf(PasswordChangeRequiredError);
    expect((await mk(new MemoryDeviceKeyStore()).signIn('quantri01', tmp, { newPassword: 'QuanTri-Moi-Sau-Khoi-Phuc-9' })).role).toBe('QUAN_TRI');
  }, 400_000);

  it('KHÔNG đặt biến: không tạo tệp khôi phục và mật khẩu lần đầu của quản trị còn nguyên', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'medabe-norecover-'));
    const s = await start(dataDir, {});
    expect(existsSync(join(dataDir, 'mat-khau-khoi-phuc-quan-tri.txt'))).toBe(false);
    const firstPw = /Mat khau TAM: (\S+)/.exec(readFileSync(join(dataDir, 'mat-khau-quan-tri-lan-dau.txt'), 'utf8'))![1];
    const c = new ResearchClient({ baseUrl: s.api, fetch: tlsFetch(readFileSync(s.ca, 'utf8')), store: new MemoryDeviceKeyStore() });
    await expect(c.signIn('quantri01', firstPw)).rejects.toBeInstanceOf(PasswordChangeRequiredError);
  }, 400_000);
});
