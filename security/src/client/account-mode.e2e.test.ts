// APP NHÂN VIÊN CŨ chạy bằng TÀI KHOẢN: kiểm thử chính MedClient (thư viện mà Exam/Import/Danh sách/Báo cáo dùng) trên hệ thống thật —
// backend Spring HTTPS ở chế độ "cầu nối" (/api/records, /api/headers dùng phiên tài khoản + kiểm quyền) + 3 nút cấp khoá cấp theo vé.
// Cần jar: (cd security/storage && ./mvnw -DskipTests package).
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encrypt } from '../abe/rw15.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { fakePatients } from '../research/fake-data.js';
import { PasswordChangeRequiredError, ApiError } from '../research/client.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { BusinessHoursError, MedClient, SessionExpiredError } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const author = (c: MedClient) => `MED:Author:${c.s.account!.userId}`;           // thuộc tính tác giả CỦA CHÍNH tài khoản
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const ps = fakePatients(4, 99);
const GROUP = 'TRUONG-A';
let S: ResearchStack;
let td: MedClient, nhi: MedClient, mat: MedClient, qt: MedClient;
const login = (u: string, p = pw(u), opts: { newPassword?: string } = {}) => MedClient.signIn(S.baseUrl, u, p, new MemoryDeviceKeyStore(), { fetch: S.fetch, ...opts });
const raw = (c: MedClient, path: string, init: RequestInit = {}) => S.fetch(S.baseUrl + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${c.s.token}`, ...(init.headers as Record<string, string>) } });
const setSchedule = async (open: boolean) => {
  const cur = await qt.api<{ version: number }>('GET', '/api/v2/admin/schedule');
  const days = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, open ? { open: '00:00', close: '23:59' } : { closed: true }]));
  await qt.api('PUT', '/api/v2/admin/schedule', { expectedVersion: cur.version, days, reason: 'kiem thu app nhan vien' });
};

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
  [td, nhi, mat, qt] = await Promise.all([login('tiepdon01'), login('bsnhi01'), login('bsmat01'), login('quantri01')]);
}, 300_000);
afterAll(async () => { await S?.stop(); });

describe.skipIf(!JAR)('app nhân viên cũ dùng TÀI KHOẢN (MedClient chế độ tài khoản)', () => {
  it('đăng nhập: danh tính, vai trò, khoa, thuộc tính do backend quyết định; khoá chỉ mục được cấp tự động', () => {
    expect(td.s.account).toMatchObject({ role: 'TIEP_DON' }); expect(nhi.s.account).toMatchObject({ role: 'BAC_SI', khoa: 'Nhi' });
    expect(td.s.attrs.sort()).toEqual([author(td), 'MED:Role:TiepDon'].sort());
    expect(nhi.s.attrs.sort()).toEqual([author(nhi), 'MED:Khoa:Nhi', 'MED:Role:BacSi'].sort());
    expect(qt.s.attrs).toEqual([]);                                   // Quản trị không có thuộc tính ABE nào
    expect(td.s.indexKey).toMatch(/^[0-9a-f]{64}$/); expect(qt.s.indexKey).toBe('');
    expect(new Set([td.s.gid, nhi.s.gid, mat.s.gid]).size).toBe(3);
  });

  it('Tiếp đón import Hành chính theo lô (header chung) và liệt kê theo đơn vị; ai có quyền mở được và thấy đúng người ký', async () => {
    const ids = await td.saveMany(ps.map((p) => ({ patientCode: p.code, type: 'hanhchinh' as const, khoa: 'KSK', data: { hoTen: p.hanhchinh.hoTen, cccd: p.hanhchinh.cccd, canary: p.hanhchinh.canary }, group: GROUP })));
    expect(ids).toHaveLength(4);
    const rows = await td.listGroup(GROUP);
    expect(rows).toHaveLength(4);
    const opened = await td.openMany(rows);
    expect(opened.every((o) => o && o.signatureValid && o.author.userId === td.s.account!.userId)).toBe(true);
    expect(JSON.stringify(opened.map((o) => o!.data))).toContain(ps[0].hanhchinh.canary);
    const asDoctor = await nhi.openMany(await nhi.listGroup(GROUP));       // bác sĩ cũng đọc được Hành chính (cùng header chung)
    expect(asDoctor.every((o) => o && o.signatureValid)).toBe(true);
    expect((await qt.listGroup(GROUP).catch((e: Error) => e.message))).toMatch(/khoá chỉ mục/);   // Quản trị không tính nổi chỉ mục nhóm
  }, 300_000);

  it('bác sĩ ghi lâm sàng đúng khoa; người khoa khác / Tiếp đón / Quản trị KHÔNG được liệt kê dòng đó và không nhận được bản mã', async () => {
    await nhi.saveRecord({ patientCode: ps[0].code, type: 'lamsang', khoa: 'Nhi', data: { ketLuan: ps[0].lamsangNhi.canary } });
    await mat.saveRecord({ patientCode: ps[0].code, type: 'lamsang', khoa: 'Mat', data: { ketLuan: ps[0].lamsangMat.canary } });
    const byType = (rows: { type: string; khoa: string; envelope: unknown }[], t: string, k: string) => rows.find((r) => r.type === t && r.khoa === k)!;
    const asNhi = await nhi.listRecords(ps[0].code);
    expect((await nhi.openRecord(byType(asNhi, 'lamsang', 'Nhi') as never))?.data).toMatchObject({ ketLuan: ps[0].lamsangNhi.canary });
    expect(asNhi.find((r) => r.khoa === 'Mat')).toBeUndefined();                                      // dòng khoa Mắt KHÔNG hiện ra (không lộ sự tồn tại của khoa khác)
    expect(JSON.stringify(asNhi)).not.toContain(ps[0].lamsangMat.canary);
    const asTd = await td.listRecords(ps[0].code);
    expect((await td.openRecord(byType(asTd, 'hanhchinh', 'KSK') as never))?.data).toMatchObject({ canary: ps[0].hanhchinh.canary });
    expect(asTd.map((r) => r.type)).toEqual(['hanhchinh']);                                          // Tiếp đón chỉ thấy Hành chính
    // Quản trị gọi thẳng API với chỉ mục thật: không có dòng nào; đọc theo id bị từ chối
    const idx = nhi.patientIdx(ps[0].code);
    const adminRows = (await (await raw(qt, `/api/records?patientIdx=${idx}`)).json()) as { id: string }[];
    expect(adminRows).toEqual([]);
    const matId = (await mat.listRecords(ps[0].code)).find((r) => r.khoa === 'Mat')!.id;
    expect((await raw(qt, `/api/records/${matId}`)).status).toBe(403);
    expect((await raw(nhi, `/api/records/${matId}`)).status).toBe(403);                              // biết mã bản ghi cũng không đọc được
  }, 300_000);

  it('quyền GHI do backend quyết định, báo mã lý do; không ghi được bản mã có policy yếu hơn ma trận; đăng ký thiết bị cũ đã đóng', async () => {
    await expect(mat.saveRecord({ patientCode: ps[1].code, type: 'lamsang', khoa: 'Nhi', data: {} })).rejects.toThrow(/DENY_KHOA_MISMATCH/);
    await expect(td.saveRecord({ patientCode: ps[1].code, type: 'lamsang', khoa: 'Nhi', data: {} })).rejects.toThrow(/DENY_ROLE_NOT_ALLOWED/);
    await expect(nhi.saveMany([{ patientCode: ps[1].code, type: 'hanhchinh', khoa: 'KSK', data: {}, group: GROUP }])).rejects.toThrow(/DENY_ROLE_NOT_ALLOWED/);
    await expect(td.saveRecord({ patientCode: ps[1].code, type: 'ketluan', khoa: 'KSK', data: {} })).rejects.toThrow(/DENY_ROLE_NOT_ALLOWED/);
    // người dùng hợp lệ dùng máy khách sửa đổi: mã hoá lâm sàng Nhi với policy có thêm nhánh Tiếp đón
    const cfg = await nhi.config(); const dir = await nhi.epochs(); const v = (a: string) => `${a}#${dir.tag}.0`;
    const id = crypto.randomUUID(); const patientIdx = nhi.patientIdx(ps[1].code);
    const weak = await encrypt({ MED: cfg.pk }, `${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Nhi')} OR ${v('MED:Role:TiepDon')}`, new TextEncoder().encode('{}'), `${patientIdx}|lamsang|${id}`);
    const r = await raw(nhi, '/api/records', { method: 'POST', body: JSON.stringify({ id, patientIdx, type: 'lamsang', khoa: 'Nhi', authorDevice: nhi.s.deviceId, envelope: weak }) });
    expect(r.status).toBe(403); expect(((await r.json()) as { error: string }).error).toBe('POLICY_MISMATCH');
    expect((await S.fetch(`${S.baseUrl}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'may la', devicePub: '04' + '00'.repeat(64) }) })).status).toBe(410);
    expect((await S.fetch(`${S.baseUrl}/api/records?patientIdx=${'a'.repeat(32)}`)).status).toBe(401);          // không có phiên: không vào
  }, 300_000);

  it('email do công ty cấp: admin tạo (mật khẩu tạm), nhân viên tự đổi ở lần đầu; vai trò Kết luận KHÔNG đọc mọi khoa (chỉ khoa được cấp) nhưng ghi được Kết luận', async () => {
    const made = await qt.api<{ username: string; temporaryPassword: string }>('POST', '/api/v2/admin/users', { username: 'Bac.Si.KetLuan@CongTy.vn', displayName: 'BS Ket luan', role: 'KET_LUAN', khoa: 'khám chung' });                // tên hiển thị -> mã KSK
    expect(made.username).toBe('bac.si.ketluan@congty.vn');
    await expect(login(made.username, made.temporaryPassword)).rejects.toBeInstanceOf(PasswordChangeRequiredError);
    const kl = await login('BAC.SI.KETLUAN@congty.vn', made.temporaryPassword, { newPassword: 'MatKhau-KetLuan-1' });       // không phân biệt hoa/thường
    expect(kl.s.attrs.sort()).toEqual([author(kl), 'MED:Khoa:KSK', 'MED:Role:BacSi', 'MED:Role:KetLuan'].sort());
    const rows = await kl.listRecords(ps[0].code);
    const opened = await kl.openMany(rows);
    expect(opened.filter(Boolean).length).toBe(1);                                                       // CHỈ Hành chính: Kết luận không còn đọc mọi khoa (Nhi/Mắt không hiện)
    expect(rows.map((r) => r.type)).toEqual(['hanhchinh']);
    await kl.saveRecord({ patientCode: ps[0].code, type: 'ketluan', khoa: 'KSK', data: { ketLuan: 'Du suc khoe (gia)' } });
    expect((await nhi.openMany(await nhi.listRecords(ps[0].code))).filter(Boolean).length).toBe(2);      // bác sĩ Nhi: Hành chính + Nhi (Kết luận thuộc khoa KSK, không đọc Mắt)
    expect((await kl.openMany(await kl.listRecords(ps[0].code))).filter(Boolean).length).toBe(2);        // người ghi Kết luận đọc lại mục mình ghi (tác giả) + Hành chính
    await expect(login(made.username, made.temporaryPassword)).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });   // mật khẩu tạm đã vô hiệu
    // KTV: ghi cận lâm sàng; Tiếp đón không đọc được
    const ktv = await qt.api<{ username: string; temporaryPassword: string }>('POST', '/api/v2/admin/users', { username: 'ktv@congty.vn', role: 'KTV' });
    const k = await login(ktv.username, ktv.temporaryPassword, { newPassword: 'MatKhau-KTV-2026' });
    expect(k.s.attrs.sort()).toEqual([author(k), 'MED:Khoa:XetNghiem', 'MED:Role:KTV'].sort());
    await k.saveRecord({ patientCode: ps[0].code, type: 'canlamsang', khoa: 'XetNghiem', data: { hb: 130 } });
    expect((await td.openMany(await td.listRecords(ps[0].code))).filter(Boolean).length).toBe(1);          // Tiếp đón chỉ còn Hành chính
  }, 300_000);

  it('NGOÀI GIỜ: kết nối vẫn "sống" (không mất dữ liệu đang nhập) nhưng đọc/ghi/xin khoá bị chặn; mở cửa lại dùng tiếp; khóa tài khoản thì phiên chết', async () => {
    await setSchedule(false);
    await expect(nhi.checkConnection()).resolves.toBeUndefined();             // KHÔNG ném lỗi: đóng cửa ≠ mất kết nối (giao diện không được gỡ màn hình đang nhập)
    expect(nhi.business).toMatchObject({ open: false });
    expect(Object.keys(nhi.s.keys)).toHaveLength(0);                          // đã bỏ khoá khỏi bộ nhớ (nỗ lực tốt nhất)
    await expect(nhi.saveRecord({ patientCode: ps[2].code, type: 'lamsang', khoa: 'Nhi', data: {} })).rejects.toBeInstanceOf(BusinessHoursError);
    await expect(nhi.listRecords(ps[0].code)).rejects.toBeInstanceOf(BusinessHoursError);
    await expect(td.saveMany([{ patientCode: ps[2].code, type: 'hanhchinh', khoa: 'KSK', data: {}, group: GROUP }])).rejects.toBeInstanceOf(BusinessHoursError);
    expect((await raw(nhi, `/api/records?patientIdx=${'a'.repeat(32)}`)).status).toBe(423);
    await setSchedule(true);
    await nhi.checkConnection();
    expect(nhi.business?.open).toBe(true);
    expect((await nhi.openMany(await nhi.listRecords(ps[0].code))).filter(Boolean).length).toBeGreaterThanOrEqual(2);   // dùng tiếp, lấy lại khoá
    // khóa tài khoản: lần kiểm tra kế tiếp báo phiên hết hiệu lực
    const users = await qt.api<{ userId: string; username: string }[]>('GET', '/api/v2/admin/users');
    await qt.api('PUT', `/api/v2/admin/users/${users.find((u) => u.username === 'bsmat01')!.userId}`, { status: 'DISABLED' });
    await expect(mat.checkConnection()).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(login('bsmat01')).rejects.toBeInstanceOf(ApiError);
  }, 300_000);

  it('thiết bị lưu trong trình duyệt đã bị thu hồi (DEVICE_PROOF_INVALID): đăng nhập lại tự bỏ khoá cũ và đăng ký như máy mới, KHÔNG cần xoá dữ liệu trình duyệt', async () => {
    const store = new MemoryDeviceKeyStore();
    const first = await MedClient.signIn(S.baseUrl, 'bsnhi01', pw('bsnhi01'), store, { fetch: S.fetch });
    const oldDevice = first.s.deviceId;
    await qt.api('POST', `/api/v2/admin/devices/${oldDevice}/revoke`, {});                 // quản trị thu hồi thiết bị này (như dọn thiết bị khi gặp DEVICE_LIMIT)
    const again = await MedClient.signIn(S.baseUrl, 'bsnhi01', pw('bsnhi01'), store, { fetch: S.fetch });
    expect(again.s.deviceId).not.toBe(oldDevice);                                        // đã đăng ký thiết bị mới
    expect((await store.get('bsnhi01'))?.deviceId).toBe(again.s.deviceId);               // và lưu khoá mới thay khoá cũ
    expect(again.s.account).toMatchObject({ role: 'BAC_SI', khoa: 'Nhi' });              // quyền không đổi
    await expect(MedClient.signIn(S.baseUrl, 'bsnhi01', 'sai-mat-khau-hoan-toan', store, { fetch: S.fetch })).rejects.toBeInstanceOf(ApiError);   // sai mật khẩu vẫn bị từ chối, không đăng ký thêm thiết bị
  }, 300_000);
});
