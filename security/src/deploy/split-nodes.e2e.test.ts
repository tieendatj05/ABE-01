// NGHIỆM THU TÁCH NÚT CẤP KHOÁ: hai trong ba nút chạy ở TIẾN TRÌNH RIÊNG (như ở máy khác) với gói share riêng; máy chủ chính không còn đọc share của chúng.
//  A. Gói nút chỉ chứa share của ĐÚNG nút đó; công cụ từ chối gỡ share khi nút mới sai/không khớp, và chỉ gỡ (đổi tên, không xoá) khi đúng.
//  B. Đăng nhập + đọc dữ liệu vẫn chạy khi 2 nút ở xa; tắt 1 nút ở xa vẫn chạy (ngưỡng 2/3); tắt nút thứ hai thì KHÔNG ai lấy được khoá nữa.
// Cần jar: (cd security/storage && ./mvnw -DskipTests package). DỮ LIỆU GIẢ.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MedClient } from '../client/medclient.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { exportNodePackage, retireLocalShare } from './tach-nut.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from './research-stack.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const TSX = resolve('node_modules/tsx/dist/cli.mjs');
const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [A] = fakePatients(1, 99);
const UNIT = 'TRUONG-A';
let S: ResearchStack;
let dataDir = '';
const procs: Record<string, ChildProcess> = {};
const ports: Record<string, number> = {};
const pkg: Record<string, string> = {};
const kill = (org: string) => { const p = procs[org]; if (p?.pid) { p.removeAllListeners('exit'); try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch { /* đã tắt */ } } };
const login = (u: string) => MedClient.signIn(S.baseUrl, u, pw(u), new MemoryDeviceKeyStore(), { fetch: S.fetch });

function startRemote(org: string): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [TSX, 'security/src/deploy/node-server.ts'], {
      env: { ...process.env, NODE_ORG: org, NODE_DATA_DIR: pkg[org], NODE_PORT: String(ports[org]), STORAGE_URL: S.baseUrl, CA_FILE: join(pkg[org], 'ca.pem'), MEDABE_SERVICE_TOKEN: S.serviceToken,
        TLS_P12: join(pkg[org], 'nut-tls.p12'), TLS_PASSWORD: JSON.parse(readFileSync(join(S.tlsDir, 'tls.json'), 'utf8')).password, REGISTRY_PK: S.registryPk },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    procs[org] = p;
    let out = '';
    p.stdout!.on('data', (d: Buffer) => { out += d.toString(); if (/READY/.test(out)) ok(); });
    p.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('exit', (c) => fail(new Error(`node-server ${org} thoát (${c}):\n${out.slice(-800)}`)));
  });
}

beforeAll(async () => {
  if (!JAR) return;
  dataDir = mkdtempSync(join(tmpdir(), 'medabe-split-'));
  for (const g of ['SoYTe', 'DienThoai']) ports[g] = await freePort();
  S = await startResearchStack({
    dataDir, passwordIterations: 20000, legacyBridge: true,
    remoteNodes: { SoYTe: `https://localhost:${ports.SoYTe}`, DienThoai: `https://localhost:${ports.DienThoai}` },     // chỉ BenhVien chạy cùng máy chủ
  });
  writeFileSync(join(dataDir, 'secrets.json'), JSON.stringify({ serviceToken: S.serviceToken }));                  // research-server.ts ghi tệp này; thử nghiệm tự ghi
  const tlsPw = JSON.parse(readFileSync(join(S.tlsDir, 'tls.json'), 'utf8')).password as string;
  for (const g of ['SoYTe', 'DienThoai']) {
    pkg[g] = join(dataDir, '..', `goi-${g}-${Date.now()}`);
    exportNodePackage({ dataDir, org: g, outDir: pkg[g], storageUrl: S.baseUrl, port: ports[g], tlsP12: join(S.tlsDir, 'server.p12'), tlsPassword: tlsPw });
    await startRemote(g);
  }
}, 400_000);
afterAll(async () => { for (const g of Object.keys(procs)) kill(g); await S?.stop(); });

describe.skipIf(!JAR)('A. Gói nút và gỡ share khỏi máy chủ chính', () => {
  it('gói của một nút chỉ chứa share của nút đó (không lẫn share nút khác, có kèm lệnh chạy + hướng dẫn)', () => {
    expect(existsSync(join(pkg.SoYTe, 'nodes', 'SoYTe', 'share.json'))).toBe(true);
    for (const other of ['BenhVien', 'DienThoai']) expect(existsSync(join(pkg.SoYTe, 'nodes', other, 'share.json'))).toBe(false);
    expect(existsSync(join(pkg.SoYTe, 'chay-nut.cmd'))).toBe(true);
    expect(existsSync(join(pkg.SoYTe, 'HUONG-DAN.txt'))).toBe(true);
    const cmd = readFileSync(join(pkg.SoYTe, 'chay-nut.cmd'), 'utf8');
    expect(cmd).toContain('NODE_ORG=SoYTe');
    expect(cmd).toContain('node-server.ts');
  });

  it('gỡ share khỏi máy chủ: từ chối khi nút mới KHÔNG khớp; đổi tên (không xoá) khi khớp; máy chủ còn giữ tối đa 1 share', async () => {
    const sharePath = (g: string) => join(dataDir, 'nodes', g, 'share.json');
    await expect(retireLocalShare({ dataDir, org: 'DienThoai', newNodeUrl: `https://localhost:${ports.SoYTe}` })).rejects.toThrow(/KHÔNG khớp/);   // trỏ nhầm sang nút SoYTe
    expect(existsSync(sharePath('DienThoai'))).toBe(true);                                                                                      // vẫn còn: không gỡ khi sai
    const a = await retireLocalShare({ dataDir, org: 'SoYTe', newNodeUrl: `https://localhost:${ports.SoYTe}` });
    const b = await retireLocalShare({ dataDir, org: 'DienThoai', newNodeUrl: `https://localhost:${ports.DienThoai}` });
    expect(existsSync(sharePath('SoYTe'))).toBe(false); expect(existsSync(sharePath('DienThoai'))).toBe(false);
    expect(existsSync(a.renamed) && existsSync(b.renamed)).toBe(true);                                                                          // đổi tên chứ không xoá
    expect(b.localSharesLeft).toBe(1);                                                                                                          // chỉ còn share của BenhVien
  }, 120_000);
});

describe.skipIf(!JAR)('B. Hệ thống chạy khi hai nút ở xa; ngưỡng 2/3 thật sự có hiệu lực', () => {
  it('đăng nhập, ghi và đọc lại dữ liệu khi BenhVien (cùng máy chủ) + SoYTe + DienThoai (tiến trình riêng) cùng chạy', async () => {
    const td = await login('tiepdon01');
    await td.saveMany([{ patientCode: A.hanhchinh.cccd, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: A.hanhchinh.hoTen, cccd: A.hanhchinh.cccd, canary: A.hanhchinh.canary }, group: UNIT }]);
    const fresh = await login('tiepdon01');
    const got = (await fresh.openMany(await fresh.listGroup(UNIT))).map((o) => (o?.data as { canary?: string } | undefined)?.canary);
    expect(got).toContain(A.hanhchinh.canary);
  }, 300_000);

  it('tắt MỘT nút ở xa: vẫn đăng nhập và đọc được (cần 2 trong 3)', async () => {
    kill('DienThoai');
    await new Promise((r) => setTimeout(r, 1500));
    const fresh = await login('tiepdon01');
    const got = (await fresh.openMany(await fresh.listGroup(UNIT))).map((o) => (o?.data as { canary?: string } | undefined)?.canary);
    expect(got).toContain(A.hanhchinh.canary);
  }, 300_000);

  it('tắt nút thứ HAI: không ai lấy được khoá nữa (máy chủ một mình KHÔNG đủ để giải mã)', async () => {
    kill('SoYTe');
    await new Promise((r) => setTimeout(r, 1500));
    await expect(login('tiepdon01')).rejects.toThrow(/nút cấp khoá/);
  }, 300_000);
});

// tránh cảnh báo biến không dùng khi JAR vắng
void mkdirSync;
