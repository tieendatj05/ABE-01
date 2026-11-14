// KIỂM TRA TRUYỀN TẢI TỪNG CHẶNG bằng "máy nghe lén" TCP đặt giữa máy khách và máy chủ (proxy chuyển tiếp nguyên byte, ghi lại mọi byte đi qua). HỒ SƠ GIẢ có họ tên, CCCD và chuỗi dấu (canary).
// Chặng thử: (1) máy khách → Spring (HTTPS); (2) máy khách → cổng liên thông Bộ Y tế (HTTP, đúng như cấu hình app chạy hiện nay); (3) cấu hình phục vụ app web (HTTP, kiểm tra tệp tĩnh);
// (4) nhật ký máy chủ. Mục tiêu: trên mỗi chặng, kẻ nghe lén thấy gì (nội dung hồ sơ, họ tên, CCCD, token, tên thuộc tính) và có phát lại/sửa được không.
// Ghi chú: MedClient từ chối kết nối qua proxy đặt ở CỔNG KHÁC vì "bằng chứng máy chủ" có chữ ký gắn với địa chỉ + cổng thật (chống chuyển hướng) — nên chặng 1 dùng yêu cầu thủ công.
// Kết quả ghi ra .test-runs/abe-thuc-nghiem/truyen-tai.json.
import { createServer, connect, type Server, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytPublicKey, startGateway } from '../deploy/byt.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { MedClient } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
const [A] = fakePatients(1, 90210);
const CCCD = A.hanhchinh.cccd, NAME = A.hanhchinh.hoTen, CANARY = 'CANARY-TRUYEN-TAI-' + A.hanhchinh.canary.replace(/[^A-Za-z0-9-]/g, '');
const result: Record<string, unknown> = { cauHinh: { ghi: 'máy nghe lén = proxy TCP chuyển tiếp nguyên byte trên loopback; chặng nút cấp khoá cũng là HTTPS (cùng thư viện TLS) nhưng không đặt máy nghe lén ở đó' } };

interface Tap { port: number; server: Server; up(): Buffer; down(): Buffer; reset(): void }
async function tap(targetPort: number): Promise<Tap> {
  let up: Buffer[] = [], down: Buffer[] = [];
  const server = createServer((c: Socket) => {
    const t = connect(targetPort, '127.0.0.1');
    c.on('data', (d) => { up.push(d as Buffer); t.write(d); }); t.on('data', (d) => { down.push(d as Buffer); c.write(d); });
    c.on('error', () => t.destroy()); t.on('error', () => c.destroy()); c.on('close', () => t.destroy()); t.on('close', () => c.destroy());
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  return { port, server, up: () => Buffer.concat(up), down: () => Buffer.concat(down), reset: () => { up = []; down = []; } };
}
const hasAny = (b: Buffer, ss: string[]) => ss.filter((s) => s && b.includes(Buffer.from(s, 'utf8')));
/** Tách các yêu cầu HTTP/1.1 trong luồng byte nghe lén (theo Content-Length). */
function parseRequests(buf: Buffer): { method: string; path: string; headers: Record<string, string>; body: Buffer }[] {
  const out: ReturnType<typeof parseRequests> = [];
  let pos = 0;
  while (pos < buf.length) {
    const end = buf.indexOf('\r\n\r\n', pos, 'latin1');
    if (end < 0) break;
    const lines = buf.subarray(pos, end).toString('latin1').split('\r\n');
    const [method, path] = lines[0].split(' ');
    const headers: Record<string, string> = {};
    for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
    const len = Number(headers['content-length'] ?? 0);
    out.push({ method, path, headers, body: buf.subarray(end + 4, end + 4 + len) });
    pos = end + 4 + len;
  }
  return out;
}

let S: ResearchStack; let dir = ''; let gwTap: Tap, springTap: Tap; let gw: ReturnType<typeof startGateway>;
const mixedFetch = ((u: RequestInfo | URL, init?: RequestInit) => (String(u).startsWith('http://') ? fetch(u, init) : S.fetch(u, init))) as typeof fetch;
let nl: MedClient;

beforeAll(async () => {
  if (!JAR) return;
  dir = mkdtempSync(join(tmpdir(), 'medabe-tt-'));
  const gwPort = await freePort();
  gwTap = await tap(gwPort);
  S = await startResearchStack({ dataDir: dir, passwordIterations: 20000, legacyBridge: true, env: { MEDABE_BYT_URL: `http://127.0.0.1:${gwTap.port}`, MEDABE_BYT_PK: bytPublicKey(dir) } });
  gw = startGateway({ dataDir: dir, port: gwPort, registryPk: S.registryPk });
  springTap = await tap(Number(new URL(S.baseUrl).port));
  nl = await MedClient.signIn(S.baseUrl, 'nhaplieu01', pw('nhaplieu01'), new MemoryDeviceKeyStore(), { fetch: mixedFetch });
  await nl.saveMany([{ patientCode: CCCD, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: NAME, cccd: CCCD, canary: CANARY }, group: 'TRUONG-A' }]);
  await nl.saveRecord({ patientCode: CCCD, type: 'thecuc', khoa: 'KSK', data: { chieuCao: '170', canary: CANARY }, group: 'TRUONG-A' });
}, 400_000);
afterAll(async () => {
  try { mkdirSync(resolve('.test-runs/abe-thuc-nghiem'), { recursive: true }); writeFileSync(resolve('.test-runs/abe-thuc-nghiem/truyen-tai.json'), JSON.stringify(result, null, 2)); } catch { /* bỏ qua */ }
  gw?.server.close(); gwTap?.server.close(); springTap?.server.close(); await S?.stop();
});

describe.skipIf(!JAR)('Chặng 1 — máy khách → Spring (HTTPS): kẻ nghe lén chỉ thấy TLS', () => {
  it('yêu cầu thủ công có họ tên, CCCD, mật khẩu, token trong URL + header + thân: trên dây KHÔNG thấy gì; byte đầu là bản ghi TLS; HTTP thường bị từ chối; phiên bản TLS thực tế', async () => {
    const via = `https://127.0.0.1:${springTap.port}`;
    springTap.reset();
    const login = await S.fetch(via + '/api/v2/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'tiepdon01', password: pw('tiepdon01'), ghiChu: `${NAME} ${CCCD} ${CANARY}` }) });
    const token = ((await login.json()) as { token?: string }).token ?? '';
    expect(token.length).toBeGreaterThan(20);
    const me = await S.fetch(`${via}/api/v2/auth/me?hoTen=${encodeURIComponent(NAME)}&cccd=${CCCD}`, { headers: { authorization: `Bearer ${token}`, 'x-canary': CANARY } });
    expect(me.status).toBe(200);
    const up = springTap.up(), down = springTap.down();
    const found = hasAny(Buffer.concat([up, down]), [NAME, encodeURIComponent(NAME), CCCD, CANARY, token, pw('tiepdon01'), 'Bearer', 'authorization', 'password', 'tiepdon01']);
    expect(found).toEqual([]);
    expect(up[0]).toBe(0x16);                                                        // TLS Handshake record
    const plain = await fetch(`http://127.0.0.1:${new URL(S.baseUrl).port}/api/v2/status`).then((r) => r.status).catch(() => 0);
    const tlsInfo = await new Promise<{ proto: string | null; cipher: string }>((ok, fail) => {
      const s = tlsConnect({ host: '127.0.0.1', port: Number(new URL(S.baseUrl).port), ca: S.caPem, servername: '127.0.0.1' }, () => { ok({ proto: s.getProtocol(), cipher: s.getCipher().name }); s.end(); });
      s.on('error', fail);
    });
    result.chang1_MayKhach_Spring_HTTPS = { baoGuiLen: up.length, baoNhanVe: down.length, thayDuoc: found, bytDau: '0x16 (TLS handshake)', httpThuong: `HTTP ${plain} (bị từ chối)`, tls: tlsInfo,
      ketLuan: 'HTTPS che toàn bộ URL, header (kể cả token), thân (kể cả mật khẩu, họ tên, CCCD) khỏi kẻ nghe lén trên dây; máy khách chỉ chấp nhận chứng chỉ của CA đã ghim' };
    expect(plain === 400 || plain === 0).toBe(true);
    expect(tlsInfo.proto).toBe('TLSv1.3');
  }, 300_000);
});

describe.skipIf(!JAR)('Chặng 2 — máy khách → cổng liên thông Bộ Y tế (HTTP): nội dung hồ sơ vẫn được ABE bảo vệ, nhưng siêu dữ liệu và kết nối thì KHÔNG', () => {
  let submitReq: { method: string; path: string; headers: Record<string, string>; body: Buffer } | undefined;
  it('qua máy nghe lén HTTP: KHÔNG thấy họ tên/CCCD/canary/token; NHƯNG thấy siêu dữ liệu: loại mục, chỉ mục mù, mã thiết bị, chứng chỉ thiết bị, CHÍNH SÁCH (tên thuộc tính)', async () => {
    const rows = (await nl.listRecords(CCCD)).filter((r) => r.type === 'hanhchinh' || r.type === 'thecuc');
    expect(rows.length).toBe(2);
    const { facilities } = await nl.bytInfo();
    gwTap.reset();
    const out = await nl.bytSubmit(rows, facilities[0].ma);
    expect(out.receipts.size).toBe(2);
    const up = gwTap.up(), down = gwTap.down();
    submitReq = parseRequests(up).find((r) => r.path === '/byt/submit');
    expect(submitReq).toBeDefined();
    const all = Buffer.concat([up, down]);
    const leakedPlain = hasAny(all, [NAME, CCCD, CANARY, nl.s.token, 'Bearer']);
    expect(leakedPlain).toEqual([]);                                                  // nội dung hồ sơ KHÔNG lộ (đã mã hoá ABE trước khi gửi)
    const text = up.toString('latin1');
    const meta = {
      dongYeuCau: text.split('\r\n')[0],
      thayChinhSach: /MED:[A-Za-z]+:[A-Za-z]+#\d{4}W\d{2}\.\d+/.exec(text)?.[0] ?? null,
      thayLoaiMuc: /"type":"(hanhchinh|thecuc)"/.test(text),
      thayChiMucMu: /"patientIdx":"[0-9a-f]{32}"/.test(text),
      thayMaThietBi: /"authorDevice":"[0-9a-f]{16}"/.test(text),
      thayChungChiThietBi: Object.keys(submitReq!.headers).includes('x-device') && submitReq!.headers['x-device'].length > 100,
      thayTokenPhien: /authorization/i.test(text),
    };
    expect(meta.thayChinhSach).not.toBeNull(); expect(meta.thayChungChiThietBi).toBe(true); expect(meta.thayTokenPhien).toBe(false);
    result.chang2_MayKhach_CongLienThong_HTTP = { baoGuiLen: up.length, baoNhanVe: down.length, noiDungHoSoLo: leakedPlain, sieuDuLieuThayDuoc: meta,
      ketLuan: 'Lớp ABE giữ bí mật NỘI DUNG (họ tên, CCCD, kết quả) ngay cả trên đường HTTP; nhưng HTTP không che siêu dữ liệu, không xác thực máy chủ cho kẻ ở giữa, không mã hoá kết nối.' };
  }, 300_000);

  it('phát lại yêu cầu đã nghe lén (cùng chữ ký) bị cổng từ chối; sửa thân yêu cầu thì chữ ký không còn khớp', async () => {
    const r = submitReq!;
    const url = `http://127.0.0.1:${(gw.server.address() as { port: number }).port}${r.path}`;
    const hdr = { 'content-type': 'application/json', 'x-device': r.headers['x-device'], 'x-ts': r.headers['x-ts'], 'x-sig': r.headers['x-sig'] };
    const replay = await fetch(url, { method: 'POST', headers: hdr, body: new Uint8Array(r.body) });
    const replayText = await replay.text();
    const mutated = Buffer.from(r.body.toString('utf8').replace('"type":"thecuc"', '"type":"ketluan"'), 'utf8');
    expect(mutated.equals(r.body)).toBe(false);
    const tampered = await fetch(url, { method: 'POST', headers: hdr, body: new Uint8Array(mutated) });
    const tamperedText = await tampered.text();
    expect(replay.status).toBe(401); expect(replayText).toMatch(/phát lại/);
    expect(tampered.status).toBe(401); expect(tamperedText).toMatch(/chữ ký yêu cầu không hợp lệ/);
    result.chang2_phatLaiVaSua = { phatLai: `${replay.status} ${replayText.slice(0, 90)}`, suaThanYeuCau: `${tampered.status} ${tamperedText.slice(0, 90)}`, ghi: 'cổng chặn phát lại bằng chữ ký từng yêu cầu + cửa sổ thời gian; chữ ký phủ cả băm thân yêu cầu' };
  }, 120_000);

  it('SAU KHI VÁ: cùng yêu cầu gửi tới cổng chạy HTTPS (research-server.ts bật mặc định) — siêu dữ liệu biến mất khỏi dây; HTTP thường vào cổng này bị từ chối', async () => {
    const r = submitReq!;
    const tlsGw = startGateway({ dataDir: mkdtempSync(join(tmpdir(), 'medabe-gwtls-')), port: 0, registryPk: S.registryPk,
      tls: { pfx: readFileSync(join(S.tlsDir, 'server.p12')), passphrase: (JSON.parse(readFileSync(join(S.tlsDir, 'tls.json'), 'utf8')) as { password: string }).password } });
    try {
      await new Promise((ok) => setTimeout(ok, 300));
      const realPort = (tlsGw.server.address() as { port: number }).port;
      const tlsTap = await tap(realPort);
      try {
        const hdr = { 'content-type': 'application/json', 'x-device': r.headers['x-device'], 'x-ts': r.headers['x-ts'], 'x-sig': r.headers['x-sig'] };
        const via = `https://127.0.0.1:${tlsTap.port}`;
        const info = await S.fetch(via + '/byt/info');                                     // máy khách ghim CA: kết nối được
        expect(info.status).toBe(200);
        tlsTap.reset();
        const sent = await S.fetch(via + r.path, { method: 'POST', headers: hdr, body: new Uint8Array(r.body) });
        await sent.text();
        const wire = Buffer.concat([tlsTap.up(), tlsTap.down()]);
        const wireText = wire.toString('latin1');
        const sauVa = {
          thayChinhSach: /MED:[A-Za-z]+:[A-Za-z]+#\d{4}W\d{2}\.\d+/.test(wireText),
          thayLoaiMuc: /"type":"(hanhchinh|thecuc)"/.test(wireText),
          thayChiMucMu: /"patientIdx":"[0-9a-f]{32}"/.test(wireText),
          thayChungChiThietBi: wireText.includes('x-device') || wireText.includes(r.headers['x-device'].slice(0, 40)),
          thayDuongDan: wireText.includes('/byt/submit'),
        };
        expect(Object.values(sauVa)).toEqual([false, false, false, false, false]);
        expect(tlsTap.up()[0]).toBe(0x16);
        // HTTP thường vào cổng TLS: không nhận được dữ liệu hữu ích
        const plain = await fetch(`http://127.0.0.1:${realPort}/byt/info`).then((x) => x.status).catch(() => 0);
        expect(plain === 400 || plain === 0).toBe(true);
        // máy khách KHÔNG ghim đúng CA (kẻ mạo danh cổng bằng chứng chỉ khác) bị từ chối
        const sansCa = await new Promise<string>((ok) => { const s = tlsConnect({ host: '127.0.0.1', port: realPort, servername: '127.0.0.1' }, () => ok('KẾT NỐI ĐƯỢC (sai)')); s.on('error', (e) => ok(String((e as Error).message))); });
        expect(sansCa).not.toMatch(/sai/);
        result.chang2_SauKhiVa_CongLienThong_HTTPS = { baoGuiLen: tlsTap.up().length, baoNhanVe: tlsTap.down().length, trenDay: sauVa, httpThuong: `HTTP ${plain} (bị từ chối)`, khongGhimCA: sansCa,
          ketLuan: 'Chạy cổng liên thông bằng HTTPS (cùng chứng chỉ với máy chủ): chính sách, loại mục, chỉ mục mù, chứng chỉ thiết bị và đường dẫn không còn thấy được trên dây; máy khách không ghim CA không kết nối được. Chữ ký từng yêu cầu vẫn giữ làm lớp chống phát lại độc lập.' };
      } finally { tlsTap.server.close(); }
    } finally { tlsGw.server.close(); tlsGw.server.closeAllConnections?.(); }
  }, 120_000);
});

describe.skipIf(!JAR)('Chặng 3 — cấu hình phục vụ app web: tệp tĩnh qua HTTP', () => {
  it('index.html và mã JS của app được phục vụ bằng HTTP thường, không có SRI: kẻ ở giữa mạng có thể SỬA mã chạy trong trình duyệt (nơi giải mã ABE)', () => {
    const idx = resolve('app/web/dist/index.html');
    expect(existsSync(idx)).toBe(true);
    const html = readFileSync(idx, 'utf8');
    const server = readFileSync(resolve('security/src/deploy/research-server.ts'), 'utf8');
    const fn = server.slice(server.indexOf('function serveStatic'), server.indexOf('function ensureCaTrusted'));
    const servedByHttp = /createServer\(/.test(fn) && !/createHttps|node:https/.test(fn);
    const sri = /integrity=/.test(html);
    const csp = /Content-Security-Policy/i.test(html);
    result.chang3_AppWeb_HTTP = { phucVuBangHTTP: servedByHttp, coSRI: sri, coCSP: csp,
      ketLuan: 'Mã JS tải qua HTTP nên không có bảo đảm toàn vẹn; CSP chỉ giới hạn nguồn script SAU KHI trang được tải, không chống sửa chính trang qua HTTP. Giải mã ABE chạy trong trình duyệt ⇒ đây là điểm yếu của MỌI ứng dụng mã hoá phía máy khách phân phối qua web (không riêng ABE).' };
    expect(servedByHttp).toBe(true); expect(sri).toBe(false);
  });
});

describe.skipIf(!JAR)('Chặng 4 — nhật ký máy chủ và nhật ký quản trị không chứa họ tên, CCCD, canary hay token', () => {
  it('quét tệp log Spring và nhật ký quản trị sau toàn bộ luồng ở trên', async () => {
    const log = readFileSync(S.springLog, 'utf8');
    const qt = await MedClient.signIn(S.baseUrl, 'quantri01', pw('quantri01'), new MemoryDeviceKeyStore(), { fetch: S.fetch });
    const audit = JSON.stringify((await qt.api<{ records: unknown[] }>('GET', '/api/v2/admin/audit?limit=1000')).records);
    const tok = [NAME, CCCD, CANARY];
    const inLog = tok.filter((t) => log.includes(t)), inAudit = tok.filter((t) => audit.includes(t));
    expect(inLog).toEqual([]); expect(inAudit).toEqual([]);
    result.chang4_nhatKy = { springLogByte: log.length, auditByte: audit.length, hoTenCCCDCanaryTrongLog: inLog, trongNhatKyQuanTri: inAudit };
  }, 120_000);
});
