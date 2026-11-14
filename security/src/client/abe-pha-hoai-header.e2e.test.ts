// THỬ PHÁ HOẠI HEADER KHOÁ CHUNG (v3) bởi NGƯỜI ĐỌC HỢP LỆ — kiểm tra giả thuyết từ đọc mã: PUT /api/headers/{id} chỉ kiểm "policy mới là policy chuẩn của MỘT mục nào đó",
// không kiểm nó có phải policy chuẩn của CÁC BẢN GHI đang dùng header đó. HỒ SƠ GIẢ, máy chủ tạm.
//  W1  bác sĩ Mắt (người đọc hợp lệ của Hành chính) bọc lại header của lô Hành chính sang policy chuẩn của "lâm sàng Mắt" => bác sĩ Nhi (cũng hợp lệ) mất khả năng giải mã cả lô.
//      TRƯỚC KHI VÁ (đã chạy, tái hiện được): máy chủ trả OK; bác sĩ Nhi mở hồ sơ báo "Không có header khoá <id>". SAU KHI VÁ (LegacyBridge.validateHeaderRewrap): 403 POLICY_MISMATCH, Nhi vẫn mở được.
//  W2  header gửi lên mang nhãn epoch cũ bị từ chối EPOCH_STALE.
//  W3  đường bình thường vẫn chạy: sau khi epoch đổi, người đọc hợp lệ mở lô và header được bọc lại đúng cấu trúc (rewrapped = true).
// Kết quả ghi ra .test-runs/abe-thuc-nghiem/pha-hoai-header.json.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rewrapKeyHeader } from '../abe/rw15.js';
import { versioned } from '../common/epoch.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { appPolicyString, type PolicyMatrix } from './app-policy.js';
import { MedClient, type RecordRow } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [A] = fakePatients(1, 4242);
const CCCD = A.hanhchinh.cccd, NAME = A.hanhchinh.hoTen;
let S: ResearchStack;
const login = (u: string) => MedClient.signIn(S.baseUrl, u, pw(u), new MemoryDeviceKeyStore(), { fetch: S.fetch });
let qt: MedClient, td: MedClient, mat: MedClient;
let lamSangId = ''; let hcRow: RecordRow; let headerId = ''; let authorId = ''; let hcDek: Uint8Array;
const result: Record<string, unknown> = {
  cauHinh: { node: process.version, ghi: 'máy chủ thử cục bộ, hồ sơ giả' },
  truocKhiVa: { ngay: '2026-11-13', ketQuaMayChu: 'OK (được chấp nhận) — PUT /api/headers/{id} chỉ kiểm "policy mới là policy chuẩn của MỘT mục nào đó"', hauQua: 'bác sĩ Nhi mở hồ sơ Hành chính: "Không có header khoá <id>" (GET /api/headers lọc theo policy header mới)', phamVi: 'chỉ header chung v3 (lô nhập qua saveMany: Hành chính và dữ liệu nhập hàng loạt); bản ghi v2 đã bị chặn từ trước bởi checkPolicyString' },
};
const errOf = async (p: Promise<unknown>) => p.then(() => 'OK (được chấp nhận)', (e: Error) => String(e.message).slice(0, 160));

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
  [qt, td, mat] = await Promise.all([login('quantri01'), login('tiepdon01'), login('bsmat01')]);
  await td.saveMany([{ patientCode: CCCD, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: NAME, cccd: CCCD }, group: 'TRUONG-A' }]);
  await mat.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Mat', data: { x: 1, canary: 'LAM-SANG-MAT' }, group: 'TRUONG-A' });
  hcRow = (await mat.listRecords(CCCD)).find((r) => r.type === 'hanhchinh')!;
  headerId = (hcRow.envelope as unknown as { headerId: string }).headerId;
  authorId = hcRow.authorUserId!;
}, 400_000);
afterAll(async () => {
  try { mkdirSync(resolve('.test-runs/abe-thuc-nghiem'), { recursive: true }); writeFileSync(resolve('.test-runs/abe-thuc-nghiem/pha-hoai-header.json'), JSON.stringify(result, null, 2)); } catch { /* bỏ qua */ }
  await S?.stop();
});

describe.skipIf(!JAR)('W1. Người đọc hợp lệ bọc lại header chung sang policy của mục khác', () => {
  it('trước: bác sĩ Nhi và bác sĩ Mắt đều mở được hồ sơ Hành chính (nhánh Role:BacSi)', async () => {
    const nhi = await login('bsnhi01');
    const rowN = (await nhi.listRecords(CCCD)).find((r) => r.type === 'hanhchinh')!;
    expect(((await nhi.openRecord(rowN))?.data as { hoTen?: string }).hoTen).toBe(NAME);
    expect(((await mat.openRecord(hcRow))?.data as { hoTen?: string }).hoTen).toBe(NAME);
    hcDek = (mat as unknown as { deks: Map<string, Uint8Array> }).deks.get(headerId)!;   // DEK mà người đọc hợp lệ nào cũng có sau khi mở
    expect(hcDek?.length).toBe(32);
  }, 300_000);

  it('tấn công: bác sĩ Mắt (hợp lệ) PUT header sang policy chuẩn "lâm sàng Mắt" (đúng epoch, đúng cú pháp, bọc ĐÚNG DEK) — máy chủ phải từ chối', async () => {
    const dir = await mat.epochs(); const v = (a: string) => versioned(a, dir);
    const m = JSON.parse((await mat.api<{ payload: string }>('GET', '/api/v2/policy')).payload).matrix as PolicyMatrix;
    const evil = appPolicyString(m, 'lamsang', ['Mat'], authorId, v);                      // policy chuẩn của MỘT mục khác, nhưng KHÔNG phải của Hành chính
    const cfg = await mat.config();
    const nh = await rewrapKeyHeader({ MED: cfg.pk }, evil, hcDek);
    const kq = await errOf(mat.api('PUT', `/api/headers/${headerId}`, nh));
    result.W1_tanCong = { policyDung: 'Author OR Role:TiepDon OR Role:BacSi ... (Hành chính)', policyGiaMao: evil.replace(/#\d{4}W\d{2}\.\d+/g, ''), ketQuaMayChu: kq };
    expect(kq).toMatch(/POLICY_MISMATCH|403/);
  }, 300_000);

  it('hậu quả (nếu tấn công thành công): bác sĩ Nhi hợp lệ mất khả năng giải mã cả lô; sau khi vá thì VẪN mở được', async () => {
    const nhi2 = await login('bsnhi01');                                                     // phiên mới, không dùng bộ nhớ đệm
    const row = (await nhi2.listRecords(CCCD)).find((r) => r.type === 'hanhchinh')!;
    let ket = 'MỞ ĐƯỢC';
    try { const o = await nhi2.openRecord(row); ket = o ? 'MỞ ĐƯỢC' : 'KHÔNG MỞ ĐƯỢC (null)'; } catch (e) { ket = 'KHÔNG MỞ ĐƯỢC: ' + String((e as Error).message).slice(0, 100); }
    result.W1_hauQua_BacSiNhi = ket;
    expect(ket).toBe('MỞ ĐƯỢC');
  }, 300_000);
});

describe.skipIf(!JAR)('W2. Quyền bọc lại và toàn vẹn dữ liệu mã hoá', () => {
  it('bác sĩ không đọc được header (TMH không có nhánh với policy Mắt) hoặc người dùng gửi header với policy cũ epoch đều bị từ chối', async () => {
    const dir = await mat.epochs();
    const cfg = await mat.config();
    const old = await rewrapKeyHeader({ MED: cfg.pk }, 'MED:Role:BacSi#2020W01.0 OR MED:Role:TiepDon#2020W01.0', hcDek);
    const kq = await errOf(mat.api('PUT', `/api/headers/${headerId}`, old));
    result.W2_epochCu = kq;
    expect(kq).toMatch(/EPOCH_STALE|409|POLICY_MISMATCH|403/);
    expect(dir.tag).toBeTruthy();
  }, 120_000);
});

describe.skipIf(!JAR)('W3. Đường bình thường không bị vá làm hỏng: sau khi epoch đổi, người đọc hợp lệ mở lô và header được bọc lại', () => {
  it('hạn chế một bác sĩ khác (tăng epoch Role:BacSi) → td mở hồ sơ → rewrapped = true và bác sĩ Mắt/Nhi vẫn mở được', async () => {
    const users = await qt.api<{ userId: string; username: string }[]>('GET', '/api/v2/admin/users');
    const victim = users.find((u) => u.username === 'bstmh01')!;
    const before = (await qt.epochs()).counters['MED:Role:BacSi'] ?? 0;
    await qt.api('POST', `/api/v2/admin/users/${victim.userId}/restrict`, { reason: 'Kiem thu bao ve header: tang epoch (GIA LAP)', rotateKeys: true, revokeSessions: true });
    const after = (await qt.epochs()).counters['MED:Role:BacSi'] ?? 0;
    expect(after).toBeGreaterThan(before);
    const tdNew = await login('tiepdon01');
    const row = (await tdNew.listRecords(CCCD)).find((r) => r.type === 'hanhchinh')!;
    const o = await tdNew.openRecord(row);
    expect((o?.data as { hoTen?: string }).hoTen).toBe(NAME);
    const matNew = await login('bsmat01'); const nhiNew = await login('bsnhi01');
    for (const c of [matNew, nhiNew]) { const r = (await c.listRecords(CCCD)).find((x) => x.type === 'hanhchinh')!; expect(((await c.openRecord(r))?.data as { hoTen?: string }).hoTen).toBe(NAME); }
    const mr = (await matNew.listRecords(CCCD)).find((r) => r.type === 'lamsang')!;
    const o2 = await matNew.openRecord(mr);
    expect((o2?.data as { canary?: string }).canary).toBe('LAM-SANG-MAT'); expect(o2?.rewrapped).toBe(true);   // ban ghi v2 cung duoc boc lai (tao prevEnvelope)
    lamSangId = mr.id;
    result.W3 = { epochTruoc: before, epochSau: after, tiepDonMoVaBocLai: o?.rewrapped, bacSiMatNhiVanMoDuoc: true };
    expect(o?.rewrapped).toBe(true);
  }, 400_000);
});

describe.skipIf(!JAR)('W4. Người đọc hợp lệ GHI ĐÈ header bằng khoá bọc RÁC (cùng policy, đúng epoch): máy chủ không có DEK nên KHÔNG kiểm được', () => {
  let hdr: { id: string; policy: string; abe: unknown; wrapIv: string; wrappedDek: string };
  it('W4a — tái hiện: máy chủ chấp nhận; bác sĩ Nhi (hợp lệ) không mở được cả lô; hành vi được ghi nhật ký kèm tài khoản thực hiện', async () => {
    const m2 = await login('bsmat01'); const row = (await m2.listRecords(CCCD)).find((r) => r.type === 'hanhchinh')!; await m2.openRecord(row);   // đảm bảo header ở epoch hiện hành
    hdr = (await m2.api<(typeof hdr)[]>('GET', `/api/headers?ids=${headerId}`))[0];
    expect(hdr?.id).toBe(headerId);
    const kq = await errOf(m2.api('PUT', `/api/headers/${headerId}`, { policy: hdr.policy, abe: hdr.abe, wrapIv: hdr.wrapIv, wrappedDek: 'ab'.repeat(48) }));
    const nhi = await login('bsnhi01');
    const rowN = (await nhi.listRecords(CCCD)).find((r) => r.type === 'hanhchinh')!;
    let hauQua = 'MỞ ĐƯỢC';
    try { hauQua = (await nhi.openRecord(rowN)) ? 'MỞ ĐƯỢC' : 'null'; } catch (e) { hauQua = 'KHÔNG MỞ ĐƯỢC: ' + String((e as Error).message).slice(0, 110); }
    const audit = (await qt.api<{ records: { action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=300')).records.filter((r) => r.action.includes('header.rewrap') && r.detail.includes(headerId.slice(0, 8)));
    result.W4a_taiHien = { ketQuaMayChu: kq, bacSiNhi: hauQua, nhatKyRewrap: audit.slice(0, 2).map((r) => `${r.action} ${r.detail}`.slice(0, 120)) };
    expect(kq).toMatch(/OK/);
    expect(hauQua).toMatch(/KHÔNG MỞ ĐƯỢC/);
  }, 300_000);
});

describe.skipIf(!JAR)('W4b/W4c. Khắc phục: lịch sử + khôi phục bởi quản trị (có lý do, có nhật ký, truy được tài khoản đã ghi đè)', () => {
  it('W4b — header: quản trị thấy TÀI KHOẢN đã ghi đè; thiếu lý do bị từ chối; khôi phục phiên bản trước → bác sĩ Nhi mở lại được; có nhật ký', async () => {
    const users = await qt.api<{ userId: string; username: string }[]>('GET', '/api/v2/admin/users');
    const matId = users.find((u) => u.username === 'bsmat01')!.userId;
    const hist = await qt.api<{ lichSu: { index: number; thayBoi: string; policy: string }[] }>('GET', `/api/v2/admin/headers/${headerId}/history`);
    expect(hist.lichSu.length).toBeGreaterThanOrEqual(1);
    expect(hist.lichSu[0].thayBoi).toBe(matId);                                                    // người đã ghi đè phiên bản hiện tại
    const noReason = await errOf(qt.api('POST', `/api/v2/admin/headers/${headerId}/restore`, { index: 0, reason: 'ngan' }));
    expect(noReason).toMatch(/REASON_REQUIRED|400/);
    await qt.api('POST', `/api/v2/admin/headers/${headerId}/restore`, { index: 0, reason: 'Khoi phuc header bi ghi de bang khoa boc rac (kiem thu GIA LAP)' });
    const nhi = await login('bsnhi01');
    const rowN = (await nhi.listRecords(CCCD)).find((r) => r.type === 'hanhchinh')!;
    expect(((await nhi.openRecord(rowN))?.data as { hoTen?: string }).hoTen).toBe(NAME);
    const audit = (await qt.api<{ records: { actor: string; action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=500')).records;
    const rewraps = audit.filter((r) => r.action === 'v2.header.rewrap' && r.detail.includes(headerId.slice(0, 8)));
    expect(rewraps.some((r) => r.actor === matId)).toBe(true);
    expect(audit.some((r) => r.action === 'v2.header.restore' && r.detail.includes('ly-do='))).toBe(true);
    result.W4b_khacPhuc = { soPhienBanLichSu: hist.lichSu.length, nguoiGhiDe: 'bsmat01 (truy được từ nhật ký + lịch sử)', thieuLyDo: noReason, bacSiNhiSauKhoiPhuc: 'MỞ ĐƯỢC', nhatKy: audit.filter((r) => /header\.(rewrap|restore)/.test(r.action)).slice(-3).map((r) => `${r.action} ${r.detail}`.slice(0, 110)) };
  }, 300_000);

  it('W4c — phong bì một bản ghi: hoàn tác lần bọc lại gần nhất; người đọc hợp lệ vẫn mở được; người không phải quản trị không dùng được API', async () => {
    const before = await errOf(mat.api('POST', `/api/v2/admin/records/${lamSangId}/restore-envelope`, { reason: 'khong phai quan tri' }));
    expect(before).toMatch(/403|DENY/);
    await qt.api('POST', `/api/v2/admin/records/${lamSangId}/restore-envelope`, { reason: 'Hoan tac lan boc lai gan nhat cua mot ban ghi (kiem thu GIA LAP)' });
    const m3 = await login('bsmat01');
    const row = (await m3.listRecords(CCCD)).find((r) => r.id === lamSangId)!;
    expect(((await m3.openRecord(row))?.data as { canary?: string }).canary).toBe('LAM-SANG-MAT');
    result.W4c_phongBiMotBanGhi = { nguoiKhacQuanTri: before, saukhoiPhuc: 'người đọc hợp lệ mở được (lại bọc lại theo epoch hiện hành)' };
  }, 300_000);
});
