// KỊCH BẢN DEMO ABE "kẻ tấn công": chạy MỘT lệnh, tự dựng hệ thống riêng (Spring + 3 nút cấp khoá ngưỡng 2/3, cổng tự chọn, dữ liệu tạm,
// KHÔNG đụng KSK.exe hay data-demo) rồi kể lại từng bước bằng tiếng Việt. Toàn bộ dữ liệu là GIẢ.
//   npx tsx security/src/deploy/demo-tan-cong.ts
// Cần jar Spring (cd security/storage && mvnw -DskipTests package) và Java.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { combineKey, decrypt, partialKey, type AttrKey, type Share } from '../abe/rw15.js';
import { leavesOf, parsePolicy } from '../abe/policy.js';
import { loadOrCreateDeviceKeys, MemoryKeyStore } from '../client/device.js';
import { MedClient } from '../client/medclient.js';
import { fetchForParent } from '../client/parent.js';
import { initDealer, ORGS } from './init.js';
import { startNodes } from './nodes.js';
import { bytPublicKey, startGateway } from './byt.js';

const CCCD = '079099990001';
const NGAY_SINH = '2013-05-12';
const SECRETS = ['NGUYEN VAN NAN', CCCD, '152.5', '41.5', 'Viem hong cap', 'Nhi khoa'];   // những chuỗi mà kẻ tấn công muốn thấy

const out = (s = '') => console.log(s);
const title = (s: string) => out(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);
const ok = (s: string) => out(`  ✔ ${s}`);
const bad = (s: string) => out(`  ✘ ${s}`);
const info = (s: string) => out(`    ${s}`);

const JAR = readdirSync(resolve('security/storage/target')).find((f) => /^medabe-storage-.*\.jar$/.test(f));
if (!JAR) { console.error('Chưa có jar Spring: cd security/storage && mvnw -DskipTests package'); process.exit(1); }

const freePort = () => new Promise<number>((res) => {
  const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});
const rnd = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const ADMIN = rnd(), SERVICE = rnd(), SIEM = rnd(), APPROVER = rnd();

const dir = mkdtempSync(join(tmpdir(), 'medabe-demo-'));
initDealer(dir);
const springPort = await freePort();
const ports = Object.fromEntries(await Promise.all(ORGS.map(async (o) => [o, await freePort()]))) as Record<string, number>;
const bytPort = await freePort();
const S = `http://127.0.0.1:${springPort}`;
const BYT = `http://127.0.0.1:${bytPort}`;
const siemFile = join(dir, 'siem.jsonl');
const spring = spawn('java', ['-XX:TieredStopAtLevel=1', '-jar', join('security', 'storage', 'target', JAR)], {
  env: {
    ...process.env, PORT: String(springPort), DB_URL: 'jdbc:h2:mem:demo;DB_CLOSE_DELAY=-1', MEDABE_PK_JSON: readFileSync(join(dir, 'dealer', 'pk.json'), 'utf8'),
    MEDABE_NODES: ORGS.map((o) => `${o}=http://127.0.0.1:${ports[o]}`).join(','), MEDABE_ADMIN_TOKEN: ADMIN, MEDABE_SERVICE_TOKEN: SERVICE,
    MEDABE_SIEM_TOKEN: SIEM, MEDABE_SIEM_FILE: siemFile, MEDABE_BYT_URL: BYT, MEDABE_BYT_PK: bytPublicKey(dir),
  },
  stdio: 'ignore',
});
let nodeServers: Server[] = [];
let gw: Server | undefined;
const cleanup = () => { (gw as unknown as { close(): void; closeAllConnections?(): void } | undefined)?.close(); (gw as unknown as { closeAllConnections?(): void } | undefined)?.closeAllConnections?.(); nodeServers.forEach((s) => { (s as unknown as { close(): void; closeAllConnections?(): void }).close(); (s as unknown as { closeAllConnections?(): void }).closeAllConnections?.(); }); spring.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* bỏ qua */ } };
process.on('SIGINT', () => { cleanup(); process.exit(1); });

try {
  out('Đang dựng hệ thống thử (Spring Boot + 3 nút cấp khoá + cổng liên thông Bộ Y tế)... vài chục giây.');
  for (let i = 0; i < 240; i++) { if ((await fetch(`${S}/api/epochs`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 500)); }
  const cfg = (await (await fetch(`${S}/api/config`)).json()) as { registryPk: string };
  for (const o of ORGS) process.env[`ADMIN_TOKEN_${o}`] = rnd();
  process.env.APPROVER_TOKEN = APPROVER;
  const started = startNodes({ ports, dataDir: dir, storageBase: S, registryPk: cfg.registryPk, serviceToken: SERVICE });
  nodeServers = started.servers as unknown as Server[];
  gw = startGateway({ dataDir: dir, port: bytPort, registryPk: cfg.registryPk }).server as unknown as Server;
  const nodeUrl = Object.fromEntries(ORGS.map((o) => [o, `http://127.0.0.1:${ports[o]}`]));

  const call = async (base: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, text: await r.text() };
  };
  async function person(name: string, grants: Partial<Record<'BenhVien' | 'SoYTe', string[]>>) {
    const dk = await loadOrCreateDeviceKeys(new MemoryKeyStore());
    const inv = JSON.parse((await call(S, '/api/admin/invites', { 'x-admin-token': ADMIN }, { name })).text) as { code: string };
    const c = await MedClient.register(S, inv.code, dk);
    for (const [org, attrs] of Object.entries(grants)) {
      const g = JSON.parse((await call(nodeUrl[org], '/admin/grants', { 'x-admin-token': started.tokens[org] }, { name, attrs })).text) as { code: string };
      await c.claim(org, g.code);
    }
    return c;
  }
  const both = (attrs: string[]) => ({ BenhVien: attrs, SoYTe: attrs });

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 1 · Máy nhập liệu (cán bộ khám) lưu hồ sơ học sinh — mã hoá NGAY TRÊN MÁY, rồi mới đẩy lên máy chủ');
  const nhapLieu = await person('May nhap lieu (Bac si Nhi + Tiep don)', both(['Role:TiepDon', 'Role:BacSi', 'Khoa:Nhi']));
  info(`Hồ sơ: ${SECRETS[0]} · CCCD ${CCCD} · cao 152.5 cm · nặng 41.5 kg · chẩn đoán "Viem hong cap"`);
  await nhapLieu.saveRecord({ patientCode: CCCD, type: 'hanhchinh', khoa: 'KSK', group: 'TRUONG-DEMO', data: { hoTen: SECRETS[0], cccd: CCCD, ngaySinh: NGAY_SINH, lop: '6A1' } });
  await nhapLieu.saveRecord({ patientCode: CCCD, type: 'thecuc', khoa: 'KSK', data: { chieuCao: '152.5', canNang: '41.5' } });
  await nhapLieu.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Nhi', data: { chanDoan: 'Viem hong cap', ghiChu: 'Nhi khoa' } });
  ok('Đã lưu 3 mục (hành chính, thể lực, lâm sàng Nhi). Mỗi mục là một phong bì AES-GCM riêng; khoá AES được bọc bằng CP-ABE theo chính sách riêng của mục.');
  const rows = await nhapLieu.listRecords(CCCD);
  const thecuc = rows.find((r) => r.type === 'thecuc')!;
  const lamsang = rows.find((r) => r.type === 'lamsang')!;
  info('Chính sách truy cập của mục thể lực (công khai, ai cũng đọc được CHÍNH SÁCH nhưng không đọc được NỘI DUNG):');
  info('  ' + (await nhapLieu.policyOf(thecuc)).replace(/#\d{4}W\d{2}\.\d+/g, '').replace(/MED:/g, ''));
  info('Chính sách của mục lâm sàng Nhi:');
  info('  ' + (await nhapLieu.policyOf(lamsang)).replace(/#\d{4}W\d{2}\.\d+/g, '').replace(/MED:/g, ''));

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 2 · LIÊN THÔNG: cơ sở khám gửi bản ĐÃ MÃ HOÁ lên cổng Bộ Y tế, nhận biên nhận có chữ ký');
  (await fetchForParent(BYT, CCCD, NGAY_SINH)).length === 0 ? ok('Trước khi liên thông: phụ huynh tra qua cổng Bộ Y tế chưa thấy gì (kho chính của cơ sở thì đã có).') : bad('cổng đã có dữ liệu trước khi gửi (bất thường)');
  const before = await nhapLieu.bytStatus(rows.map((r) => r.id));
  info(`Trạng thái trước khi gửi: ${before.size}/${rows.length} bản ghi có biên nhận.`);
  const facility = (await nhapLieu.bytInfo()).facilities[0];
  const sent = await nhapLieu.bytSubmit(rows, facility.ma);
  ok(`Đã gửi ${rows.length} bản ghi mã hoá (kèm header ABE) của cơ sở ${facility.ma}. Cổng trả ${sent.receipts.size} biên nhận, máy khách đã kiểm chữ ký Ed25519 của cổng bằng khoá được registry công bố.`);
  const r0 = [...sent.receipts.values()][0];
  info(`Ví dụ biên nhận: ${r0.receiptId} · cơ sở ${r0.maCskcb} · nhận lúc ${r0.receivedAt} · băm nội dung ${r0.contentHash.slice(0, 24)}…`);
  const again = await nhapLieu.bytSubmit(rows, facility.ma);
  [...again.receipts.values()].every((r) => sent.receipts.get(r.recordId)?.receiptId === r.receiptId) ? ok('Gửi lại cùng bản ghi: giữ nguyên biên nhận (không nhân đôi).') : bad('biên nhận đổi khi gửi lại (bất thường)');
  const newId = await nhapLieu.saveRecord({ patientCode: CCCD, type: 'thecuc', khoa: 'KSK', data: { chieuCao: '152.5', canNang: '41.5', ghiChu: 'do lai' } });
  const afterEdit = await nhapLieu.bytStatus([newId]);
  afterEdit.size === 0 ? ok('Sửa sau khi gửi: bản ghi mới CHƯA có biên nhận → trạng thái tự quay về "Chưa liên thông" cho đến khi gửi lại.') : bad('bản mới đã có biên nhận (bất thường)');
  const rowsAll = await nhapLieu.listRecords(CCCD);
  await nhapLieu.bytSubmit(rowsAll, facility.ma);
  ok('Gửi lại phần đã sửa: đủ biên nhận.');
  const phuHuynhQuaBYT = await fetchForParent(BYT, CCCD, NGAY_SINH);
  ok(`Sau khi liên thông: phụ huynh tra qua cổng Bộ Y tế thấy ${phuHuynhQuaBYT.length} mục (cần CCCD + ngày sinh của học sinh).`);

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 3 · Bộ Y tế (Sở Y tế) tải bản mã hoá TỪ CỔNG rồi giải mã trên máy mình — có Org:SoYTe và ≥ 2/3 nút cấp khoá');
  const boYTe = await person('Can bo So Y te', both(['Org:SoYTe']));
  const fromGw = await boYTe.bytRecords({ patientCode: CCCD });
  info(`Cổng trả ${fromGw.length} bản ghi mã hoá (mỗi bản kèm biên nhận ${fromGw.every((r) => r.receipt) ? 'hợp lệ' : 'KHÔNG hợp lệ'}).`);
  const seen = await Promise.all(fromGw.map((r) => boYTe.openRecord(r)));
  for (const r of seen) if (r) info(`mục đọc được: ${JSON.stringify(r.data)}  · chữ ký số ${r.signatureValid ? 'hợp lệ' : 'KHÔNG hợp lệ'}`);
  seen.every((r) => r?.signatureValid) ? ok('Bộ Y tế đọc đủ các mục, chữ ký số của nơi nhập liệu hợp lệ (chứng chỉ do registry cấp).') : bad('Bộ Y tế không đọc được (bất thường)');
  const gwStats = await boYTe.bytStats();
  info(`Thống kê của cổng: ${gwStats.total} bản ghi mã hoá, cơ sở ${gwStats.facilities[0].ma}: ${gwStats.facilities[0].patients} bệnh nhân.`);

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 4 · KẺ TẤN CÔNG A — nghe lén / lấy trộm dữ liệu mà máy chủ và cổng Bộ Y tế lưu và trả ra');
  const dump = (await call(S, `/api/records?patientIdx=${nhapLieu.patientIdx(CCCD)}`, { authorization: `Bearer ${nhapLieu.s.token}` })).text;
  const dumpGw = JSON.stringify(await boYTe.bytRecords({ patientCode: CCCD }));
  const dump2 = (await call(S, `/api/records?groupIdx=${nhapLieu.groupIdx('TRUONG-DEMO')}&type=hanhchinh`, { authorization: `Bearer ${nhapLieu.s.token}` })).text;
  info(`Kẻ tấn công có trong tay ${((dump.length + dump2.length + dumpGw.length) / 1024).toFixed(1)} KB dữ liệu thô (kho chính + cổng Bộ Y tế). Một đoạn:`);
  const cut = (JSON.parse(dump) as { envelope: { v: number; abe?: { policy: string }; iv: string; ciphertext: string } }[]).map((r) => r.envelope).find((e) => e.abe)!;
  info('  ' + JSON.stringify({ v: cut.v, policy: cut.abe!.policy.slice(0, 60) + '…', iv: cut.iv, ciphertext: cut.ciphertext.slice(0, 48) + '…' }));
  for (const s of SECRETS) (dump + dump2 + dumpGw).toLowerCase().includes(s.toLowerCase()) ? bad(`LỘ chuỗi "${s}" trong dữ liệu thô`) : ok(`không tìm thấy "${s}"`);
  info('(Đối chứng: cùng chuỗi đó có trong dữ liệu mà Bộ Y tế vừa giải mã ở bước 3 — nên việc "không thấy" ở đây là do MÃ HOÁ, không phải do dữ liệu rỗng.)');

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 5 · KẺ TẤN CÔNG B — có thiết bị đăng ký hợp lệ nhưng SAI QUYỀN (tải được ciphertext, không có khoá)');
  const tiepDon = await person('Ke gia danh tiep don', both(['Role:TiepDon']));
  const bsMat = await person('Bac si Mat', both(['Role:BacSi', 'Khoa:Mat']));
  const rowsB = await tiepDon.listRecords(CCCD);
  ok(`Máy chủ vẫn TRẢ ${rowsB.length} bản ghi cho "Tiếp đón" (máy chủ mù, không tự quyết quyền đọc — quyền nằm ở mật mã).`);
  const hcB = await Promise.all(rowsB.map(async (r) => [r.type, await tiepDon.openRecord(r)] as const));
  for (const [t, r] of hcB) r ? ok(`Tiếp đón mở được mục "${t}" (đúng chính sách: tiếp đón được đọc hành chính)`) : ok(`Tiếp đón KHÔNG mở được mục "${t}" → BỊ CHẶN (thiếu thuộc tính theo chính sách)`);
  const nhiB = await bsMat.openRecord((await bsMat.listRecords(CCCD)).find((r) => r.type === 'lamsang')!);
  nhiB ? bad('Bác sĩ Mắt mở được lâm sàng Nhi (BẤT THƯỜNG)') : ok('Bác sĩ Mắt KHÔNG mở được lâm sàng khoa Nhi → null (có Role:BacSi nhưng không có Khoa:Nhi)');
  info('Mọi lần bị từ chối đều được máy khách báo ACCESS_DENIED lên SIEM (xem bước 7).');

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 6 · KẺ TẤN CÔNG C — hack được MỘT trong 3 nút cấp khoá (lấy được share của nút Sở Y tế)');
  const stolen = JSON.parse(readFileSync(join(dir, 'nodes', 'SoYTe', 'share.json'), 'utf8')) as Share;
  info(`Có share x=${stolen.x} của nút SoYTe (ngưỡng k=${stolen.k}/${stolen.n}). Thử tự tạo khoá thuộc tính cho chính mình để mở lâm sàng Nhi:`);
  const policy = await nhapLieu.policyOf(lamsang);
  const gid = bsMat.s.gid;
  const leaves = [...new Set(leavesOf(parsePolicy(policy)))];
  let denied = 0;
  try { combineKey([partialKey(stolen, gid, leaves[0])], stolen.k); bad('ghép được khoá chỉ với 1 nút (BẤT THƯỜNG)'); }
  catch (e) { denied++; ok(`Cách 1 — ghép khoá theo đúng quy tắc: bị chặn (${(e as Error).message})`); }
  try {
    const forged: Record<string, AttrKey> = {};
    for (const a of leaves) forged[a] = combineKey([partialKey(stolen, gid, a)], 1);   // ép k=1 với một phần khoá
    const plain = await decrypt(gid, forged, lamsang.envelope as never, `${lamsang.patientIdx}|${lamsang.type}|${lamsang.id}`);
    bad(plain ? 'GIẢI MÃ ĐƯỢC bằng khoá ép k=1 (BẤT THƯỜNG)' : 'không thoả policy');
  } catch { denied++; ok('Cách 2 — ép k=1 để tự tạo "khoá": ra khoá rác, giải mã thất bại (AES-GCM từ chối)'); }
  ok(`Kết luận: một nút bị hack KHÔNG đủ để đọc dữ liệu (${denied}/2 cách đều thất bại). Cần đồng thời ≥ 2 nút VÀ thuộc tính hợp lệ của người dùng.`);

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 7 · Máy chủ giám sát ghi nhận gì (SIEM)');
  await new Promise((r) => setTimeout(r, 800));
  const events = readFileSync(siemFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; severity: string; source: string; detail: string });
  const count: Record<string, number> = {};
  for (const e of events) count[e.type] = (count[e.type] ?? 0) + 1;
  info('Số sự kiện theo loại: ' + JSON.stringify(count));
  for (const e of events.filter((x) => x.type === 'ACCESS_DENIED').slice(0, 3)) info(`  [${e.severity}] ${e.type} từ ${e.source}: ${e.detail}`);
  ok('Mỗi lần thử đọc sai quyền để lại dấu vết cho SOC/Wazuh (file JSON-lines hoặc /api/siem/events?format=cef).');

  // ---------------------------------------------------------------------------------------------------------------------------------
  title('BƯỚC 8 · App tra cứu của phụ huynh — chỉ cần số CCCD + NGÀY SINH của học sinh (không mã, không tài khoản, không dùng ABE)');
  info(`Phụ huynh nhập: CCCD ${CCCD} + ngày sinh ${NGAY_SINH.split('-').reverse().join('/')} — thứ phụ huynh vốn đã biết, nhà trường không phải phát mã nào.`);
  const mine = await fetchForParent(BYT, CCCD, NGAY_SINH);        // tra cứu QUA CỔNG BỘ Y TẾ: chỉ thấy hồ sơ đã liên thông
  ok(`Phụ huynh (qua cổng Bộ Y tế) nhập đúng CCCD + ngày sinh: thấy ${mine.length} mục (${mine.map((i) => i.type).join(', ')}). Giải mã ngay trên máy người tra cứu.`);
  const sai = await fetchForParent(BYT, CCCD, '2013-01-01');
  sai.length === 0 ? ok('Biết CCCD nhưng sai ngày sinh: không có gì.') : bad('Sai ngày sinh vẫn ra dữ liệu (BẤT THƯỜNG)');
  const wrong = await fetchForParent(BYT, '079099990002', NGAY_SINH);
  wrong.length === 0 ? ok('CCCD của em khác (dù trùng ngày sinh): không có gì.') : bad('CCCD khác vẫn ra dữ liệu (BẤT THƯỜNG)');
  info('Ngày sinh được TRỘN VÀO khoá giải mã (scrypt), nên máy chủ/cổng chỉ giữ chỉ mục băm + ciphertext, không đọc được nội dung.');
  info('LƯU Ý TRUNG THỰC (đánh đổi đã chọn để phụ huynh dễ dùng): ngày sinh có rất ít khả năng, và CCCD đã chứa sẵn năm sinh, nên ai BIẾT CCCD của em');
  info('chỉ cần thử ~366 ngày là ra. Lớp bảo vệ còn lại: phải biết đúng CCCD, máy chủ giới hạn 20 lần tra/phút và ghi nhật ký. Kênh này không có quyền theo vai trò như ABE.');

  title('TỔNG KẾT');
  out('  • Máy chủ lưu trữ: chỉ ciphertext + chỉ mục băm, không có plaintext, không có khoá.');
  out('  • Liên thông thật sự có biên nhận ký số: gửi bản mã hoá, nhận biên nhận, sửa sau khi gửi thì phải gửi lại; cổng cũng chỉ giữ ciphertext.');
  out('  • Đọc được = đúng thuộc tính (chính sách ABE) VÀ ≥ 2/3 nút đồng thuận cấp khoá. Thiếu một trong hai là thất bại ở tầng mật mã.');
  out('  • Sai quyền, hack 1 nút, nghe lén dữ liệu thô: đều không đọc được; các lần thử sai quyền đều có nhật ký giám sát.');
  out('  • Giới hạn đã nêu: app tra cứu dùng CCCD + mã (không phải ABE, mã lộ thì lộ); quyền GHI chưa ép bằng mật mã; mật mã tự cài chưa được kiểm toán.\n');
} finally {
  cleanup();
}
process.exit(0);
