// Dựng nguyên hệ thống LUỒNG NGHIÊN CỨU để kiểm thử/đo/demo: Spring (HTTPS) + 3 nút cấp khoá (HTTPS, cấp theo vé) + dữ liệu giả.
//   npm run research:stack   (chạy tay, in địa chỉ + tài khoản mẫu)   |   import { startResearchStack } trong kiểm thử.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tlsFetch } from '../common/tls.js';
import { abePkDigest } from '../research/client.js';
import { generateDevTls, type DevTls } from './devtls.js';
import { initDealer, ORGS } from './init.js';
import { startNodes } from './nodes.js';

export const DEMO_USERS = [
  { username: 'tiepdon01', password: 'Passw0rd-TD01', role: 'TIEP_DON', khoa: '', name: 'Tiep don 01' },
  { username: 'bsnhi01', password: 'Passw0rd-BN01', role: 'BAC_SI', khoa: 'Nhi', name: 'Bac si Nhi 01' },
  { username: 'bsmat01', password: 'Passw0rd-BM01', role: 'BAC_SI', khoa: 'Mat', name: 'Bac si Mat 01' },
  { username: 'quantri01', password: 'Passw0rd-QT01', role: 'QUAN_TRI', khoa: '', name: 'Quan tri 01' },
  // Mo hinh tac gia + nhieu khoa (DU LIEU GIA). Nhieu khoa viet bang dau + trong chuoi seed.
  { username: 'quantri02', password: 'Passw0rd-QT02', role: 'QUAN_TRI', khoa: '', name: 'Quan tri demo 02' },
  { username: 'nhaplieu01', password: 'Passw0rd-NL01', role: 'NHAP_LIEU', khoa: '', name: 'Nhap lieu 01' },
  { username: 'nhaplieu02', password: 'Passw0rd-NL02', role: 'NHAP_LIEU', khoa: '', name: 'Nhap lieu 02' },
  { username: 'bstmh01', password: 'Passw0rd-BT01', role: 'BAC_SI', khoa: 'TMH', name: 'Bac si TMH 01' },
  { username: 'bsrhm01', password: 'Passw0rd-BR01', role: 'BAC_SI', khoa: 'RHM', name: 'Bac si RHM 01' },
  { username: 'bsthankinh01', password: 'Passw0rd-BTK1', role: 'BAC_SI', khoa: 'ThanKinh', name: 'Bac si Than kinh 01' },
  // Vai tro GIAM SAT (doc tat ca, khong ghi, khong quan tri). Mat khau >= 14 ky tu. Nap luc khoi dong nen dung duoc ngay; tai khoan tao SAU can quan tri khac duyet.
  { username: 'giamsat01', password: 'Passw0rd-GiamSat01', role: 'GIAM_SAT', khoa: '', name: 'Giam sat 01' },
  { username: 'bsnhimat01', password: 'Passw0rd-BNM1', role: 'BAC_SI', khoa: 'Nhi+Mat', name: 'Bac si Nhi+Mat 01' },
  { username: 'bsksk01', password: 'Passw0rd-BK01', role: 'BAC_SI', khoa: 'KSK+XetNghiem', name: 'Bac si Kham chung 01' },
  { username: 'ktv01', password: 'Passw0rd-KT01', role: 'KTV', khoa: '', name: 'KTV xet nghiem 01' },
  { username: 'ketluan01', password: 'Passw0rd-KL01', role: 'KET_LUAN', khoa: 'KSK', name: 'Bac si ket luan 01' },
] as const;

export interface StackOptions {
  dataDir?: string;
  /** Số vòng PBKDF2 của mật khẩu (mặc định 600.000 như triển khai thật; kiểm thử có thể hạ để nhanh). */
  passwordIterations?: number;
  env?: Record<string, string>;
  /** "TEN:CIDR,..." cho nhiều VLAN */
  zones?: string;
  evidence?: boolean;
  /** Bật hiệu lực của cổng cấm ngoài giờ bằng cách để lịch mặc định; kiểm thử đổi lịch qua API. */
  host?: string;
  /** Cổng cố định (chạy tay); mặc định cổng trống ngẫu nhiên. */
  ports?: { spring?: number; nodes?: Record<string, number> };
  /** Tên máy dùng trong địa chỉ các nút (mặc định = host). Đặt khác host để chứng minh nút có thể nằm ở địa chỉ khác backend. */
  nodeHost?: string;
  /** SAN bổ sung cho chứng chỉ (vd ip của card LAN để kiểm thử truy cập từ vùng mạng khác). */
  sans?: string[];
  /** Lịch khởi tạo (chỉ khi CSDL chưa có lịch). Mặc định MỞ CẢ NGÀY để kiểm thử không phụ thuộc giờ thật; null = dùng lịch mặc định T2-T7 07-21h, CN 07-17h30. */
  initialSchedule?: Record<string, { open: string; close: string }> | null;
  /** Không chạy 3 nút (chỉ Spring) — dùng cho kiểm thử mạng. */
  noNodes?: boolean;
  /** Chạy bền (máy chủ thật): CSDL file thay vì bộ nhớ, và bí mật cố định giữa các lần khởi động (KEK, token dịch vụ). */
  persist?: { dbUrl: string; serviceToken: string; kek: string; adminToken: string; siemToken: string };
  /** false = không tạo 4 tài khoản mẫu (mặc định: tạo, chỉ khi chưa tồn tại). */
  seedDemoUsers?: boolean;
  /** Bật cầu nối cho APP NHÂN VIÊN CŨ: /api/records, /api/headers dùng phiên tài khoản + kiểm quyền (xem LegacyBridge.java). */
  legacyBridge?: boolean;
  /** Chuỗi seed thô `tên|mật khẩu|VAI_TRÒ|KHOA|Tên|TAM` (ưu tiên hơn seedDemoUsers). */
  seedUsers?: string;
  /** Nút cấp khoá chạy ở MÁY KHÁC (tiến trình riêng, xem node-server.ts): tên nút -> địa chỉ https công bố. Nút này KHÔNG chạy cục bộ và không đọc share của nó. */
  remoteNodes?: Record<string, string>;
  /** Chứng chỉ do TỔ CHỨC cấp (thay chứng chỉ tự sinh): kho PKCS#12 + CA, mật khẩu kho. */
  tls?: DevTls;
}

const ALL_DAY = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, { open: '00:00', close: '23:59' }]));

const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });

export interface ResearchStack {
  baseUrl: string; nodeUrls: Record<string, string>; caPem: string; caFile: string; fetch: typeof fetch; registryPk: string; abePkSha256: string;
  serviceToken: string; kek: string; dataDir: string; tlsDir: string; springLog: string;
  stop(): Promise<void>;
}

export async function startResearchStack(o: StackOptions = {}): Promise<ResearchStack> {
  const jarDir = resolve('security/storage/target');
  const jar = existsSync(jarDir) ? readdirSync(jarDir).find((f) => /^medabe-storage-.*\.jar$/.test(f)) : undefined;
  if (!jar) throw new Error('Chưa có jar Spring: cd security/storage && ./mvnw -DskipTests package');
  const dataDir = resolve(o.dataDir ?? join(tmpdir(), `medabe-research-${randomBytes(4).toString('hex')}`));
  mkdirSync(dataDir, { recursive: true });
  initDealer(dataDir);
  const host = o.host ?? '127.0.0.1';
  const tls = o.tls ?? generateDevTls(join(dataDir, 'tls'), [...new Set([`ip:${host}`, 'dns:localhost', 'ip:127.0.0.1', ...(o.sans ?? [])])]);
  const springPort = o.ports?.spring ?? (await freePort());
  const ports = Object.fromEntries(await Promise.all(ORGS.map(async (g) => [g, o.ports?.nodes?.[g] ?? (await freePort())]))) as Record<string, number>;
  const baseUrl = `https://${host}:${springPort}`;
  const nodeUrls = Object.fromEntries(ORGS.map((g) => [g, o.remoteNodes?.[g] ?? `https://${o.nodeHost ?? host}:${ports[g]}`]));
  const serviceToken = o.persist?.serviceToken ?? randomBytes(16).toString('hex');
  const kek = o.persist?.kek ?? randomBytes(32).toString('hex');
  const f = tlsFetch(tls.caPem);
  const springLog = join(dataDir, 'spring.log');
  writeFileSync(springLog, '');

  const spring: ChildProcess = spawn(process.env.JAVA_BIN ?? 'java', ['-XX:TieredStopAtLevel=1', '-XX:+UseSerialGC', '-jar', join(jarDir, jar)], {
    windowsHide: true,
    env: {
      ...process.env, PORT: String(springPort),
      DB_URL: o.persist?.dbUrl ?? `jdbc:h2:mem:research${randomBytes(4).toString("hex")};DB_CLOSE_DELAY=-1`,
      SERVER_SSL_ENABLED: 'true', SERVER_SSL_KEY_STORE: tls.serverP12, SERVER_SSL_KEY_STORE_PASSWORD: tls.password, SERVER_SSL_KEY_STORE_TYPE: 'PKCS12',
      MEDABE_PK_JSON: readFileSync(join(dataDir, 'dealer', 'pk.json'), 'utf8'),
      MEDABE_NODES: ORGS.map((g) => `${g}=${nodeUrls[g]}`).join(','),
      MEDABE_ADMIN_TOKEN: o.persist?.adminToken ?? randomBytes(16).toString('hex'), MEDABE_SERVICE_TOKEN: serviceToken, MEDABE_SIEM_TOKEN: o.persist?.siemToken ?? randomBytes(16).toString('hex'),
      MEDABE_SIEM_FILE: join(dataDir, 'siem.jsonl'), MEDABE_AGENT_ENABLED: 'false',
      MEDABE_RESEARCH_ENABLED: 'true', MEDABE_RESEARCH_LEGACY_BRIDGE: o.legacyBridge ? 'true' : 'false', MEDABE_RESEARCH_EVIDENCE: o.evidence === false ? 'false' : 'true',
      MEDABE_RESEARCH_PBKDF2_ITERATIONS: String(o.passwordIterations ?? 600_000), MEDABE_RESEARCH_LOGIN_RATE: '100000',
      MEDABE_BASELINE_KEK: kek,
      MEDABE_RESEARCH_SEED_USERS: o.seedUsers !== undefined ? o.seedUsers : o.seedDemoUsers === false ? '' : DEMO_USERS.map((u) => `${u.username}|${u.password}|${u.role}|${u.khoa}|${u.name}`).join(','),
      ...(o.zones ? { MEDABE_NETWORK_ZONES: o.zones } : {}),
      ...(o.initialSchedule === null ? {} : { MEDABE_RESEARCH_INITIAL_SCHEDULE: JSON.stringify(o.initialSchedule ?? ALL_DAY) }),
      ...o.env,
    },
  });
  spring.stdout?.on('data', (d: Buffer) => writeFileSync(springLog, d, { flag: 'a' }));
  spring.stderr?.on('data', (d: Buffer) => writeFileSync(springLog, d, { flag: 'a' }));
  let exited = false;
  spring.on('exit', () => { exited = true; });

  const local = `https://127.0.0.1:${springPort}`;      // kiểm tra sẵn sàng qua loopback (luôn được phép, kể cả khi cấu hình vùng mạng chặn host)
  let cfg: { registryPk: string; pk: Parameters<typeof abePkDigest>[0] } | undefined;
  for (let i = 0; i < 240 && !cfg; i++) {
    if (exited) throw new Error('Spring thoát sớm; xem ' + springLog);
    try { const r = await f(`${local}/api/v2/status`); if (r.ok) cfg = (await (await f(`${local}/api/config`)).json()) as typeof cfg; } catch { /* chưa sẵn sàng */ }
    if (!cfg) await new Promise((r) => setTimeout(r, 500));
  }
  if (!cfg) { spring.kill(); throw new Error('Spring không khởi động được; xem ' + springLog); }

  // Các nút chạy trong tiến trình này nên đọc vùng mạng từ process.env; khôi phục khi dừng.
  const prevZones = process.env.MEDABE_NETWORK_ZONES;
  if (o.zones && !o.noNodes) process.env.MEDABE_NETWORK_ZONES = o.zones;
  for (const g of ORGS) process.env[`ADMIN_TOKEN_${g}`] = randomBytes(8).toString('hex');
  process.env.APPROVER_TOKEN = randomBytes(8).toString('hex');
  const localOrgs = ORGS.filter((g) => !o.remoteNodes?.[g]);
  const started = o.noNodes || !localOrgs.length ? { servers: [] as Server[] } : startNodes({
    dataDir, storageBase: baseUrl, registryPk: cfg.registryPk, serviceToken, ports, only: localOrgs,
    research: { backendBase: baseUrl }, fetchFn: f, tls: { pfx: readFileSync(tls.serverP12), passphrase: tls.password },
  });
  await new Promise((r) => setTimeout(r, 300));

  return {
    baseUrl, nodeUrls, caPem: tls.caPem, caFile: tls.caFile, fetch: f, registryPk: cfg.registryPk, abePkSha256: abePkDigest(cfg.pk), serviceToken, kek, dataDir, tlsDir: tls.dir, springLog,
    async stop() {
      (started.servers as Server[]).forEach((s) => { s.close(); s.closeAllConnections?.(); });
      spring.kill();
      if (o.zones && !o.noNodes) { if (prevZones === undefined) delete process.env.MEDABE_NETWORK_ZONES; else process.env.MEDABE_NETWORK_ZONES = prevZones; }
      await new Promise((r) => setTimeout(r, 200));
    },
  };
}

if (process.argv[1]?.endsWith('research-stack.ts')) {
  const dataDir = process.env.DATA_DIR ?? 'data-research';
  const s = await startResearchStack({ dataDir, ports: { spring: Number(process.env.PORT ?? 8443) } });
  console.log(`Backend HTTPS : ${s.baseUrl}\nCA để ghim    : ${s.caFile}\nNút cấp khoá  : ${Object.values(s.nodeUrls).join(' , ')}\nDữ liệu       : ${s.dataDir}`);
  console.log('Tài khoản mẫu (DỮ LIỆU GIẢ, chỉ để nghiên cứu):');
  for (const u of DEMO_USERS) console.log(`  ${u.username} / ${u.password}   (${u.role}${u.khoa ? ' ' + u.khoa : ''})`);
  console.log(`Chữ ký registry (ghim): ${s.registryPk}\nBăm tham số ABE (ghim): ${s.abePkSha256}`);
  process.on('SIGINT', () => void s.stop().then(() => process.exit(0)));
}
