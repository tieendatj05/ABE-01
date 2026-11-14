// Cổng liên thông Bộ Y tế (mô phỏng): kiểm thử riêng, không cần Spring/Java. Registry giả được dựng ngay trong test.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gidMessage } from '../authority/node.js';
import { devicePubHex, loadOrCreateDeviceKeys, MemoryKeyStore, signWithDevice, type DeviceKeys } from '../client/device.js';
import { startGateway } from '../deploy/byt.js';
import { verifyReceipt, type Receipt } from './receipt.js';

const registryPriv = ed25519.utils.randomSecretKey();
const registryPk = bytesToHex(ed25519.getPublicKey(registryPriv));
let dir = '', base = '', pk = '', server: Server, pubServer: Server, pub = '';
let clock = Date.now();

interface Dev { gid: string; pub: string; cert: string; keys: DeviceKeys }
async function device(signer = registryPriv): Promise<Dev> {
  const keys = await loadOrCreateDeviceKeys(new MemoryKeyStore());
  const pub = await devicePubHex(keys);
  const gid = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  return { gid, pub, cert: bytesToHex(ed25519.sign(gidMessage(gid, pub), signer)), keys };
}
/** Một yêu cầu ký như MedClient.bytCall. `ts` và `body` có thể chỉnh để thử tấn công. */
async function call(d: Dev, method: 'GET' | 'POST', path: string, body?: unknown, opt: { ts?: number; replay?: Record<string, string> } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = String(opt.ts ?? clock);
  const sig = await signWithDevice(d.keys, `byt|${method}|${path}|${ts}|${bytesToHex(sha256(new TextEncoder().encode(raw)))}`);
  const headers = opt.replay ?? { 'content-type': 'application/json', 'x-device': btoa(JSON.stringify({ gid: d.gid, devicePub: d.pub, cert: d.cert })), 'x-ts': ts, 'x-sig': sig };
  const r = await fetch(base + path, { method, headers, body: raw || undefined });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any>, headers };
}

const hex = (n: number) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
const rec = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), patientIdx: hex(16), groupIdx: hex(16), type: 'thecuc', khoa: 'KSK', authorDevice: 'abcdef0123456789', createdAt: new Date().toISOString(),
  envelope: { v: 2, abe: { policy: 'MED:Org:SoYTe#2026W42.0', rows: [] }, wrapIv: hex(12), wrappedDek: hex(48), iv: hex(12), ciphertext: hex(64) }, parentIdx: hex(16), parentWrap: { iv: hex(12), ct: hex(48) }, ...over,
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'byt-'));
  const web = join(dir, 'web'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<!doctype html><title>KSK</title>');
  const g = startGateway({ dataDir: dir, port: 0, registryPk, facility: { ma: 'TEST0001', ten: 'Cơ sở thử' }, publicPort: 0, staticDir: web });
  server = g.server; pk = g.publicKey; pubServer = g.publicServer!;
  await new Promise((r) => (pubServer.listening ? r(null) : pubServer.once('listening', () => r(null))));
  pub = `http://127.0.0.1:${(pubServer.address() as { port: number }).port}`;
  await new Promise((r) => (server.listening ? r(null) : server.once('listening', () => r(null))));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server?.close(); server?.closeAllConnections?.(); pubServer?.close(); pubServer?.closeAllConnections?.(); rmSync(dir, { recursive: true, force: true }); });

describe('cổng liên thông Bộ Y tế (mô phỏng)', () => {
  it('công khai khoá ký và danh sách cơ sở', async () => {
    const r = await (await fetch(base + '/byt/info')).json() as { pk: string; facilities: { ma: string }[] };
    expect(r.pk).toBe(pk);
    expect(r.facilities.map((f) => f.ma)).toEqual(['TEST0001']);
  });

  it('không có chữ ký thiết bị / chứng chỉ của registry khác / ký sai thì bị từ chối', async () => {
    expect((await fetch(base + '/byt/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ids":[]}' })).status).toBe(401);
    const fake = await device(ed25519.utils.randomSecretKey());                 // chứng chỉ do một "registry" khác cấp
    expect((await call(fake, 'POST', '/byt/status', { ids: [] })).status).toBe(401);
    const ok = await device();
    const a = await call(ok, 'POST', '/byt/status', { ids: [] });
    expect(a.status).toBe(200);
    const swapped = { ...a.headers, 'x-sig': a.headers['x-sig'].replace(/.$/, (c) => (c === '0' ? '1' : '0')) };
    expect((await call(ok, 'POST', '/byt/status', { ids: [] }, { replay: swapped })).status).toBe(401);
  });

  it('chống phát lại và yêu cầu hết hạn', async () => {
    const d = await device();
    const first = await call(d, 'POST', '/byt/status', { ids: [] });
    expect(first.status).toBe(200);
    expect((await call(d, 'POST', '/byt/status', { ids: [] }, { replay: first.headers })).status).toBe(401);       // cùng yêu cầu gửi lại
    expect((await call(d, 'POST', '/byt/status', { ids: [] }, { ts: clock - 10 * 60_000 })).status).toBe(401);     // quá 5 phút
  });

  it('nhận bản ghi, trả biên nhận có chữ ký; gửi lại cùng nội dung thì giữ nguyên biên nhận', async () => {
    const d = await device();
    const r1 = rec();
    const res = await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [r1] });
    expect(res.status).toBe(200);
    expect(res.json.created).toBe(1);
    const receipt = res.json.receipts[0] as Receipt;
    expect(receipt).toMatchObject({ maCskcb: 'TEST0001', recordId: r1.id });
    expect(receipt.receiptId).toMatch(/^BN-[0-9A-F]{8}$/);
    expect(verifyReceipt(pk, receipt)).toBe(true);
    expect(verifyReceipt(pk, { ...receipt, recordId: crypto.randomUUID() })).toBe(false);          // sửa biên nhận -> hỏng chữ ký
    expect(verifyReceipt(pk, { ...receipt, maCskcb: 'KHAC0001' })).toBe(false);
    expect(verifyReceipt(bytesToHex(ed25519.getPublicKey(ed25519.utils.randomSecretKey())), receipt)).toBe(false);   // khoá khác

    const again = await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [{ ...r1, envelope: { ...r1.envelope, wrapIv: hex(12) } }] });   // chỉ đổi phần ABE (bọc lại)
    expect(again.json.created).toBe(0);
    expect(again.json.refreshed).toBe(1);
    expect(again.json.receipts[0].receiptId).toBe(receipt.receiptId);

    const st = await call(d, 'POST', '/byt/status', { ids: [r1.id, crypto.randomUUID()] });
    expect(st.json.receipts).toHaveLength(1);
  });

  it('từ chối: cơ sở lạ, cùng id nhưng nội dung khác, phong bì hỏng, thiếu header chung', async () => {
    const d = await device();
    expect((await call(d, 'POST', '/byt/submit', { maCskcb: 'LA0001', records: [rec()] })).status).toBe(403);
    const r1 = rec();
    await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [r1] });
    const tampered = await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [{ ...r1, envelope: { ...r1.envelope, ciphertext: hex(64) } }] });
    expect(tampered.json.rejected[0].error).toMatch(/nội dung khác/);                              // đã nhận rồi thì không thay được nội dung
    const bad = await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [rec({ envelope: { v: 2, iv: 'zz', ciphertext: 'zz' } }), rec({ type: 'khac' })] });
    expect(bad.json.rejected).toHaveLength(2);
    const shared = await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [rec({ envelope: { v: 3, headerId: crypto.randomUUID(), iv: hex(12), ciphertext: hex(32) } })] });
    expect(shared.json.rejected[0].error).toMatch(/header khoá chung/);
  });

  it('bản ghi dùng header chung: gửi kèm header thì nhận, và trả header khi Bộ Y tế tải', async () => {
    const d = await device();
    const hid = crypto.randomUUID();
    const header = { id: hid, policy: 'MED:Org:SoYTe#2026W42.0', abe: { policy: 'x', rows: [] }, wrapIv: hex(12), wrappedDek: hex(48) };
    const group = hex(16);
    const r1 = rec({ groupIdx: group, type: 'hanhchinh', envelope: { v: 3, headerId: hid, iv: hex(12), ciphertext: hex(32) } });
    const res = await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [r1], headers: [header] });
    expect(res.json.created).toBe(1);
    const list = await call(d, 'GET', `/byt/records?groupIdx=${group}&type=hanhchinh`);
    expect(list.json.records).toHaveLength(1);
    expect(list.json.records[0].receipt.recordId).toBe(r1.id);
    expect(list.json.headers.map((h: { id: string }) => h.id)).toEqual([hid]);
  });

  it('liệt kê theo đơn vị chỉ lấy bản MỚI NHẤT của mỗi bệnh nhân; thống kê theo cơ sở', async () => {
    const d = await device();
    const group = hex(16), p = hex(16);
    const old = rec({ groupIdx: group, patientIdx: p, type: 'hanhchinh', createdAt: '2026-01-01T00:00:00.000Z' });
    const neu = rec({ groupIdx: group, patientIdx: p, type: 'hanhchinh', createdAt: '2026-02-01T00:00:00.000Z' });
    await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [old, neu] });
    const list = await call(d, 'GET', `/byt/records?groupIdx=${group}&type=hanhchinh`);
    expect(list.json.records.map((r: { id: string }) => r.id)).toEqual([neu.id]);
    expect((await call(d, 'GET', `/byt/records?patientIdx=${p}`)).json.records).toHaveLength(2);
    expect((await call(d, 'GET', '/byt/records')).status).toBe(400);
    const stats = await call(d, 'GET', '/byt/stats');
    expect(stats.json.facilities[0]).toMatchObject({ ma: 'TEST0001' });
    expect(stats.json.facilities[0].records).toBeGreaterThan(3);
  });

  it('phụ huynh tra cứu qua cổng (không cần chữ ký): chỉ thấy bản ghi đã liên thông, đúng chỉ mục', async () => {
    const d = await device();
    const parentIdx = hex(16);
    const r1 = rec({ parentIdx });
    await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [r1] });
    const rows = await (await fetch(`${base}/api/public/parent-records?parentIdx=${parentIdx}`)).json() as { id: string; parentWrap: unknown; envelope: { iv: string } }[];
    expect(rows.map((r) => r.id)).toEqual([r1.id]);
    expect(rows[0].parentWrap).toBeTruthy();
    expect(await (await fetch(`${base}/api/public/parent-records?parentIdx=${hex(16)}`)).json()).toEqual([]);   // chỉ mục khác: không có gì
    const v = await (await fetch(`${base}/api/public/parent-version?parentIdx=${parentIdx}`)).json() as { n: number };
    expect(v.n).toBe(1);
    expect((await fetch(`${base}/api/public/parent-records?parentIdx=xyz`)).status).toBe(400);
  });

  it('CỔNG CÔNG KHAI (cho điện thoại ngoài LAN): chỉ có /api/public/*, không có /byt/*, tra cứu được cùng dữ liệu', async () => {
    const d = await device();
    const parentIdx = hex(16);
    const r1 = rec({ parentIdx });
    await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [r1] });
    const rows = await (await fetch(`${pub}/api/public/parent-records?parentIdx=${parentIdx}`)).json() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([r1.id]);
    expect((await fetch(`${pub}/api/public/ping`)).status).toBe(200);
    // Mọi đường của nhân viên/Bộ Y tế KHÔNG tồn tại ở cổng công khai.
    for (const path of ['/byt/info', '/byt/records?patientIdx=' + hex(16), '/byt/stats']) expect((await fetch(pub + path)).status).toBe(404);
    expect((await fetch(pub + '/byt/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    // CORS cho WebView của app; phản hồi không được lưu đệm.
    const r = await fetch(`${pub}/api/public/parent-version?parentIdx=${parentIdx}`, { headers: { origin: 'https://localhost' } });
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(pub + '/api/public/parent-records?parentIdx=' + parentIdx, { method: 'OPTIONS' })).status).toBe(204);
    // Giao diện app được phục vụ cùng nguồn gốc (HTTPS qua đường hầm); đường lạ rơi về index (SPA), đường /api lạ thì 404.
    expect(await (await fetch(pub + '/')).text()).toContain('<title>KSK</title>');
    expect(await (await fetch(pub + '/mot/duong/la')).text()).toContain('<title>KSK</title>');
    expect((await fetch(pub + '/api/khong-co')).status).toBe(404);
  });

  it('chặn dò CCCD: một IP tra cứu liên tiếp không ra kết quả sẽ bị 429, người tra đúng thì không bị ảnh hưởng', async () => {
    const d = await device();
    const parentIdx = hex(16);
    await call(d, 'POST', '/byt/submit', { maCskcb: 'TEST0001', records: [rec({ parentIdx })] });
    const probe = (ip: string, idx: string) => fetch(`${pub}/api/public/parent-records?parentIdx=${idx}`, { headers: { 'cf-connecting-ip': ip } });   // IP thật do đường hầm báo
    for (let i = 0; i < 5; i++) expect((await probe('198.51.100.7', parentIdx)).status).toBe(200);        // tra đúng nhiều lần không bị coi là dò
    let blockedAt = 0;
    for (let i = 1; i <= 20; i++) { const x = await probe('203.0.113.9', hex(16)); if (x.status === 429) { blockedAt = i; break; } }
    expect(blockedAt).toBeGreaterThan(10);
    expect(blockedAt).toBeLessThanOrEqual(16);
    expect((await probe('203.0.113.9', parentIdx)).status).toBe(429);                                     // bị chặn cả khi sau đó đoán trúng
    expect((await probe('198.51.100.7', parentIdx)).status).toBe(200);                                    // IP khác vẫn dùng bình thường
  });
});
