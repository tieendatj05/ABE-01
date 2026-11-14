// Kiểm thử ĐỊA CHỈ CỐ ĐỊNH + CHỨNG CHỈ qua ĐÚNG lệnh khởi động máy chủ (research-server.ts), dữ liệu tạm, cổng ngẫu nhiên:
//  1. Có "diaChiCoDinh": chứng chỉ gắn đúng các địa chỉ đó (không gắn IP LAN tự dò); nút cấp khoá được công bố là localhost (mỗi máy khách đổi sang địa chỉ máy chủ nó đang dùng) và đăng nhập vẫn lấy được khoá.
//  2. Khởi động lại với cùng cấu hình: CA/chứng chỉ KHÔNG đổi (đổi mạng không làm máy khách phải tin lại CA, không hiện hộp thoại xác nhận chứng chỉ).
//  3. Không có tệp cấu hình: tự tạo tệp mẫu cau-hinh-may-chu.json.
//  4. "chungChiToChuc": dùng chứng chỉ do tổ chức cấp (kho PKCS12 + CA riêng) thay chứng chỉ tự sinh.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MedClient } from '../client/medclient.js';
import { tlsFetch } from '../common/tls.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { generateDevTls } from './devtls.js';
import { DEMO_USERS } from './research-stack.js';

const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
const TSX = resolve('node_modules/tsx/dist/cli.mjs');
const procs: ChildProcess[] = [];
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;

async function start(dataDir: string, extra: Record<string, string> = {}): Promise<{ api: string; ca: string; proc: ChildProcess }> {
  const ports = { api: await freePort(), ui: await freePort(), web: await freePort(), lookup: await freePort(), byt: await freePort(), nodes: [await freePort(), await freePort(), await freePort()] };
  return new Promise((resolveReady, reject) => {
    const proc = spawn(process.execPath, [TSX, 'security/src/deploy/research-server.ts'], {
      env: { ...process.env, RESEARCH_DATA_DIR: dataDir, RESEARCH_PORT: String(ports.api), RESEARCH_UI_PORT: String(ports.ui), RESEARCH_WEB_PORT: String(ports.web), RESEARCH_LOOKUP_PORT: String(ports.lookup), RESEARCH_BYT_PORT: String(ports.byt),
        RESEARCH_NODE_PORTS: ports.nodes.join(','), RESEARCH_NO_BROWSER: '1', RESEARCH_NO_CERT: '1', RESEARCH_DEMO_USERS: '1', ...extra },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    procs.push(proc);
    let out = '';
    const onData = (d: Buffer) => { out += d.toString(); const m = /READY (\{.*\})/.exec(out); if (m) resolveReady({ ...JSON.parse(m[1]), proc }); };
    proc.stdout!.on('data', onData); proc.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('exit', (c) => reject(new Error(`research-server thoát (${c}) trước khi sẵn sàng:\n${out.slice(-1500)}`)));
  });
}
const stop = (p: ChildProcess) => { if (!p.pid) return; p.removeAllListeners('exit'); try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch { /* đã tắt */ } };
afterAll(() => { for (const p of procs) stop(p); });

describe('địa chỉ cố định + chứng chỉ của máy chủ', () => {
  it('địa chỉ cố định: chứng chỉ gắn đúng địa chỉ đó, nút công bố là localhost, đăng nhập lấy được khoá; khởi động lại thì CA không đổi; tệp mẫu tự tạo khi chưa có', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'medabe-addr-'));
    writeFileSync(join(dataDir, 'cau-hinh-may-chu.json'), JSON.stringify({ diaChiCoDinh: ['10.9.8.7', 'medabe.test.local'] }));
    const s1 = await start(dataDir);
    const sans = (JSON.parse(readFileSync(join(dataDir, 'tls', 'tls.json'), 'utf8')) as { sans: string[] }).sans;
    expect(sans).toEqual(expect.arrayContaining(['ip:10.9.8.7', 'dns:medabe.test.local', 'dns:localhost', 'ip:127.0.0.1']));
    expect(sans.filter((x) => x.startsWith('ip:')).sort()).toEqual(['ip:10.9.8.7', 'ip:127.0.0.1']);                  // KHÔNG có IP LAN tự dò: đổi mạng không đổi chứng chỉ
    const f = tlsFetch(readFileSync(s1.ca, 'utf8'));
    const cfg = (await (await f(`${s1.api}/api/config`)).json()) as { nodes: { org: string; url: string }[] };
    expect(cfg.nodes.every((n) => n.url.startsWith('https://localhost:'))).toBe(true);                                   // không dính IP nào
    const c = await MedClient.signIn(s1.api, 'tiepdon01', pw('tiepdon01'), new MemoryDeviceKeyStore(), { fetch: f });        // cần lấy khoá từ các nút qua địa chỉ localhost
    expect(c.s.attrs.length).toBeGreaterThan(0);
    const ca1 = readFileSync(join(dataDir, 'tls', 'ca.pem'), 'utf8');
    stop(s1.proc);
    await new Promise((r) => setTimeout(r, 3000));
    const s2 = await start(dataDir);                                                                                      // khởi động lại, cùng cấu hình
    expect(readFileSync(join(dataDir, 'tls', 'ca.pem'), 'utf8')).toBe(ca1);                                                // CA y nguyên => máy khách không phải tin lại
    stop(s2.proc);

    const dir2 = mkdtempSync(join(tmpdir(), 'medabe-addr2-'));
    const s3 = await start(dir2);
    const mau = JSON.parse(readFileSync(join(dir2, 'cau-hinh-may-chu.json'), 'utf8')) as { diaChiCoDinh: string[]; nutTuXa: Record<string, string> };
    expect(mau.diaChiCoDinh).toEqual([]); expect(mau.nutTuXa).toEqual({});
    stop(s3.proc);
  }, 600_000);

  it('chứng chỉ do tổ chức cấp: máy chủ dùng kho PKCS12 + CA đó, không tự sinh chứng chỉ trong data-research/tls', async () => {
    const orgDir = mkdtempSync(join(tmpdir(), 'medabe-orgca-'));
    mkdirSync(orgDir, { recursive: true });
    const org = generateDevTls(orgDir, ['dns:localhost', 'ip:127.0.0.1']);                                                  // đóng vai chứng chỉ do tổ chức cấp
    const dataDir = mkdtempSync(join(tmpdir(), 'medabe-orgtls-'));
    writeFileSync(join(dataDir, 'cau-hinh-may-chu.json'), JSON.stringify({ chungChiToChuc: { p12: org.serverP12, ca: org.caFile } }));
    const s = await start(dataDir, { RESEARCH_TLS_PASSWORD: org.password });
    expect(readFileSync(s.ca, 'utf8')).toBe(org.caPem);                                                                   // CA trả về là CA của tổ chức
    expect(existsSync(join(dataDir, 'tls', 'ca.pem'))).toBe(false);                                                        // không sinh CA riêng
    const f = tlsFetch(org.caPem);
    expect((await f(`${s.api}/api/v2/status`)).ok).toBe(true);                                                             // HTTPS xác minh được bằng CA của tổ chức
    const c = await MedClient.signIn(s.api, 'tiepdon01', pw('tiepdon01'), new MemoryDeviceKeyStore(), { fetch: f });          // nút cấp khoá cũng dùng chứng chỉ này
    expect(c.s.attrs.length).toBeGreaterThan(0);
    stop(s.proc);
  }, 400_000);
});
