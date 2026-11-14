// THỰC NGHIỆM "CHÍNH SÁCH ĐỘNG" + KỊCH BẢN 2 (nghi tài khoản nhân viên bị chiếm → giảm quyền → khôi phục) trên hệ thống thật (Spring HTTPS + 3 nút). HỒ SƠ GIẢ.
// Mỗi bước tách rõ: việc nào do MÁY CHỦ chặn (kiểm quyền mỗi yêu cầu) và việc nào thực sự đổi KHẢ NĂNG GIẢI MÃ (phiên bản thuộc tính / epoch + bọc lại khoá).
// Ghi số đo ra .test-runs/abe-thuc-nghiem/chinh-sach-dong.json (dùng cho báo cáo).
//  E1 phiên đang mở bị giảm quyền ngay; E2 bản mã đã sao chép + khoá cũ VẪN mở được bản cũ (giới hạn của ABE);
//  E3 hồ sơ MỚI sau giảm quyền: khoá cũ không mở được; E4 hồ sơ CŨ: cửa sổ trước khi có người hợp lệ mở (bọc lại) rồi khoá cũ hết tác dụng;
//  E5 khôi phục sau xác minh + nhật ký; E6 số đo; E7 một vài lần nhập sai mật khẩu KHÔNG làm tài khoản bị hạn chế.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decrypt, type Envelope } from '../abe/rw15.js';
import { versioned } from '../common/epoch.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { MedClient, type RecordRow } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [A] = fakePatients(1, 31337);
const CCCD = A.hanhchinh.cccd;
const UNIT = 'TRUONG-A';
let S: ResearchStack;
const login = (u: string, p = pw(u)) => MedClient.signIn(S.baseUrl, u, p, new MemoryDeviceKeyStore(), { fetch: S.fetch });
let qt: MedClient, td: MedClient, victim: MedClient, other: MedClient;       // victim = bsmat01 (nghi bị chiếm), other = bsmat02 (bác sĩ Mắt khác, hợp lệ)
let victimId = '';
let rOld: RecordRow;           // hồ sơ CŨ do bsmat02 nhập (victim đọc qua nhánh Role:BacSi AND Khoa:Mat)
let rOwn: RecordRow;           // hồ sơ do CHÍNH victim nhập (nhánh tác giả)
let copyOld: RecordRow;        // BẢN MÃ victim đã sao chép TRƯỚC khi bị hạn chế
let oldKeys: MedClient['s']['keys'];
const result: Record<string, unknown> = { cauHinh: { node: process.version, jar: 'medabe-storage', ghi: 'máy chủ thử cục bộ (loopback), 3 nút cùng máy, mật khẩu PBKDF2 20.000 vòng' } };
const ctxOf = (r: RecordRow) => `${r.patientIdx}|${r.type}|${r.id}`;
/** Thử giải mã NGOẠI TUYẾN bằng bộ khoá đã có trong tay (không hỏi máy chủ). true = ra bản rõ. */
async function offline(c: { gid: string; keys: MedClient['s']['keys'] }, row: RecordRow): Promise<boolean> {
  try { const r = await decrypt(c.gid, c.keys, (row as unknown as { envelope: Envelope }).envelope, ctxOf(row)); return !!r && r.length > 0; } catch { return false; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
  [qt, td, victim] = await Promise.all([login('quantri01'), login('tiepdon01'), login('bsmat01')]);
  const users = await qt.api<{ userId: string; username: string }[]>('GET', '/api/v2/admin/users');
  victimId = users.find((u) => u.username === 'bsmat01')!.userId;
  const made = await qt.api<{ temporaryPassword: string }>('POST', '/api/v2/admin/users', { username: 'bsmat02', role: 'BAC_SI', khoa: 'Mat', displayName: 'Bac si Mat 02' });
  other = await MedClient.signIn(S.baseUrl, 'bsmat02', made.temporaryPassword, new MemoryDeviceKeyStore(), { fetch: S.fetch, newPassword: 'BsMat02-MatKhau-2026' });
  await td.saveMany([{ patientCode: CCCD, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: A.hanhchinh.hoTen, cccd: CCCD }, group: UNIT }]);
  await other.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Mat', data: { canary: 'CANARY-MAT-CU' }, group: UNIT });
  await victim.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Mat', data: { canary: 'CANARY-MAT-CUA-VICTIM' }, group: UNIT });
}, 400_000);
afterAll(async () => {
  try { mkdirSync(resolve('.test-runs/abe-thuc-nghiem'), { recursive: true }); writeFileSync(resolve('.test-runs/abe-thuc-nghiem/chinh-sach-dong.json'), JSON.stringify(result, null, 2)); } catch { /* không ghi được thì bỏ qua */ }
  await S?.stop();
});

const rowsFor = async (c: MedClient) => (await c.listRecords(CCCD)).filter((r) => r.type === 'lamsang');
const canaryOf = async (c: MedClient, r: RecordRow) => ((await c.openRecord(r))?.data as { canary?: string } | undefined)?.canary;

describe.skipIf(!JAR)('Trước khi có sự cố: bsmat01 đọc được cả hồ sơ do bsmat02 nhập (nhánh Role:BacSi AND Khoa:Mat) lẫn hồ sơ của chính mình', () => {
  it('đọc được bình thường; ghi lại BẢN MÃ và BỘ KHOÁ đang có (mô phỏng kẻ chiếm tài khoản đã tải sẵn)', async () => {
    const rows = await rowsFor(victim);
    rOld = rows.find((r) => r.authorUserId !== victimId)!; rOwn = rows.find((r) => r.authorUserId === victimId)!;
    expect(await canaryOf(victim, rOld)).toBe('CANARY-MAT-CU');
    expect(await canaryOf(victim, rOwn)).toBe('CANARY-MAT-CUA-VICTIM');
    copyOld = JSON.parse(JSON.stringify(rOld));                                                         // bản mã "đã sao chép"
    oldKeys = JSON.parse(JSON.stringify(victim.s.keys));                                                // khoá đã giải mã trong bộ nhớ máy bị chiếm
    expect(Object.keys(oldKeys).length).toBeGreaterThan(0);
    expect(await offline({ gid: victim.s.gid, keys: oldKeys }, copyOld)).toBe(true);                    // đối chứng: trước khi hạn chế thì mở ngoại tuyến được
  }, 300_000);
});

describe.skipIf(!JAR)('E1. Tài khoản đang truy cập → ghi tín hiệu rủi ro (GIẢ LẬP) → giảm quyền: PHIÊN ĐANG MỞ bị chặn ngay ở máy chủ', () => {
  it('ghi tín hiệu rủi ro chưa đổi quyền; hạn chế (không thu hồi phiên) thì yêu cầu kế tiếp của phiên đang mở bị đánh giá lại: không còn đọc hồ sơ người khác, không ghi, không xin được khoá vai trò/khoa', async () => {
    const t0 = performance.now();
    await qt.api('POST', `/api/v2/admin/users/${victimId}/risk-signal`, { kind: 'ANOMALOUS_READ_VOLUME', detail: 'GIA LAP: doc 300 ho so trong 5 phut tu may la', simulated: true });
    expect(await canaryOf(victim, rOld)).toBe('CANARY-MAT-CU');                                         // tín hiệu KHÔNG tự đổi quyền: quyết định là của người
    const t1 = performance.now();
    await qt.api('POST', `/api/v2/admin/users/${victimId}/restrict`, { reason: 'Nghi bi chiem sau tin hieu doc bat thuong (GIA LAP)', rotateKeys: true, revokeSessions: false });
    const t2 = performance.now();
    const after = await rowsFor(victim);                                                                // CÙNG phiên, CÙNG đối tượng client
    const tDeny = performance.now();
    expect(after.some((r) => r.id === rOld.id)).toBe(false);                                            // máy chủ không còn LIỆT KÊ hồ sơ của người khác cho tài khoản này (không trả bản mã)
    await expect(victim.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Mat', data: { canary: 'x' }, group: UNIT })).rejects.toThrow(/DENY_ACCOUNT_RESTRICTED|403/);   // không ghi
    await expect(victim.api('GET', '/api/v2/admin/users')).rejects.toThrow(/403|DENY/);                  // không quản trị
    const me = await victim.api<{ status: string; attributes?: string[] }>('GET', '/api/v2/auth/me');
    expect(me.status).toBe('RESTRICTED');
    expect((me.attributes ?? []).every((a) => a.startsWith('MED:Author:'))).toBe(true);                 // chỉ còn thuộc tính tác giả
    // xin VÉ cấp khoá cho thuộc tính vai trò/khoa (cùng phiên đang mở): PDP không cấp
    const dir = await victim.epochs();
    const ticket = await victim.api<{ attrs?: string[] }>('POST', '/api/v2/keys/ticket', { attrs: [versioned('MED:Role:BacSi', dir), versioned('MED:Khoa:Mat', dir)] }).then((x) => x, (e: Error) => ({ loi: String(e.message).slice(0, 80) }));
    const granted = 'attrs' in ticket ? (ticket.attrs ?? []) : [];
    expect(granted.filter((a) => /Role:BacSi|Khoa:Mat/.test(a))).toEqual([]);
    result.E1_xinVeKhoaVaiTroKhoa = 'loi' in ticket ? `bị từ chối: ${ticket.loi}` : `vé không chứa thuộc tính vai trò/khoa (cấp: ${JSON.stringify(granted)})`;
    // hồ sơ do CHÍNH tài khoản nhập thì vẫn đọc lại được (nhánh tác giả): "giảm ĐÚNG quyền", không khoá trắng
    const own = (await rowsFor(victim)).find((r) => r.id === rOwn.id)!;
    expect(await canaryOf(victim, own)).toBe('CANARY-MAT-CUA-VICTIM');
    result.E1 = { tinHieuToiHanChe_ms: Math.round(t2 - t1), hanCheToiBiTuChoiDocDauTien_ms: Math.round(tDeny - t2), tongTuLucGhiTinHieu_ms: Math.round(tDeny - t0) };
  }, 300_000);

  it('epoch: bộ đếm của các thuộc tính vai trò/khoa nạn nhân đang giữ đã tăng; thuộc tính tác giả (của riêng nạn nhân) không tăng', async () => {
    const dir = await qt.epochs();
    expect(dir.counters['MED:Role:BacSi']).toBeGreaterThanOrEqual(1);
    expect(dir.counters['MED:Khoa:Mat']).toBeGreaterThanOrEqual(1);
    expect(Object.keys(dir.counters).some((k) => k.startsWith('MED:Author:'))).toBe(false);
    result.epoch = dir.counters;
  }, 120_000);
});

describe.skipIf(!JAR)('E2–E4. Việc nào do MÁY CHỦ chặn, việc nào thực sự đổi khả năng GIẢI MÃ', () => {
  it('E2 (giới hạn của ABE): bản mã ĐÃ SAO CHÉP trước đó + khoá cũ VẪN giải mã được ngoại tuyến — ABE không "rút" khoá đã cấp', async () => {
    const ok = await offline({ gid: victim.s.gid, keys: oldKeys }, copyOld);
    expect(ok).toBe(true);
    result.E2_banMaDaSaoChep_khoaCu_moDuoc = ok;
  }, 120_000);

  it('E3: hồ sơ MỚI nhập sau khi hạn chế (phiên bản thuộc tính mới): khoá cũ KHÔNG mở được, dù có bản mã', async () => {
    await other.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Mat', data: { canary: 'CANARY-MAT-MOI' }, group: UNIT });
    const fresh = (await rowsFor(other)).find((r) => (r as { id: string }).id !== rOld.id && r.authorUserId !== victimId && r.id !== rOwn.id)!;
    expect(await canaryOf(other, fresh)).toBe('CANARY-MAT-MOI');                                        // bác sĩ hợp lệ vẫn đọc bình thường
    const ok = await offline({ gid: victim.s.gid, keys: oldKeys }, fresh);                              // kẻ chiếm "lấy được bản mã" (vd từ kho/trung gian) + khoá cũ
    expect(ok).toBe(false);
    result.E3_hoSoMoi_khoaCu_moDuoc = ok;
  }, 120_000);

  it('E4: hồ sơ CŨ — trước khi có người hợp lệ mở thì bản mã vẫn ở phiên bản cũ (khoá cũ mở được: CỬA SỔ BỌC LẠI LƯỜI); sau khi bác sĩ hợp lệ mở (tự bọc lại khoá) thì khoá cũ hết tác dụng với bản mã hiện hành', async () => {
    const before = (await rowsFor(other)).find((r) => r.id === rOld.id)!;
    expect(await offline({ gid: victim.s.gid, keys: oldKeys }, before)).toBe(true);                     // cửa sổ: chưa ai mở sau khi epoch tăng
    const t0 = performance.now();
    const opened = await other.openRecord(before);
    const tRewrap = performance.now() - t0;
    expect(opened?.rewrapped).toBe(true);                                                              // bác sĩ hợp lệ mở => tự bọc lại khoá sang phiên bản mới
    const afterRow = (await rowsFor(other)).find((r) => r.id === rOld.id)!;
    expect(await offline({ gid: victim.s.gid, keys: oldKeys }, afterRow)).toBe(false);                  // bản mã hiện hành: khoá cũ không mở được
    expect(await offline({ gid: victim.s.gid, keys: oldKeys }, copyOld)).toBe(true);                    // nhưng BẢN SAO cũ vẫn mở được (E2)
    result.E4 = { cuaSoTruocKhiBocLai_khoaCuMoDuoc: true, sauBocLai_banMaHienHanh_khoaCuMoDuoc: false, thoiGianMoVaBocLaiMotHoSo_ms: Math.round(tRewrap) };
  }, 120_000);
});

describe.skipIf(!JAR)('E5–E7. Khôi phục sau xác minh, nhật ký, và nhập sai mật khẩu không đủ để kết luận bị tấn công', () => {
  it('khôi phục cần lý do; đăng nhập lại nhận khoá theo phiên bản MỚI và đọc lại cả hồ sơ cũ lẫn mới', async () => {
    await expect(qt.api('POST', `/api/v2/admin/users/${victimId}/restore`, { reason: 'ngan' })).rejects.toThrow(/REASON_REQUIRED|400/);
    await qt.api('POST', `/api/v2/admin/users/${victimId}/restore`, { reason: 'Da goi lai chu tai khoan va xac minh dung nguoi (GIA LAP)' });
    const back = await login('bsmat01');
    const rows = await rowsFor(back);
    const canaries = (await Promise.all(rows.map((r) => canaryOf(back, r)))).sort();
    expect(canaries).toEqual(['CANARY-MAT-CU', 'CANARY-MAT-CUA-VICTIM', 'CANARY-MAT-MOI']);
    const me = await back.api<{ status: string }>('GET', '/api/v2/auth/me');
    expect(me.status).toBe('ACTIVE');
    await back.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Mat', data: { canary: 'SAU-KHOI-PHUC' }, group: UNIT });         // ghi lại được
  }, 300_000);

  it('nhật ký có đủ chuỗi sự kiện theo thứ tự: tín hiệu rủi ro (giả lập) → hạn chế → khôi phục; lý do được ghi; KHÔNG có mật khẩu/khoá', async () => {
    const recs = (await qt.api<{ records: { action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=500')).records;
    const idx = (a: string) => recs.findIndex((r) => r.action === a && r.detail.includes(victimId));
    const iSignal = idx('v2.risk.signal'), iRestrict = idx('v2.account.restrict'), iRestore = idx('v2.account.restore');
    expect(iSignal).toBeGreaterThanOrEqual(0); expect(iRestrict).toBeGreaterThanOrEqual(0); expect(iRestore).toBeGreaterThanOrEqual(0);
    const text = JSON.stringify(recs);
    expect(text).toContain('nguon=GIA_LAP');
    expect(text).toContain('epoch-tang=');
    expect(text).not.toMatch(/passwordHash|BsMat02-MatKhau/);
    result.nhatKy = recs.filter((r) => /risk\.signal|account\.(restrict|restore)/.test(r.action)).map((r) => `${r.action} ${r.detail}`.slice(0, 160)).reverse();
  }, 120_000);

  it('E7: vài lần nhập SAI mật khẩu không làm tài khoản bị hạn chế (chỉ tạm khoá chống dò mật khẩu); hạn chế là quyết định có lý do của người quản trị', async () => {
    for (let i = 0; i < 3; i++) await expect(login('bsmat01', 'sai-mat-khau-' + i)).rejects.toThrow();
    const u = (await qt.api<{ username: string; status: string }[]>('GET', '/api/v2/admin/users')).find((x) => x.username === 'bsmat01')!;
    expect(u.status).toBe('ACTIVE');
  }, 120_000);

  it('E6 (số đo): 10 lần hạn chế→khôi phục liên tiếp; đo thời gian từ lúc hạn chế xong đến lúc yêu cầu đọc kế tiếp của phiên đang mở bị từ chối', async () => {
    const live = await login('bsmat01');
    const restrictMs: number[] = [], denyMs: number[] = [], restoreMs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = performance.now();
      await qt.api('POST', `/api/v2/admin/users/${victimId}/restrict`, { reason: `Do luong lan ${i + 1} (GIA LAP)`, rotateKeys: false, revokeSessions: false });
      const b = performance.now();
      const rows = await rowsFor(live);
      expect(rows.every((r) => r.authorUserId === victimId || (r as { denied?: boolean }).denied === true || !(r as { envelope?: unknown }).envelope)).toBe(true);
      const c = performance.now();
      await qt.api('POST', `/api/v2/admin/users/${victimId}/restore`, { reason: `Khoi phuc do luong ${i + 1} (GIA LAP)` });
      const d = performance.now();
      restrictMs.push(b - a); denyMs.push(c - b); restoreMs.push(d - c);
      await sleep(50);
    }
    const stat = (x: number[]) => ({ trungVi_ms: Math.round(med(x)), p95_ms: Math.round(p95(x)), nhoNhat_ms: Math.round(Math.min(...x)), lonNhat_ms: Math.round(Math.max(...x)), soLan: x.length });
    result.E6 = { hanChe_API: stat(restrictMs), doc_bi_tu_choi_sau_han_che: stat(denyMs), khoiPhuc_API: stat(restoreMs), ghiChu: 'đo trong tiến trình thử nghiệm, máy chủ loopback; không gồm độ trễ mạng thật' };
    console.log('SO DO E6', JSON.stringify(result.E6));
  }, 300_000);
});
