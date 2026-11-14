// THỰC NGHIỆM KỊCH BẢN ẢNH CHIA THEO KHOA: cùng MỘT ảnh 5 vùng (Mắt / Tai-Mũi-Họng x3 / Răng-Hàm-Mặt) + ảnh gốc, ba cách bảo vệ, bốn mô hình kẻ tấn công. HỒ SƠ GIẢ.
//   ABE : app thật (CP-ABE từng vùng, khoá cấp theo thuộc tính, ba nút cấp khoá ngưỡng 2/3).
//   B0  : đối chứng "thông thường": mã hoá khi lưu bằng KHOÁ MÁY CHỦ (KEK) + kiểm quyền theo khoa ở API (máy chủ tự giải mã khi trả).
//   B1  : đối chứng MẠNH: mã hoá phong bì, mỗi khoa một KHOÁ NHÓM do một KMS riêng phát cho đúng bác sĩ khoa đó (DEK của vùng được bọc bằng khoá nhóm các khoa được phép).
// B0/B1 là mô phỏng TRONG TIẾN TRÌNH bằng AES-256-GCM (WebCrypto) với CÙNG ảnh, CÙNG danh sách khoa được phép cho từng vùng, CÙNG ai-là-bác-sĩ-khoa-nào; chỉ so cơ chế bảo vệ,
// KHÔNG gồm độ trễ mạng/KMS thật (ghi rõ trong báo cáo). Kết quả ghi ra .test-runs/abe-thuc-nghiem/anh-doi-chung.json.
//   Mô hình tấn công: A1 chỉ có CSDL | A2 CSDL + khoá phía máy chủ | A3 CSDL + tài khoản bác sĩ SAI khoa | A4 CSDL + chiếm KMS/khoá nhóm.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decrypt, type Envelope } from '../abe/rw15.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { encodePng, makePhantom } from '../research/fake-image.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { listImages, openImage, saveImage } from './imaging.js';
import { MedClient, type RecordRow } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [A] = fakePatients(1, 4711);
const CCCD = A.hanhchinh.cccd;
let S: ResearchStack;
const login = (u: string) => MedClient.signIn(S.baseUrl, u, pw(u), new MemoryDeviceKeyStore(), { fetch: S.fetch });
const result: Record<string, unknown> = { cauHinh: { node: process.version, ghi: 'máy chủ thử cục bộ; B0/B1 mô phỏng trong tiến trình (AES-256-GCM), không gồm độ trễ mạng' } };

/** 5 vùng của ảnh mẫu và khoa được phép (chính sách nghiệp vụ như app thật). */
const KHOA = { mat: ['Mat'], tmhA: ['TMH'], tmhB: ['TMH'], tmhC: ['TMH'], rhm: ['RHM'] } as const;
const DOCTORS = { bsmat01: 'Mat', bstmh01: 'TMH', bsrhm01: 'RHM', bsnhi01: 'Nhi' } as const;
type Region = keyof typeof KHOA;
const PIXELS = makePhantom(0);
const W = PIXELS.w, H = PIXELS.h;
const RECT: Record<Region, { x: number; y: number; w: number; h: number }> = {
  mat: { x: 0, y: 0, w: W, h: 16 }, tmhA: { x: 0, y: 16, w: 24, h: 32 }, tmhB: { x: W - 24, y: 16, w: 24, h: 32 }, tmhC: { x: 36, y: 16, w: 24, h: 24 }, rhm: { x: 24, y: 40, w: 48, h: 24 },
};
const crop = (r: { x: number; y: number; w: number; h: number }) => {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(PIXELS.data.subarray(((r.y + y) * W + r.x) * 4, ((r.y + y) * W + r.x + r.w) * 4), y * r.w * 4);
  return out;
};

// ---------- B0 / B1: mô phỏng ----------
const aes = async (key: Uint8Array) => crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
const enc = async (key: Uint8Array, pt: Uint8Array, aad: string) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, ct: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, await aes(key), pt as unknown as BufferSource)) }; };
const dec = async (key: Uint8Array, e: { iv: Uint8Array; ct: Uint8Array }, aad: string) => { try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv as unknown as BufferSource, additionalData: new TextEncoder().encode(aad) }, await aes(key), e.ct as unknown as BufferSource)); } catch { return null; } };
const rnd = (n = 32) => crypto.getRandomValues(new Uint8Array(n));
const KEK = rnd();                                                    // B0: khoá máy chủ
const GROUP: Record<string, Uint8Array> = { Mat: rnd(), TMH: rnd(), RHM: rnd(), Nhi: rnd() };   // B1: khoá nhóm do KMS giữ
const AUTHOR_KEY = rnd();                                             // B1: khoá của người nhập (KMS cũng giữ bản)
interface Stored { region: Region | 'goc'; body: { iv: Uint8Array; ct: Uint8Array }; wraps: { to: string; w: { iv: Uint8Array; ct: Uint8Array } }[] }
let b0: Stored[] = [], b1: Stored[] = [];
async function buildB0(): Promise<void> {
  b0 = [];
  for (const [region, r] of Object.entries(RECT) as [Region, (typeof RECT)[Region]][]) {
    const dek = rnd(); b0.push({ region, body: await enc(dek, crop(r), region), wraps: [{ to: 'server', w: await enc(KEK, dek, 'kek|' + region) }] });
  }
  const dek = rnd(); b0.push({ region: 'goc', body: await enc(dek, new Uint8Array(PIXELS.data), 'goc'), wraps: [{ to: 'server', w: await enc(KEK, dek, 'kek|goc') }] });
}
async function buildB1(): Promise<void> {
  b1 = [];
  for (const [region, r] of Object.entries(RECT) as [Region, (typeof RECT)[Region]][]) {
    const dek = rnd();
    b1.push({ region, body: await enc(dek, crop(r), region), wraps: [...KHOA[region].map((k) => ({ to: k, w: null as never })), { to: 'author', w: null as never }] });
    for (const w of b1[b1.length - 1].wraps) w.w = await enc(w.to === 'author' ? AUTHOR_KEY : GROUP[w.to], dek, `${region}|${w.to}`);
  }
  const dek = rnd(); b1.push({ region: 'goc', body: await enc(dek, new Uint8Array(PIXELS.data), 'goc'), wraps: [{ to: 'author', w: await enc(AUTHOR_KEY, dek, 'goc|author') }] });
}
/** Số vùng (trong 5 vùng + ảnh gốc) mà kẻ tấn công mở được bằng bộ khoá đã có. */
async function b0Open(have: { kek?: Uint8Array }): Promise<string[]> {
  const out: string[] = [];
  if (!have.kek) return out;
  for (const s of b0) { const dek = await dec(have.kek, s.wraps[0].w, 'kek|' + s.region); if (dek && (await dec(dek, s.body, String(s.region)))) out.push(String(s.region)); }
  return out;
}
async function b1Open(keys: Record<string, Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for (const s of b1) for (const w of s.wraps) { const k = keys[w.to]; if (!k) continue; const dek = await dec(k, w.w, `${s.region}|${w.to}`); if (dek && (await dec(dek, s.body, String(s.region)))) { out.push(String(s.region)); break; } }
  return out;
}

// ---------- ABE: app thật ----------
let nl: MedClient; const docs: Record<string, MedClient> = {};
let rows: RecordRow[] = [];                                           // toàn bộ BẢN MÃ của ảnh (ảnh gốc + 5 vùng)
const labelOf = (r: RecordRow, regionsByRow: Map<string, Region | 'goc'>) => regionsByRow.get(r.id) ?? 'goc';
const regionsByRow = new Map<string, Region | 'goc'>();
const ctxOf = (r: RecordRow) => `${r.patientIdx}|${r.type}|${r.id}`;
async function abeOpen(c: MedClient): Promise<string[]> {
  const out: string[] = [];
  for (const r of rows) {
    try { const p = await decrypt(c.s.gid, c.s.keys, (r as unknown as { envelope: Envelope }).envelope, ctxOf(r)); if (p && p.length) out.push(String(labelOf(r, regionsByRow))); } catch { /* không đủ thuộc tính */ }
  }
  return out;
}
const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const expectedFor = (khoa: string): string[] => (Object.keys(KHOA) as Region[]).filter((r) => (KHOA[r] as readonly string[]).includes(khoa));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
  nl = await login('nhaplieu01');
  for (const u of Object.keys(DOCTORS)) docs[u] = await login(u);
  await buildB0(); await buildB1();
  const td = await login('tiepdon01');
  await td.saveMany([{ patientCode: CCCD, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: A.hanhchinh.hoTen, cccd: CCCD }, group: 'TRUONG-A' }]);
  await saveImage(nl, { patientCode: CCCD, original: { mime: 'image/png', bytes: encodePng(PIXELS) }, pixels: PIXELS, modality: 'KHAC',
    regions: (Object.keys(KHOA) as Region[]).map((r) => ({ rect: RECT[r], khoas: [...KHOA[r]], label: r })) });
  const groups = await listImages(nl, CCCD);
  rows = groups.flatMap((g) => g.rows);
  // nhãn vùng của từng bản ghi: lấy từ phần ĐÃ KÝ mà tác giả giải mã (không tin nhãn máy chủ)
  for (const r of rows) {
    const o = await nl.openRecord(r);
    const bind = (o?.signed?.bind ?? {}) as { kind?: string; rect?: { x: number; y: number; w: number; h: number } };
    if (bind.kind === 'original') regionsByRow.set(r.id, 'goc');
    else { const hit = (Object.keys(RECT) as Region[]).find((k) => JSON.stringify(RECT[k]) === JSON.stringify(bind.rect)); regionsByRow.set(r.id, hit ?? 'goc'); }
  }
  for (const u of Object.keys(DOCTORS)) { const g = await listImages(docs[u], CCCD); for (const x of g) await openImage(docs[u], x.rows); }    // nạp khoá của từng bác sĩ như dùng thật
}, 400_000);
afterAll(async () => {
  try { mkdirSync(resolve('.test-runs/abe-thuc-nghiem'), { recursive: true }); writeFileSync(resolve('.test-runs/abe-thuc-nghiem/anh-doi-chung.json'), JSON.stringify(result, null, 2)); } catch { /* bỏ qua */ }
  await S?.stop();
});

describe.skipIf(!JAR)('Dữ liệu thử: 1 ảnh = 5 vùng + ảnh gốc; ba cách bảo vệ cùng tồn tại', () => {
  it('đủ 6 bản mã ABE; nhãn vùng lấy từ phần đã ký', () => {
    expect(rows.length).toBe(6);
    expect([...regionsByRow.values()].sort()).toEqual(['goc', 'mat', 'rhm', 'tmhA', 'tmhB', 'tmhC']);
  });
});

describe.skipIf(!JAR)('A1. Kẻ tấn công chỉ có CSDL (không có khoá nào): ba cách ĐỀU không lộ — không có khác biệt', () => {
  it('ABE (không giữ khoá), B0 (không có KEK), B1 (không có khoá nhóm): 0/6 vùng', async () => {
    const abe = await abeOpen({ s: { gid: 'a'.repeat(32), keys: {} } } as unknown as MedClient);
    expect(abe).toEqual([]); expect(await b0Open({})).toEqual([]); expect(await b1Open({})).toEqual([]);
    result.A1 = { ABE: 0, B0: 0, B1: 0, ketLuan: 'không khác biệt' };
  });
});

describe.skipIf(!JAR)('A2. CSDL + khoá phía máy chủ (chiếm máy chủ / quản trị hệ thống)', () => {
  it('B0: lộ CẢ 6 vùng; ABE: 0/6 (khoá máy chủ, token dịch vụ không phải khoá giải mã); B1: 0/6 nếu KMS tách riêng', async () => {
    const abe = await abeOpen({ s: { gid: 'b'.repeat(32), keys: {} } } as unknown as MedClient);   // máy chủ không có khoá thuộc tính nào của ai
    const b0o = await b0Open({ kek: KEK }); const b1o = await b1Open({});
    expect(b0o.length).toBe(6); expect(abe.length).toBe(0); expect(b1o.length).toBe(0);
    result.A2 = { ABE: abe.length, B0: b0o.length, B1: b1o.length, ketLuan: 'B0 lộ toàn bộ; ABE và B1 (KMS tách riêng) không' };
  });
});

describe.skipIf(!JAR)('A3. CSDL + một tài khoản bác sĩ SAI khoa (hoặc kẻ chiếm tài khoản đó)', () => {
  it('mỗi bác sĩ chỉ mở được đúng vùng của khoa mình, ở cả ABE lẫn B1; B0 lộ cả 6 nếu lỗi phân quyền ở API (máy chủ giải mã hộ)', async () => {
    const table: Record<string, Record<string, string[]>> = {};
    for (const [u, k] of Object.entries(DOCTORS)) {
      const abe = await abeOpen(docs[u]);
      const b1o = await b1Open({ [k]: GROUP[k] });
      expect(sameSet(abe, expectedFor(k))).toBe(true);
      expect(sameSet(b1o, expectedFor(k))).toBe(true);
      table[u] = { ABE: abe.sort(), B1: b1o.sort(), B0_khiLoiPhanQuyenApi: (await b0Open({ kek: KEK })).sort() };
    }
    result.A3 = table;
  }, 300_000);
});

describe.skipIf(!JAR)('A4. Chiếm điểm "giữ khoá tập trung"', () => {
  it('B1: chiếm KMS (khoá nhóm + khoá người nhập) = mở 6/6; ABE: một nút cấp khoá bị chiếm KHÔNG đủ (ngưỡng 2/3): chỉ có 1 trong 3 share', async () => {
    const b1o = await b1Open({ ...GROUP, author: AUTHOR_KEY });
    expect(b1o.length).toBe(6);
    // ABE: kẻ chiếm 1 nút có share x của nút đó; cần k=2 share để dựng khoá thuộc tính => 1 share không đủ (xem rw15.test.ts, split-nodes.e2e.test.ts)
    result.A4 = { B1_chiemKMS: b1o.length, ABE_chiem1Nut: 0, ABE_chiem2Nut: 'mở được (ngưỡng 2/3) — giới hạn còn lại của mô hình', dan: 'security/src/deploy/split-nodes.e2e.test.ts, security/src/abe/rw15.test.ts' };
  });
});

describe.skipIf(!JAR)('Chi phí đổi chính sách + kích thước + thời gian (đo thực)', () => {
  it('kích thước phần "bọc khoá" mỗi bản ghi: ABE (đối tượng đường cong, theo số thuộc tính trong policy) so với B0/B1 (một/vài khối AES-GCM)', () => {
    const abeSizes = rows.map((r) => JSON.stringify((r as unknown as { envelope: { abe?: unknown } }).envelope.abe ?? {}).length);
    const b1Wrap = b1.map((s) => s.wraps.length * (12 + 32 + 16) * 2);   // iv + khoá 32 + tag 16, dạng hex ×2
    result.kichThuocBocKhoa_byte = { ABE_trungVi: med(abeSizes), ABE_nhoNhat: Math.min(...abeSizes), ABE_lonNhat: Math.max(...abeSizes), B1_trungVi: med(b1Wrap), B0: 120 };
    expect(med(abeSizes)).toBeGreaterThan(0);
  });

  it('thời gian mở ảnh của bác sĩ RHM (1 vùng) và của người nhập (6 bản mã): ABE đo thật trên app; B0/B1 chỉ phần mật mã (N=15 mỗi mục)', async () => {
    const N = 15;
    const time = async (f: () => Promise<unknown>) => { const t: number[] = []; for (let i = 0; i < N; i++) { const a = performance.now(); await f(); t.push(performance.now() - a); } return { trungVi_ms: +med(t).toFixed(1), p95_ms: +p95(t).toFixed(1), n: N }; };
    const rhm = docs['bsrhm01'];
    const coldFresh: number[] = [];
    for (let i = 0; i < 3; i++) { const a = performance.now(); const c = await login('bsrhm01'); const g = await listImages(c, CCCD); for (const x of g) await openImage(c, x.rows); coldFresh.push(performance.now() - a); }
    const warmRhm = await time(async () => { const g = await listImages(rhm, CCCD); for (const x of g) await openImage(rhm, x.rows); });
    const warmAuthor = await time(async () => { const g = await listImages(nl, CCCD); for (const x of g) await openImage(nl, x.rows); });
    const b0t = await time(async () => { await b0Open({ kek: KEK }); });
    const b1Rhm = await time(async () => { await b1Open({ RHM: GROUP.RHM }); });
    const b1Author = await time(async () => { await b1Open({ author: AUTHOR_KEY, ...GROUP }); });
    result.thoiGianMoAnh = {
      ABE_bacSiRHM_phienMoi_dangNhap_den_thayAnh_ms: { trungVi_ms: Math.round(med(coldFresh)), n: coldFresh.length, ghi: 'gồm đăng nhập, xin vé, 3 nút cấp khoá, giải mã' },
      ABE_bacSiRHM_phienDaCoKhoa: warmRhm, ABE_nguoiNhap_6banMa_phienDaCoKhoa: warmAuthor,
      B0_matMaMayChu_6banMa: b0t, B1_bacSiRHM: b1Rhm, B1_nguoiNhap_6banMa: b1Author,
      ghi: 'ABE gồm: gọi API liệt kê + tải bản mã + giải mã ABE (cặp song tuyến) + giải mã AES + ghép ảnh. B0/B1 chỉ gồm AES-GCM nên KHÔNG so được trực tiếp về độ trễ end-to-end — đây là chi phí mật mã.',
    };
    console.log('SO DO ANH', JSON.stringify(result.thoiGianMoAnh));
    expect(warmRhm.trungVi_ms).toBeGreaterThan(0);
  }, 600_000);

  it('đổi chính sách hồ sơ CŨ: thêm khoa TMH vào vùng Mắt — ABE: người hợp lệ mở thì tự bọc lại (O(1)/header); B1: người giữ DEK bọc thêm cho khoa mới. Đo thời gian mỗi cách', async () => {
    const mat = docs['bsmat01'];
    const matRow = rows.find((r) => regionsByRow.get(r.id) === 'mat')!;
    // B1: bọc lại DEK cho khoa mới (cần DEK: người giữ khoá nhóm Mắt mở ra rồi bọc cho TMH)
    const s = b1.find((x) => x.region === 'mat')!;
    const t0 = performance.now();
    const dek = await dec(GROUP.Mat, s.wraps.find((w) => w.to === 'Mat')!.w, 'mat|Mat');
    s.wraps.push({ to: 'TMH', w: await enc(GROUP.TMH, dek!, 'mat|TMH') });
    const tB1 = performance.now() - t0;
    // ABE: thay đổi chính sách = đổi phiên bản thuộc tính; bác sĩ hợp lệ mở bản ghi => bọc lại. Đo một lần sau khi tăng epoch (tài khoản khác bị hạn chế => bộ đếm tăng)
    const users = await (await login('quantri01')).api<{ userId: string; username: string }[]>('GET', '/api/v2/admin/users');
    const qt = await login('quantri01');
    const victim = users.find((u) => u.username === 'bsnhi01')!;
    await qt.api('POST', `/api/v2/admin/users/${victim.userId}/restrict`, { reason: 'Do chi phi boc lai khi doi epoch (GIA LAP)', rotateKeys: true, revokeSessions: false });
    const fresh = await listImages(mat, CCCD);
    const row = fresh.flatMap((g) => g.rows).find((r) => r.id === matRow.id)!;
    const t1 = performance.now();
    const opened = await mat.openRecord(row);
    const tAbe = performance.now() - t1;
    result.doiChinhSachHoSoCu = { ABE_moVaBocLaiMotBanGhi_ms: Math.round(tAbe), ABE_daBocLai: !!opened?.rewrapped, B1_bocThemMotNhom_ms: +tB1.toFixed(2),
      ghi: 'ABE bọc lại header khoá (không mã hoá lại ảnh); với lô dùng header chung thì chỉ 1 phép cho cả lô. B1 nhanh hơn rất nhiều về mật mã nhưng cần người/dịch vụ GIỮ DEK và mỗi nhóm khoá phải được KMS phát cho đúng người.' };
    await qt.api('POST', `/api/v2/admin/users/${victim.userId}/restore`, { reason: 'Khoi phuc sau do luong (GIA LAP)' });
    expect(opened).not.toBeNull();
  }, 300_000);
});
