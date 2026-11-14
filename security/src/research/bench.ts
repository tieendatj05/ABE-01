// Đo CHI PHÍ BỔ SUNG của ABE so với nền (BASELINE) trên cùng hệ thống, cùng tài khoản/dữ liệu giả/giao diện.
//   npm run research:bench      → in bảng + ghi NGHIEN_CUU_CPABE/benchmark-result.json
// Điều kiện đo (ghi vào kết quả): một máy, loopback (độ trễ mạng ≈ 0), Spring + 3 nút + máy khách cùng máy, PBKDF2 600.000 vòng.
// Vì thế số đo phản ánh chi phí TÍNH TOÁN + số lượt gọi, KHÔNG phản ánh độ trễ mạng thật của bệnh viện.
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { DEMO_USERS, startResearchStack } from '../deploy/research-stack.js';
import { ResearchClient, type Mode, type SectionKey } from './client.js';
import { fakePatients } from './fake-data.js';
import { MemoryDeviceKeyStore } from './keys.js';

const pw = (u: string) => DEMO_USERS.find((x) => x.username === u)!.password;
const N = Number(process.env.BENCH_N ?? 12);

interface Stat { n: number; medianMs: number; p95Ms: number; minMs: number; maxMs: number }
const stat = (xs: number[]): Stat => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), minMs: +s[0].toFixed(1), maxMs: +s[s.length - 1].toFixed(1) };
};
async function sample<T>(n: number, fn: (i: number) => Promise<T>): Promise<Stat> {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); await fn(i); xs.push(performance.now() - t); }
  return stat(xs);
}

const stack = await startResearchStack({ passwordIterations: 600_000 });
const counters = { requests: 0, sent: 0, received: 0 };
const counting: typeof fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
  counters.requests++; if (typeof init?.body === 'string') counters.sent += Buffer.byteLength(init.body);
  const r = await stack.fetch(i, init);
  const b = Buffer.from(await r.clone().arrayBuffer()); counters.received += b.length;
  return r;
}) as typeof fetch;
const mk = (store = new MemoryDeviceKeyStore()) => new ResearchClient({ baseUrl: stack.baseUrl, fetch: counting, store, pin: { registryPk: stack.registryPk, abePkSha256: stack.abePkSha256 } });
const reset = () => { counters.requests = 0; counters.sent = 0; counters.received = 0; };
const snap = () => ({ requests: counters.requests, bytesSent: counters.sent, bytesReceived: counters.received });

const out: Record<string, unknown> = {};
try {
  const td = mk(), nhi = mk(), bsm = mk();
  await td.signIn('tiepdon01', pw('tiepdon01')); await nhi.signIn('bsnhi01', pw('bsnhi01')); await bsm.signIn('bsmat01', pw('bsmat01'));
  const P = fakePatients(N * 10 + 120, 777);
  let cursor = 0; const next = () => P[cursor++];

  // ---- đăng nhập (không phụ thuộc chế độ: nền dùng chung) ----
  out.login_steady_state = await sample(5, async () => { await nhi.signOut(); await nhi.signIn('bsnhi01', pw('bsnhi01')); });      // đã có khoá ký: thách thức nonce + PBKDF2 + chứng minh khoá
  out.login_new_device = await sample(3, async () => mk().signIn('bsmat01', pw('bsmat01')));
  await nhi.signIn('bsnhi01', pw('bsnhi01'));

  // ---- khởi động nguội (cấu hình, policy, JIT) ----
  for (const mode of ['baseline', 'abe'] as Mode[]) { const p = next(); await td.saveSection(mode, { patientCode: p.code, section: 'hanhchinh', data: p.hanhchinh }); await td.readPatient(mode, p.code); }

  // ---- ghi 1 mục ----
  const write = async (c: ResearchClient, mode: Mode, section: SectionKey) => sample(N, async () => { const p = next(); await c.saveSection(mode, { patientCode: p.code, section, data: section === 'hanhchinh' ? p.hanhchinh : p.lamsangNhi }); });
  out.write_hanhchinh = { baseline: await write(td, 'baseline', 'hanhchinh'), abe: await write(td, 'abe', 'hanhchinh') };
  out.write_lamsang_nhi = { baseline: await write(nhi, 'baseline', 'lamsang.Nhi'), abe: await write(nhi, 'abe', 'lamsang.Nhi') };

  // ---- đọc 1 mục lâm sàng (chuẩn bị bệnh nhân đã có dữ liệu) ----
  const readable = [] as typeof P;
  for (let i = 0; i < N; i++) { const p = next(); readable.push(p); for (const mode of ['baseline', 'abe'] as Mode[]) { await td.saveSection(mode, { patientCode: p.code, section: 'hanhchinh', data: p.hanhchinh }); await nhi.saveSection(mode, { patientCode: p.code, section: 'lamsang.Nhi', data: p.lamsangNhi }); } }
  const readWarm = async (mode: Mode) => sample(N, async (i) => { await nhi.readPatient(mode, readable[i].code); });
  await nhi.readPatient('abe', readable[0].code);                       // làm nóng khoá
  out.read_warm_keys = { baseline: await readWarm('baseline'), abe: await readWarm('abe') };

  // ---- đọc "nguội": máy khách mới đăng nhập, CHƯA có khoá ----
  const second = new MemoryDeviceKeyStore();                          // một máy khác của cùng bác sĩ (đăng ký thiết bị đúng MỘT lần; tối đa 5 thiết bị/người)
  const coldStat = async (mode: Mode) => {
    const xs: number[] = [];
    for (let i = 0; i < 5; i++) { const c = mk(second); await c.signIn('bsnhi01', pw('bsnhi01')); const t = performance.now(); await c.readPatient(mode, readable[i].code); xs.push(performance.now() - t); await c.signOut(); }
    return stat(xs);
  };
  out.read_cold_keys = { baseline: await coldStat('baseline'), abe: await coldStat('abe') };

  // ---- chỉ riêng xin khoá (vé + 3 nút + ghép khoá ≥2/3) ----
  const keyXs: number[] = [];
  for (let i = 0; i < 5; i++) { const c = mk(second); await c.signIn('bsnhi01', pw('bsnhi01')); const dir = await c.epochs(); const t = performance.now(); await c.ensureKeys([`MED:Role:BacSi#${dir.tag}.0`, `MED:Khoa:Nhi#${dir.tag}.0`]); keyXs.push(performance.now() - t); await c.signOut(); }
  out.key_acquisition_only = stat(keyXs);                                // vé + 3 nút (song song) + ghép khoá từ >=2 nút

  // ---- số lượt gọi mạng và byte cho 1 lần đọc mục lâm sàng ----
  const callsFor = async (c: ResearchClient, mode: Mode, p: (typeof P)[number]) => { reset(); await c.readPatient(mode, p.code); return snap(); };
  const coldClient = mk(); await coldClient.signIn('bsnhi01', pw('bsnhi01'));
  const warm = await callsFor(nhi, 'abe', readable[1]);
  out.requests_per_read = { baseline: await callsFor(nhi, 'baseline', readable[1]), abe_warm_keys: warm, abe_cold_keys: await callsFor(coldClient, 'abe', readable[2]) };

  // ---- import hàng loạt ----
  const batch = fakePatients(100, 4242).map((p) => ({ patientCode: p.code, section: 'hanhchinh' as const, data: p.hanhchinh }));
  const imp = async (mode: Mode, offset: number) => { const t = performance.now(); await td.importMany(mode, batch.map((b, i) => ({ ...b, patientCode: `${b.patientCode}-${mode}-${offset}-${i}` }))); return +(performance.now() - t).toFixed(0); };
  out.import_100_hanhchinh_ms = { baseline: await imp('baseline', 1), abe: await imp('abe', 1) };

  // ---- kích thước lưu trữ ----
  const raw = async (mode: string) => (await (await stack.fetch(`${stack.baseUrl}/api/v2/evidence/raw?mode=${mode}`, { headers: { 'x-service-token': stack.serviceToken } })).json()) as Record<string, string | null>[];
  const plainLen = (t: string) => Buffer.byteLength(JSON.stringify(t === 'hanhchinh' ? P[0].hanhchinh : P[0].lamsangNhi));
  const sizes: Record<string, unknown> = {};
  const bRows = await raw('BASELINE'), aRows = await raw('ABE');
  for (const type of ['hanhchinh', 'lamsang']) {
    const b = bRows.find((r) => r.type === type)!, a = aRows.find((r) => r.type === type)!;
    sizes[type] = {
      plaintextBytes: plainLen(type),
      baselineStoredBytes: (b.baselineCt!.length + b.baselineWrappedDek!.length) / 2,        // ciphertext+tag + DEK bọc (hex → byte)
      abeStoredBytes: Buffer.byteLength(a.payload!),                                           // phong bì JSON (header ABE + DEK bọc + ciphertext)
    };
  }
  out.storage_size_per_record = sizes;

  out.environment = {
    cpu: cpus()[0]?.model, cores: cpus().length, ramGB: +(totalmem() / 2 ** 30).toFixed(1), os: `${platform()} ${release()}`, node: process.version,
    note: 'Một máy, loopback, mọi thành phần cùng máy: số đo là chi phí tính toán + số lượt gọi, KHÔNG gồm độ trễ mạng thật.',
    samplesPerCell: N, pbkdf2Iterations: 600000, k: 2, nodes: 3, abeCurve: 'BLS12-381 (@noble/curves, JS thuần)',
  };
  out.generatedAt = new Date().toISOString();

  mkdirSync(resolve('NGHIEN_CUU_CPABE'), { recursive: true });
  writeFileSync(join('NGHIEN_CUU_CPABE', 'benchmark-result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("BENCH FAILED:", e);
  process.exitCode = 1;
} finally {
  await stack.stop();
  process.exit(process.exitCode ?? 0);
}
