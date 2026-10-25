// Kiểm thử đầu-cuối trên hệ thống THẬT: Spring Boot (kho lưu trữ mù + registry + SIEM) + 3 nút cấp khoá ngưỡng 2-trên-3.
// Cần jar: (cd security/storage && ./mvnw -DskipTests package). Không có jar thì bỏ qua.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOrCreateDeviceKeys, MemoryKeyStore, openVault, sealVault } from './client/device.js';
import { MedClient, type RecordRow } from './client/medclient.js';
import { fetchForParent, parentVersion } from './client/parent.js';
import { initDealer, ORGS } from './deploy/init.js';
import { startNodes } from './deploy/nodes.js';
import { bytPublicKey, startGateway } from './deploy/byt.js';

const JAR = readdirSync(resolve('security/storage/target')).find((f) => /^medabe-storage-.*\.jar$/.test(f));
const ADMIN = 'adm-test';
const SERVICE = 'svc-test';
const FAIL_THRESHOLD = 3;

let S = '';                       // URL Spring
let dir = '';
let spring: ChildProcess;
let nodeServers: Server[] = [];
let nodeUrl: Record<string, string> = {};
const nodeAdmin: Record<string, string> = {};
let siemFile = '';
let bytUrl = '';
let bytServer: Server | undefined;

const freePort = () => new Promise<number>((res) => {
  const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});

async function api(base: string, path: string, headers: Record<string, string>, body?: unknown) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
}
const springAdmin = (path: string, body?: unknown) => api(S, path, { 'x-admin-token': ADMIN }, body);
const nodeAdminCall = (org: string, path: string, body?: unknown) => api(nodeUrl[org], path, { 'x-admin-token': nodeAdmin[org] }, body);

type Grants = Partial<Record<(typeof ORGS)[number], string[]>>;
async function person(name: string, grants: Grants) {
  const store = new MemoryKeyStore();
  const dk = await loadOrCreateDeviceKeys(store);
  const inv = await springAdmin('/api/admin/invites', { name });
  const c = await MedClient.register(S, inv.json.code, dk);
  for (const [org, attrs] of Object.entries(grants)) {
    const g = await nodeAdminCall(org, '/admin/grants', { name, attrs });
    await c.claim(org, g.json.code);
  }
  return { c, dk, store };
}
const BS = (khoa: string): Grants => ({ BenhVien: ['Role:BacSi', `Khoa:${khoa}`], SoYTe: ['Role:BacSi', `Khoa:${khoa}`], DienThoai: ['Role:BacSi', `Khoa:${khoa}`] });
const siemLines = () => readFileSync(siemFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>);

beforeAll(async () => {
  if (!JAR) return;
  dir = mkdtempSync(join(tmpdir(), 'medabe-'));
  initDealer(dir);
  const springPort = await freePort();
  const ports = Object.fromEntries(await Promise.all(ORGS.map(async (o) => [o, await freePort()]))) as Record<string, number>;
  S = `http://127.0.0.1:${springPort}`;
  siemFile = join(dir, 'siem.jsonl');
  const pk = readFileSync(join(dir, 'dealer', 'pk.json'), 'utf8');
  const bytPort = await freePort();
  bytUrl = `http://127.0.0.1:${bytPort}`;
  spring = spawn('java', ['-jar', join('security', 'storage', 'target', JAR)], {
    env: {
      ...process.env, PORT: String(springPort), DB_URL: 'jdbc:h2:mem:e2e;DB_CLOSE_DELAY=-1', MEDABE_PK_JSON: pk,
      MEDABE_NODES: ORGS.map((o) => `${o}=http://127.0.0.1:${ports[o]}`).join(','),
      MEDABE_ADMIN_TOKEN: ADMIN, MEDABE_SERVICE_TOKEN: SERVICE, MEDABE_SIEM_TOKEN: 'siem-demo', MEDABE_SIEM_FILE: siemFile, MEDABE_BYT_URL: bytUrl, MEDABE_BYT_PK: bytPublicKey(dir),
      MEDABE_FAILTHRESHOLD: String(FAIL_THRESHOLD),
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 180; i++) {
    if ((await fetch(`${S}/api/epochs`).catch(() => null))?.ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const cfg = (await (await fetch(`${S}/api/config`)).json()) as { registryPk: string };
  for (const o of ORGS) process.env[`ADMIN_TOKEN_${o}`] = `admin-${o}`;
  process.env.APPROVER_TOKEN = 'phone-demo';
  const started = startNodes({ ports, dataDir: dir, storageBase: S, registryPk: cfg.registryPk, serviceToken: SERVICE });
  nodeServers = started.servers;
  bytServer = startGateway({ dataDir: dir, port: bytPort, registryPk: cfg.registryPk }).server;
  Object.assign(nodeAdmin, started.tokens);
  nodeUrl = Object.fromEntries(ORGS.map((o) => [o, `http://127.0.0.1:${ports[o]}`]));
}, 180_000);

afterAll(() => {
  nodeServers.forEach((s) => { s.close(); s.closeAllConnections?.(); });
  bytServer?.close(); bytServer?.closeAllConnections?.();
  spring?.kill();
});

describe.skipIf(!JAR)('hệ thống y tế ABE đầu-cuối (Spring Boot + 3 nút ngưỡng 2/3)', () => {
  let hung: Awaited<ReturnType<typeof person>>;
  let lan: typeof hung, minh: typeof hung, mai: typeof hung, tuan: typeof hung;
  let rec: RecordRow;
  let idx = '';

  it('chuẩn bị: nhân sự từ nhiều khoa, thu ngân; mọi nhân sự được cấp khoá từ các nút', async () => {
    hung = await person('Bs Hung', BS('NoiTiet'));
    lan = await person('Bs Lan', BS('NgoaiKhoa'));
    minh = await person('Bs Minh', BS('CapCuu'));
    tuan = await person('Bs Tuan', BS('NoiTiet'));
    mai = await person('Tiep don Mai', { BenhVien: ['Role:TiepDon'], SoYTe: ['Role:TiepDon'] });
    idx = hung.c.patientIdx('BN001');
    expect(idx).toMatch(/^[0-9a-f]{32}$/);
  }, 240_000);

  it('bác sĩ lưu hồ sơ: policy TỰ SINH, máy chủ chỉ thấy ciphertext và chỉ mục mù', async () => {
    await hung.c.saveRecord({ patientCode: 'BN001', type: 'lamsang', khoa: 'NoiTiet', data: { chanDoan: 'Viem phoi thuy duoi', diUng: 'penicillin' } });
    const raw = JSON.stringify((await api(S, `/api/records?patientIdx=${idx}`, { authorization: `Bearer ${hung.c.s.token}` })).json);
    expect(raw).not.toContain('Viem phoi');
    expect(raw).not.toContain('penicillin');
    expect(raw).not.toContain('BN001');        // mã bệnh nhân không lên máy chủ
    rec = (await hung.c.listRecords('BN001'))[0];
    expect(await hung.c.policyOf(rec)).toMatch(/MED:Role:BacSi#\d{4}W\d{2}\.0 AND MED:Khoa:NoiTiet#/); // policy tự sinh, đã gắn epoch
  }, 120_000);

  it('đúng khoa mở được và chữ ký số hợp lệ; khoa khác / thu ngân bị từ chối', async () => {
    const mine = await hung.c.openRecord(rec);
    expect(mine?.data).toMatchObject({ chanDoan: 'Viem phoi thuy duoi' });
    expect(mine?.signatureValid).toBe(true);
    expect((await tuan.c.openRecord(rec))?.data).toMatchObject({ diUng: 'penicillin' });   // cùng khoa
    expect(await lan.c.openRecord(rec)).toBeNull();                                         // khác khoa
    expect(await mai.c.openRecord(rec)).toBeNull();                                         // tiếp đón không đọc dữ liệu lâm sàng
  }, 240_000);

  it('phiếu khám theo mục: tiếp đón đọc được HÀNH CHÍNH nhưng không đọc được LÂM SÀNG; liệt kê theo đơn vị', async () => {
    const admin = { name: 'Nguyen Van A (gia)', cccd: '079000000001', gioiTinh: 'Nam' };
    await hung.c.saveRecord({ patientCode: 'BN001', type: 'hanhchinh', khoa: 'KSK', data: admin, group: 'TRUONG-A' });
    const list = await mai.c.listGroup('TRUONG-A');                    // lưới danh sách của đơn vị
    expect(list).toHaveLength(1);
    expect((await mai.c.openRecord(list[0]))?.data).toMatchObject({ name: 'Nguyen Van A (gia)' });   // tiếp đón đọc được hành chính
    expect(await mai.c.openRecord(rec)).toBeNull();                    // nhưng không đọc được khám lâm sàng
    expect((await minh.c.listGroup('TRUONG-A')).length).toBe(1);       // máy chủ không biết nhóm là gì, chỉ gom theo HMAC
    const raw = JSON.stringify((await api(S, `/api/records?groupIdx=${mai.c.groupIdx('TRUONG-A')}&type=hanhchinh`, { authorization: `Bearer ${mai.c.s.token}` })).json);
    expect(raw).not.toContain('Nguyen Van A');
    expect(raw).not.toContain('TRUONG-A');
    expect(raw).not.toContain('079000000001');
  }, 240_000);

  it('chỉ thiết bị đã tạo mới xoá được bản ghi', async () => {
    const [row] = await hung.c.listGroup('TRUONG-A');
    await expect(mai.c.deleteRecord(row.id)).rejects.toThrow(/chi thiet bi da tao/);
    await hung.c.deleteRecord(row.id);
    expect(await hung.c.listGroup('TRUONG-A')).toHaveLength(0);
  }, 120_000);

  it('NHẬP HÀNG LOẠT: 60 hồ sơ dùng chung 1 header ABE; mở cả danh sách nhanh; người thiếu quyền bị từ chối và chỉ báo một lần', async () => {
    const people = Array.from({ length: 60 }, (_, i) => ({
      patientCode: `LOT${String(i).padStart(3, '0')}`, type: 'hanhchinh' as const, khoa: 'KSK', group: 'TRUONG-BULK',
      data: { hoTen: `HOC SINH SO ${i}`, cccd: `0790000${String(i).padStart(5, '0')}`, lop: '6A1' },
    }));
    const t0 = Date.now();
    const ids = await mai.c.saveMany(people);
    const tSave = Date.now() - t0;
    expect(ids).toHaveLength(60);
    expect(Object.keys(mai.c.s.shared ?? {})).toHaveLength(1);                         // 1 header cho cả lô

    const rows = await hung.c.listGroup('TRUONG-BULK');
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((r) => (r.envelope.v === 3 ? r.envelope.headerId : ''))).size).toBe(1);
    const t1 = Date.now();
    const res = await hung.c.openMany(rows);
    const tOpen = Date.now() - t1;
    expect(res.every((r) => r?.signatureValid)).toBe(true);                             // mỗi dòng vẫn có chữ ký số riêng, hợp lệ
    expect(new Set(res.map((r) => (r!.data as { hoTen: string }).hoTen)).size).toBe(60);
    console.log(`     (60 hồ sơ: mã hoá+lưu ${tSave} ms, mở cả danh sách ${tOpen} ms)`);
    expect(tOpen).toBeLessThan(10_000);                                                 // trước đây ~60 x 100 ms cho riêng ABE

    const raw = JSON.stringify((await api(S, `/api/records?groupIdx=${mai.c.groupIdx('TRUONG-BULK')}&type=hanhchinh`, { authorization: `Bearer ${mai.c.s.token}` })).json);
    expect(raw).not.toContain('HOC SINH');
    expect(raw).not.toContain('TRUONG-BULK');

    // Người KHÔNG thuộc chính sách hành chính (kỹ thuật viên): cả lô bị từ chối, nhưng chỉ phát sinh 1 sự kiện (không phải 60)
    const ktv = await person('KTV Xet nghiem', { BenhVien: ['Role:KTV', 'Khoa:XetNghiem'], SoYTe: ['Role:KTV', 'Khoa:XetNghiem'] });
    const before = siemLines().filter((e) => e.type === 'ACCESS_DENIED').length;
    const denied = await ktv.c.openMany(await ktv.c.listGroup('TRUONG-BULK'));
    expect(denied.every((r) => r === null)).toBe(true);
    expect(siemLines().filter((e) => e.type === 'ACCESS_DENIED').length - before).toBeLessThanOrEqual(1);

    // Đổi epoch của một thuộc tính trong chính sách: chỉ MỘT header được bọc lại cho cả lô
    expect((await springAdmin('/api/admin/epochs/bump', { base: 'MED:Role:KetLuan' })).status).toBe(200);
    const after = await hung.c.openMany(await hung.c.listGroup('TRUONG-BULK'));
    expect(after.filter((r) => r?.rewrapped).length).toBe(1);
    expect(after.every((r) => r?.data)).toBe(true);
    const polNow = await mai.c.policyOf((await mai.c.listGroup('TRUONG-BULK'))[0], true);
    expect(polNow).toMatch(/Role:KetLuan#\d{4}W\d{2}\.1/);
    expect((await mai.c.openMany(await mai.c.listGroup('TRUONG-BULK'))).every((r) => r?.data)).toBe(true);   // tiếp đón vẫn đọc được sau bọc lại
  }, 480_000);

  it('ĐĂNG KÝ TỰ DO: mặc định tắt; admin bật thì chỉ cần tên; chứng chỉ giả bị từ chối; tắt lại thì chặn', async () => {
    const newKeys = async () => loadOrCreateDeviceKeys(new MemoryKeyStore());
    // 1) mặc định TẮT: không có mã mời thì không vào được
    expect((await api(S, '/api/enrollment', {})).json.open).toBe(false);
    await expect(MedClient.registerOpen(S, 'Nguoi la', await newKeys())).rejects.toThrow(/dang ky tu do dang tat/);

    // 2) admin bật ở registry và ở cả 3 nút (bộ quyền mặc định do admin đặt, KHÔNG do máy tự chọn)
    await springAdmin('/api/admin/enrollment', { open: true });
    for (const org of ORGS) expect((await nodeAdminCall(org, '/admin/open-enrollment', { enabled: true, attrs: ['Role:BacSi', 'Khoa:Nhi'] })).json.enabled).toBe(true);
    const dev = await MedClient.registerOpen(S, 'Bs Tu Do', await newKeys());           // chỉ cần TÊN
    expect(dev.s.attrs.sort()).toEqual(['MED:Khoa:Nhi', 'MED:Role:BacSi']);
    const id = await dev.saveRecord({ patientCode: 'BN-TUDO', type: 'lamsang', khoa: 'Nhi', data: { x: 'ok' } });
    expect((await dev.openRecord((await dev.listRecords('BN-TUDO')).find((r) => r.id === id)!))?.data).toMatchObject({ x: 'ok' });

    // Interrupted first registration is checkpointed; resuming does not register the device again.
    for (const org of ['SoYTe', 'DienThoai']) await nodeAdminCall(org, '/admin/open-enrollment', { enabled: false, attrs: [] });
    const saved: MedClient[] = [];
    await expect(MedClient.registerOpen(S, 'Resume Demo', await newKeys(), undefined, undefined, async (client) => { saved.push(client); })).rejects.toThrow(/chỉ thành công/);
    const pending = saved.at(-1)!;
    expect(pending.s.pendingEnrollment).toBe(true);
    expect(pending.s.nodes).toHaveLength(1);
    for (const org of ['SoYTe', 'DienThoai']) await nodeAdminCall(org, '/admin/open-enrollment', { enabled: true, attrs: ['Role:BacSi', 'Khoa:Nhi'] });
    expect(await pending.claimAllOpen()).toBe(3);
    pending.s.nodes = []; // retry an acknowledged claim whose response was lost
    expect(await pending.claimAllOpen()).toBe(3);

    // 3) chứng chỉ giả (không phải do registry cấp) bị nút từ chối dù đăng ký tự do đang bật
    const sigKeys = await newKeys();
    const forged = await api(nodeUrl.BenhVien, '/claim-open', {}, { gid: 'a'.repeat(32), devicePub: await (await import('./client/device.js')).devicePubHex(sigKeys), cert: 'b'.repeat(128), sig: 'c'.repeat(128), name: 'Gia mao' });
    expect(forged.status).toBe(403);

    // 4) tắt lại: nút và registry đều chặn
    for (const org of ORGS) await nodeAdminCall(org, '/admin/open-enrollment', { enabled: false, attrs: [] });
    await springAdmin('/api/admin/enrollment', { open: false });
    await expect(MedClient.registerOpen(S, 'Sau khi tat', await newKeys())).rejects.toThrow(/dang ky tu do dang tat/);
    expect(siemLines().map((e) => e.type)).toContain('ENROLLMENT_OPENED');
  }, 240_000);

  it('PHÁ VỠ KÍNH: bác sĩ cấp cứu mở được nhưng mọi nút đều bắn cảnh báo CRITICAL', async () => {
    expect(await minh.c.openRecord(rec)).toBeNull();
    await expect(minh.c.breakGlass('BN001', 'ngắn')).rejects.toThrow();                     // lý do quá ngắn bị từ chối
    await minh.c.breakGlass('BN001', 'Benh nhan nguy kich, khoa NoiTiet khong lien lac duoc');
    expect((await minh.c.openRecord(rec))?.data).toMatchObject({ chanDoan: 'Viem phoi thuy duoi' });
    const bg = siemLines().filter((e) => e.type === 'BREAK_GLASS');
    expect(bg.length).toBeGreaterThanOrEqual(3);                                            // cả 3 nút đều ghi nhận
    expect(bg.every((e) => e.severity === 'CRITICAL' && e.subject === idx)).toBe(true);
    // tiếp đón không thể phá vỡ kính (không phải bác sĩ)
    await expect(mai.c.breakGlass('BN001', 'Toi muon xem ho so nay vi to mo')).rejects.toThrow();
  }, 240_000);

  it('đóng phá-vỡ-kính: hồ sơ được tự bọc lại; khoá BG cũ không còn mở được', async () => {
    const closed = await springAdmin('/api/admin/break-glass/close', { subject: idx });
    expect(closed.json.counter).toBe(1);
    const again = await hung.c.openRecord((await hung.c.listRecords('BN001'))[0]);
    expect(again?.rewrapped).toBe(true);                                                    // bác sĩ chủ quản mở → khoá được bọc lại
    const fresh = (await minh.c.listRecords('BN001'))[0];
    expect(await minh.c.policyOf(fresh)).toContain('MED:BG:' + idx + '#');
    expect(await minh.c.openRecord(fresh)).toBeNull();                                      // khoá BG cũ vô dụng, nút từ chối cấp khoá BG mới
    expect(fresh.envelope.ciphertext).toBe(rec.envelope.ciphertext);                        // dữ liệu mã hoá KHÔNG bị đụng tới
  }, 240_000);

  it('thu hồi quyền: nhân viên bị thu hồi mất khả năng đọc bản ghi đã được bọc lại', async () => {
    const id2 = await hung.c.saveRecord({ patientCode: 'BN002', type: 'lamsang', khoa: 'NoiTiet', data: { chanDoan: 'Tang huyet ap' } });
    const idx2 = hung.c.patientIdx('BN002');
    let r2 = (await hung.c.listRecords('BN002')).find((r) => r.id === id2)!;
    expect(await tuan.c.openRecord(r2)).not.toBeNull();                                     // trước khi thu hồi

    for (const org of ['BenhVien', 'SoYTe'] as const) {
      const r = await nodeAdminCall(org, '/admin/revoke', { gid: tuan.c.s.gid, attr: 'MED:Khoa:NoiTiet' });
      expect(r.status).toBe(200);
    }
    expect((await springAdmin('/api/admin/epochs/bump', { base: 'MED:Khoa:NoiTiet' })).json.counter).toBe(1);

    const viaHung = await hung.c.openRecord(r2);                                            // người còn quyền mở → bọc lại
    expect(viaHung?.rewrapped).toBe(true);
    r2 = (await hung.c.listRecords('BN002')).find((r) => r.id === id2)!;
    expect(await hung.c.policyOf(r2)).toContain('Khoa:NoiTiet#' + (await hung.c.epochs()).tag + '.1');
    expect(await tuan.c.openRecord(r2)).toBeNull();                                         // đã bị thu hồi: khoá cũ + nút từ chối khoá mới
    expect(idx2).not.toBe(idx);
    const types = siemLines().map((e) => e.type);
    expect(types).toContain('ATTR_REVOKED');
    expect(types).toContain('EPOCH_BUMPED');
  }, 360_000);

  it('ràng buộc thiết bị: kho khoá chép sang máy khác thì vô dụng', async () => {
    const sealed = await sealVault(hung.c.s, 'matkhau-manh-1', hung.dk, 1000);
    expect(JSON.stringify(sealed)).not.toContain(hung.c.s.gid);
    expect((await openVault<typeof hung.c.s>(sealed, 'matkhau-manh-1', hung.dk)).gid).toBe(hung.c.s.gid);
    const otherMachine = await loadOrCreateDeviceKeys(new MemoryKeyStore());
    await expect(openVault(sealed, 'matkhau-manh-1', otherMachine)).rejects.toThrow(/không thuộc về thiết bị/);
    await expect(openVault(sealed, 'sai-mat-khau-xx', hung.dk)).rejects.toThrow(/Sai passphrase/);
    // cùng khoá thiết bị không đăng ký lại được (chống nhân bản thiết bị)
    const inv = await springAdmin('/api/admin/invites', { name: 'Ke gia mao' });
    await expect(MedClient.register(S, inv.json.code, hung.dk)).rejects.toThrow(/đã đăng ký|da dang ky/);
  }, 120_000);

  it('giám sát: tráo phong bì giữa hai bản ghi bị phát hiện, gửi DECRYPT_FAIL; thiết bị bị khoá tự động sau ngưỡng', async () => {
    const a = await lan.c.saveRecord({ patientCode: 'BN010', type: 'lamsang', khoa: 'NgoaiKhoa', data: { x: 'A' } });
    const b = await lan.c.saveRecord({ patientCode: 'BN011', type: 'lamsang', khoa: 'NgoaiKhoa', data: { x: 'B' } });
    const ra = (await lan.c.listRecords('BN010')).find((r) => r.id === a)!;
    const rb = (await lan.c.listRecords('BN011')).find((r) => r.id === b)!;
    await expect(lan.c.openRecord({ ...ra, envelope: rb.envelope })).rejects.toThrow(/Giải mã thất bại/);   // máy chủ độc hại tráo dữ liệu

    for (let i = 0; i < FAIL_THRESHOLD; i++) await mai.c.report('DECRYPT_FAIL', 'WARN', 'thu nhieu lan voi khoa sai');
    const after = await api(S, `/api/records?patientIdx=${idx}`, { authorization: `Bearer ${mai.c.s.token}` });
    expect(after.status).toBe(401);                                                          // thiết bị bị khoá tự động
    const types = siemLines().map((e) => e.type);
    expect(types).toContain('DECRYPT_FAIL');
    expect(siemLines().find((e) => e.type === 'DEVICE_LOCKED')?.severity).toBe('CRITICAL');
    expect((await springAdmin('/api/admin/audit')).json.chain.ok).toBe(true);                // nhật ký quản trị toàn vẹn
    const cef = await fetch(`${S}/api/siem/events?format=cef`, { headers: { 'x-siem-token': 'siem-demo' } });
    expect(await cef.text()).toContain('CEF:0|MedABE|Storage|1.0|DEVICE_LOCKED');
  }, 240_000);

  it('PHỤ HUYNH tra cứu bằng CCCD + ngày sinh (không tài khoản, không mã); SỞ Y TẾ đọc bằng ABE; người lạ thì không', async () => {
    const nv = await person('Nhan vien KSK', { BenhVien: ['Role:TiepDon', 'Role:BacSi', 'Khoa:Nhi'], SoYTe: ['Role:TiepDon', 'Role:BacSi', 'Khoa:Nhi'] });
    await nv.c.saveRecord({ patientCode: 'HS-0901', type: 'hanhchinh', khoa: 'KSK', group: 'TRUONG-A', data: { hoTen: 'Nguyen Van An', cccd: 'HS-0901', ngaySinh: '2013-04-05', lop: '6A' } });
    await nv.c.saveRecord({ patientCode: 'HS-0901', type: 'lamsang', khoa: 'Nhi', data: { ketQua: 'Binh thuong' } });   // ngày sinh lấy từ mục hành chính
    await nv.c.saveRecord({ patientCode: 'HS-0902', type: 'hanhchinh', khoa: 'KSK', group: 'TRUONG-A', data: { hoTen: 'Tran Thi Binh', cccd: 'HS-0902', ngaySinh: '2013-11-20', lop: '6B' } });

    // Phụ huynh: chỉ cần CCCD + ngày sinh của con, gõ kiểu nào cũng được; không có tài khoản/khoá/mã nào.
    const items = await fetchForParent(S, ' hs-0901 ', '05/04/2013');
    expect(items.map((i) => i.type).sort()).toEqual(['hanhchinh', 'lamsang']);
    expect(JSON.stringify(items)).toContain('Nguyen Van An');
    expect(JSON.stringify(items)).not.toContain('Tran Thi Binh');            // không thấy con người khác
    expect(await fetchForParent(S, 'HS-0901', '2013-04-05')).toHaveLength(2);
    expect(await fetchForParent(S, 'HS-0902', '2013-11-20')).toHaveLength(1);
    // CCCD đúng nhưng sai ngày sinh / ngày sinh của em khác -> không có gì.
    expect(await fetchForParent(S, 'HS-0901', '2013-04-06')).toEqual([]);
    expect(await fetchForParent(S, 'HS-0901', '2013-11-20')).toEqual([]);
    await expect(fetchForParent(S, 'HS-0901', '')).rejects.toThrow(/ngày sinh/);
    await expect(fetchForParent(S, 'HS-0901', '31/02/2013')).rejects.toThrow(/ngày sinh/);   // ngày không có thật
    // Cập nhật gần thời gian thực: dấu vân tay đổi ngay khi nhân viên lưu thêm mục khám mới; phụ huynh thấy mục mới.
    const v1 = await parentVersion(S, 'HS-0902', '2013-11-20');
    await nv.c.saveRecord({ patientCode: 'HS-0902', type: 'thecuc', khoa: 'KSK', data: { chieuCao: '150', canNang: '40' } });
    const v2 = await parentVersion(S, 'HS-0902', '2013-11-20');
    expect(v2).not.toBe(v1);
    expect((await fetchForParent(S, 'HS-0902', '2013-11-20')).map((i) => i.type).sort()).toEqual(['hanhchinh', 'thecuc']);
    expect(await fetchForParent(S, '000000000000', '2013-11-20')).toEqual([]);              // CCCD không có trong hệ thống: không có gì

    // Máy nhân viên KHÁC (phiên mới, chưa nhớ ngày sinh) lưu mục khám: tự mở mục hành chính để lấy ngày sinh.
    const nv2 = await person('Nhan vien KSK 2', { BenhVien: ['Role:TiepDon', 'Role:BacSi', 'Khoa:Nhi'], SoYTe: ['Role:TiepDon', 'Role:BacSi', 'Khoa:Nhi'] });
    await nv2.c.saveRecord({ patientCode: 'HS-0901', type: 'thecuc', khoa: 'KSK', data: { chieuCao: '148', canNang: '39' } });
    expect((await fetchForParent(S, 'HS-0901', '2013-04-05')).map((i) => i.type).sort()).toEqual(['hanhchinh', 'lamsang', 'thecuc']);

    // Hồ sơ cũ thiếu ngày sinh -> chưa có đường tra cứu; bổ sung ngày sinh rồi "Cập nhật tra cứu phụ huynh" thì mục cũ cũng hiện ra.
    await nv.c.saveRecord({ patientCode: 'HS-0903', type: 'hanhchinh', khoa: 'KSK', group: 'TRUONG-B', data: { hoTen: 'Le Van Cu', cccd: 'HS-0903', lop: '6C' } });
    await nv.c.saveRecord({ patientCode: 'HS-0903', type: 'thecuc', khoa: 'KSK', group: 'TRUONG-B', data: { chieuCao: '140', canNang: '35' } });
    expect(await fetchForParent(S, 'HS-0903', '2013-01-02')).toEqual([]);
    await nv.c.saveRecord({ patientCode: 'HS-0903', type: 'hanhchinh', khoa: 'KSK', group: 'TRUONG-B', data: { hoTen: 'Le Van Cu', cccd: 'HS-0903', ngaySinh: '2013-01-02', lop: '6C' } });
    expect((await fetchForParent(S, 'HS-0903', '2013-01-02')).map((i) => i.type)).toEqual(['hanhchinh']);
    const ref = await nv2.c.refreshParentAccess('TRUONG-B');
    expect(ref.updated).toBeGreaterThanOrEqual(1);
    expect((await fetchForParent(S, 'HS-0903', '2013-01-02')).map((i) => i.type).sort()).toEqual(['hanhchinh', 'thecuc']);
    expect((await nv2.c.refreshParentAccess('TRUONG-B')).updated).toBe(0);                   // chạy lại: không còn gì phải làm
    // Máy chủ không thấy nội dung.
    const raw = JSON.stringify((await api(S, '/api/records?patientIdx=' + nv.c.patientIdx('HS-0901'), { authorization: `Bearer ${nv.c.s.token}` })).json);
    expect(raw).not.toContain('Nguyen Van An');

    // Sở Y tế: thuộc tính Org:SoYTe (do admin cấp) mở được mọi mục bằng ABE, không phụ thuộc vai trò/khoa.
    const so = await person('Can bo So Y te', { BenhVien: ['Org:SoYTe'], SoYTe: ['Org:SoYTe'] });
    const recs = await so.c.listRecords('HS-0901');
    const opened = await Promise.all(recs.map((r) => so.c.openRecord(r)));
    expect(opened.every((o) => o?.signatureValid)).toBe(true);
    expect(JSON.stringify(opened)).toContain('Binh thuong');
    // Người có vai trò nhưng không thuộc Sở và không phải tác giả: không đọc được lâm sàng khoa khác.
    const la = await person('Bs Mat', { BenhVien: ['Role:BacSi', 'Khoa:Mat'], SoYTe: ['Role:BacSi', 'Khoa:Mat'] });
    const ls = (await la.c.listRecords('HS-0901')).find((r) => r.type === 'lamsang')!;
    expect(await la.c.openRecord(ls)).toBeNull();
  }, 600_000);

  it('LIÊN THÔNG BỘ Y TẾ: gửi bản mã hoá lên cổng, nhận biên nhận có chữ ký; Bộ Y tế đọc bằng ABE; phụ huynh tra qua cổng; sửa sau khi gửi thì chưa liên thông', async () => {
    const nv = await person('Co so kham LT', { BenhVien: ['Role:TiepDon', 'Role:BacSi', 'Khoa:Nhi'], SoYTe: ['Role:TiepDon', 'Role:BacSi', 'Khoa:Nhi'] });
    const cccd = 'LT-001';
    await nv.c.saveRecord({ patientCode: cccd, type: 'hanhchinh', khoa: 'KSK', group: 'TRUONG-LT', data: { hoTen: 'Tran Van Lien Thong', cccd, ngaySinh: '2012-09-01', lop: '7A' } });
    await nv.c.saveRecord({ patientCode: cccd, type: 'thecuc', khoa: 'KSK', group: 'TRUONG-LT', data: { chieuCao: '160', canNang: '48' } });
    await nv.c.saveRecord({ patientCode: cccd, type: 'lamsang', khoa: 'Nhi', group: 'TRUONG-LT', data: { ketQua: 'Binh thuong' } });
    const rows = await nv.c.listRecords(cccd);
    expect(rows).toHaveLength(3);
    const ngaySinh = '01/09/2012';

    // Cấu hình cổng nằm trong cấu hình CÓ CHỮ KÝ registry của máy chủ; khoá công khai của cổng được ghim ở máy khách.
    expect((await nv.c.config()).byt).toMatchObject({ url: bytUrl });
    const info = await nv.c.bytInfo();
    expect(info.facilities.length).toBeGreaterThan(0);
    const ma = info.facilities[0].ma;

    // Trước khi gửi: chưa có biên nhận, phụ huynh tra qua Bộ Y tế chưa thấy gì (nhưng kho chính vẫn có).
    expect((await nv.c.bytStatus(rows.map((r) => r.id))).size).toBe(0);
    expect(await fetchForParent(bytUrl, cccd, ngaySinh)).toEqual([]);
    expect(await fetchForParent(S, cccd, ngaySinh)).toHaveLength(3);

    const sent = await nv.c.bytSubmit(rows, ma);
    expect(sent.rejected).toEqual([]);
    expect(sent.receipts.size).toBe(3);
    const receipt = [...sent.receipts.values()][0];
    expect(receipt.maCskcb).toBe(ma);
    expect((await nv.c.bytStatus(rows.map((r) => r.id))).size).toBe(3);
    const again = await nv.c.bytSubmit(rows, ma);                                                 // gửi lại: không sinh biên nhận mới
    expect([...again.receipts.values()].map((r) => r.receiptId).sort()).toEqual([...sent.receipts.values()].map((r) => r.receiptId).sort());

    // Bộ Y tế: tải ciphertext TỪ CỔNG rồi giải mã bằng ABE trên máy mình.
    const so = await person('Can bo BYT', { BenhVien: ['Org:SoYTe'], SoYTe: ['Org:SoYTe'] });
    const fromGw = await so.c.bytRecords({ patientCode: cccd });
    expect(fromGw).toHaveLength(3);
    expect(fromGw.every((r) => r.receipt)).toBe(true);
    const opened = await Promise.all(fromGw.map((r) => so.c.openRecord(r)));
    expect(opened.every((o) => o?.signatureValid)).toBe(true);
    expect(JSON.stringify(opened)).toContain('Tran Van Lien Thong');
    // Kẻ có thiết bị hợp lệ nhưng sai quyền: cổng vẫn trả ciphertext, nhưng không mở được lâm sàng Nhi.
    const mat = await person('Bs Mat LT', { BenhVien: ['Role:BacSi', 'Khoa:Mat'], SoYTe: ['Role:BacSi', 'Khoa:Mat'] });
    const ls = (await mat.c.bytRecords({ patientCode: cccd })).find((r) => r.type === 'lamsang')!;
    expect(await mat.c.openRecord(ls)).toBeNull();
    // Dữ liệu thô của cổng không chứa plaintext.
    const raw = JSON.stringify(fromGw);
    expect(raw).not.toContain('Tran Van Lien Thong');
    expect(raw).not.toContain('chieuCao');                                 // tên trường dữ liệu cũng không lộ

    // Danh sách theo đơn vị cũng lấy được từ cổng.
    const byGroup = await so.c.bytRecords({ group: 'TRUONG-LT', type: 'hanhchinh' });
    expect(byGroup).toHaveLength(1);
    expect((await so.c.bytStats()).facilities.find((f) => f.ma === ma)!.records).toBeGreaterThanOrEqual(3);

    // Phụ huynh tra cứu QUA BỘ Y TẾ: cùng đường giải mã, chỉ thấy phần đã liên thông.
    expect((await fetchForParent(bytUrl, cccd, ngaySinh)).map((i) => i.type).sort()).toEqual(['hanhchinh', 'lamsang', 'thecuc']);
    expect(await fetchForParent(bytUrl, cccd, '02/09/2012')).toEqual([]);

    // Sửa sau khi đã gửi: bản ghi mới chưa có biên nhận => "chưa liên thông" cho đến khi gửi lại.
    const newId = await nv.c.saveRecord({ patientCode: cccd, type: 'thecuc', khoa: 'KSK', group: 'TRUONG-LT', data: { chieuCao: '161', canNang: '49' } });
    const after = await nv.c.bytStatus([newId, ...rows.map((r) => r.id)]);
    expect(after.has(newId)).toBe(false);
    expect(after.size).toBe(3);
    // Biên nhận giả không được chấp nhận: sửa recordId thì chữ ký hỏng.
    const { verifyReceipt } = await import('./byt/receipt.js');
    expect(verifyReceipt((await nv.c.config()).byt!.pk, { ...receipt, recordId: newId })).toBe(false);
  }, 600_000);

  it('2-TRÊN-3: một nút chết vẫn cấp được khoá nhờ nút còn lại + duyệt trên điện thoại', async () => {
    nodeServers[0].close();
    nodeServers[0].closeAllConnections();                                                    // Bệnh viện "sập"
    const r = (await hung.c.listRecords('BN001'))[0];
    hung.c.s.keys = {};                                                                      // xoá cache để buộc xin lại khoá
    const approver = setInterval(async () => {                                              // "app điện thoại" duyệt yêu cầu
      const list = await api(nodeUrl.DienThoai, '/approvals', { 'x-approver-token': 'phone-demo' });
      for (const p of (list.json as unknown as { id: string }[]) ?? []) await api(nodeUrl.DienThoai, `/approvals/${p.id}`, { 'x-approver-token': 'phone-demo' }, {});
    }, 300);
    try {
      const out = await hung.c.openRecord(r);
      expect(out?.data).toMatchObject({ chanDoan: 'Viem phoi thuy duoi' });
    } finally {
      clearInterval(approver);
    }
  }, 240_000);

  it('một nút đơn lẻ không thể tự cấp khoá (cần đồng thuận)', async () => {
    // Kẻ chiếm SoYTe tự xin 'partials' cho thuộc tính mình không được cấp: bị từ chối.
    const gc = await nodeAdminCall('SoYTe', '/admin/grants', { name: 'x', attrs: ['Role:TiepDon'] });
    expect(gc.json.code).toBeTruthy();
    const dir = await hung.c.epochs();
    const r = await api(nodeUrl.SoYTe, '/partials', { authorization: `Bearer ${hung.c.s.nodes.find((n) => n.org === 'SoYTe')!.token}` }, { attrs: [`MED:Role:TiepDon#${dir.tag}.0`] });
    expect(Object.keys(r.json.partials)).toHaveLength(0);
    expect(Object.keys(r.json.denied)).toHaveLength(1);
  }, 120_000);
});
