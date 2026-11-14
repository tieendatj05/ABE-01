// NGHIỆM THU VAI TRÒ GIÁM SÁT (đọc tất cả, không ghi, không quản trị) trên hệ thống thật: backend Spring HTTPS + 3 nút cấp khoá + MedClient.
// DỮ LIỆU GIẢ. Cần jar: (cd security/storage && ./mvnw -DskipTests package).
//  A. Đọc & giải mã MỌI thứ (hành chính, lâm sàng nhiều khoa, ảnh gốc + vùng) của bản ghi mới; không ghi/xoá được; Quản trị vẫn không đọc được.
//  B. Hạn chế: bắt buộc LÝ DO mỗi lần đọc (ghi nhật ký), cảnh báo đọc bất thường, 1 thiết bị, không truy cập qua đường hầm Internet.
//  C. Cấp tài khoản cần QUẢN TRỊ KHÁC duyệt; mật khẩu dài; người yêu cầu không tự duyệt được.
//  M. MFA (TOTP) là THUỘC TÍNH ABE: chính sách Giám sát = Role:GiamSat AND Auth:MFA; chưa xác thực thì không có thuộc tính => không mở được; chống đoán mò/dùng lại mã.
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { PHANTOM, encodePng, makePhantom } from '../research/fake-image.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { totpCode } from '../research/totp.js';
import { versioned } from '../common/epoch.js';
import { listImages, openImage, saveImage } from './imaging.js';
import { MedClient } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [A] = fakePatients(1, 777);
const cccd = A.hanhchinh.cccd;
const REASON = 'Kiểm tra tuân thủ quý 4 theo yêu cầu thanh tra';
let S: ResearchStack;
const login = (u: string, p = pw(u)) => MedClient.signIn(S.baseUrl, u, p, new MemoryDeviceKeyStore(), { fetch: S.fetch });
const raw = (token: string, path: string, init: RequestInit = {}) => S.fetch(S.baseUrl + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) } });
const errOf = async (r: Response) => ((await r.json()) as { error?: string }).error;
let nl: MedClient, td: MedClient, mat: MedClient, gs: MedClient, qt1: MedClient, qt2: MedClient;
const auditText = async () => JSON.stringify((await qt1.api<{ records: unknown[] }>('GET', '/api/v2/admin/audit?limit=1000')).records);

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true, env: { MEDABE_PROXY_CLIENT_HEADER: 'X-Medabe-Client-IP' } });
  [nl, td, mat, gs, qt1, qt2] = await Promise.all(['nhaplieu01', 'tiepdon01', 'bsmat01', 'giamsat01', 'quantri01', 'quantri02'].map((u) => login(u)));
}, 300_000);
afterAll(async () => { await S?.stop(); });

let gsSecret = '';
describe.skipIf(!JAR)('M. MFA (TOTP) là thuộc tính ABE của vai trò Giám sát', () => {
  it('trước khi xác thực: chưa có thuộc tính MED:Auth:MFA; trạng thái = bắt buộc, chưa đăng ký, chưa xác thực', async () => {
    expect(gs.s.attrs).not.toContain('MED:Auth:MFA');
    expect(await gs.mfaStatus()).toMatchObject({ required: true, enrolled: false, verified: false, freshMinutes: 10 });
  }, 300_000);

  it('chưa xác thực MFA: dù có lý do, máy chủ từ chối đọc (428 MFA_REQUIRED); xin khoá cho thuộc tính MFA bị từ chối', async () => {
    gs.accessReason = REASON;
    await expect(gs.listRecords(cccd)).rejects.toThrow(/MFA_REQUIRED/);
    const dir = await gs.epochs();
    const t = await raw(gs.s.token, '/api/v2/keys/ticket', { method: 'POST', body: JSON.stringify({ attrs: [versioned('MED:Auth:MFA', dir)] }) });
    expect([t.status, await errOf(t)]).toEqual([403, 'DENY_NO_ENTITLED_ATTRIBUTES']);
  }, 300_000);

  it('đăng ký MFA cần nhập lại mật khẩu; vai trò không bắt buộc MFA không đăng ký được', async () => {
    await expect(gs.mfaEnroll('Sai-mat-khau-123456')).rejects.toThrow(/STEP_UP_FAILED/);
    await expect(mat.mfaEnroll(pw('bsmat01'))).rejects.toThrow(/MFA_NOT_AVAILABLE_FOR_ROLE/);
    const e = await gs.mfaEnroll(pw('giamsat01'));
    expect(e.uri).toMatch(/^otpauth:\/\/totp\/MedABE:giamsat01.*secret=[A-Z2-7]{32}.*digits=6.*period=30/);
    expect(e.secret).toMatch(/^[A-Z2-7]{32}$/);
    gsSecret = e.secret;
    expect((await gs.mfaStatus()).enrolled).toBe(false);                        // chưa có hiệu lực cho đến khi nhập đúng mã đầu tiên
  }, 300_000);

  it('mã sai bị từ chối; mã đúng được nhận; dùng lại CÙNG mã bị từ chối (chống phát lại)', async () => {
    await expect(gs.mfaVerify('000000')).rejects.toThrow(/MFA_CODE_INVALID/);
    const code = totpCode(gsSecret);
    await gs.mfaVerify(code);
    await expect(gs.mfaVerify(code)).rejects.toThrow(/MFA_CODE_REUSED/);
    expect(await gs.mfaStatus()).toMatchObject({ required: true, enrolled: true, verified: true });
    expect(gs.s.attrs).toContain('MED:Auth:MFA');
  }, 300_000);

  it('bí mật TOTP không nằm dạng rõ trong dữ liệu máy chủ trả về (danh sách tài khoản của quản trị)', async () => {
    const users = JSON.stringify(await qt1.api('GET', '/api/v2/admin/users'));
    expect(users).not.toContain(gsSecret);
    expect(users.toLowerCase()).not.toContain('totp');
  }, 300_000);
});

describe.skipIf(!JAR)('A. Giám sát đọc được mọi thứ nhưng không ghi được', () => {
  it('thuộc tính: MED:Role:GiamSat + Auth:MFA (sau xác thực) + Author của chính mình; không có khoa; Quản trị vẫn không có thuộc tính nào', () => {
    expect(gs.s.attrs.sort()).toEqual([`MED:Author:${gs.s.account!.userId}`, 'MED:Auth:MFA', 'MED:Role:GiamSat'].sort());
    expect(qt1.s.attrs).toEqual([]); expect(qt2.s.attrs).toEqual([]);
  });

  it('người nhập + tiếp đón + bác sĩ nhập dữ liệu mới (hành chính, lâm sàng Mắt và Nhi, ảnh nhiều vùng)', async () => {
    await td.saveRecord({ patientCode: cccd, type: 'hanhchinh', khoa: 'KSK', data: { ...A.hanhchinh, hoTen: 'BENH NHAN GIA' } });
    await nl.saveRecord({ patientCode: cccd, type: 'lamsang', khoa: 'Mat', data: { mat: 'binh thuong' } });
    await nl.saveRecord({ patientCode: cccd, type: 'lamsang', khoa: 'Nhi', data: { nhi: 'binh thuong' } });
    await saveImage(nl, { patientCode: cccd, original: { mime: 'image/png', bytes: encodePng(makePhantom(0)) }, pixels: makePhantom(0), modality: 'MRI',
      regions: [{ rect: PHANTOM.mat, khoas: ['Mat'] }, { rect: PHANTOM.nhiTmh, khoas: ['Nhi', 'TMH'] }] });
  }, 300_000);

  it('Giám sát (có lý do) nhận và GIẢI MÃ được tất cả: hành chính, lâm sàng Mắt + Nhi, ảnh gốc nguyên vẹn + mọi vùng; không có mục nào bị ẩn', async () => {
    gs.accessReason = REASON;
    const rows = await gs.listRecords(cccd);
    expect(rows.map((r) => `${r.type}:${r.khoa}`).sort()).toEqual(['anh:KSK', 'hanhchinh:KSK', 'lamsang:Mat', 'lamsang:Nhi', 'vung:Mat', 'vung:Nhi,TMH']);
    expect(gs.restrictedCount(cccd)).toBe(0);
    const opened = (await gs.openMany(rows.filter((r) => r.type !== 'anh' && r.type !== 'vung'))).filter(Boolean);
    expect(opened).toHaveLength(3);
    const v = (await openImage(gs, (await listImages(gs, cccd))[0].rows))!;
    expect(v.limited).toBe(false); expect(v.original).toBeDefined(); expect(v.regions).toHaveLength(2); expect(v.tampered).toBe(0);
    // bác sĩ Mắt (so sánh): KHÔNG thấy lâm sàng Nhi, ảnh gốc, vùng Nhi/TMH
    const m = await mat.listRecords(cccd);
    expect(m.map((r) => `${r.type}:${r.khoa}`).sort()).toEqual(['hanhchinh:KSK', 'lamsang:Mat', 'vung:Mat']);
  }, 300_000);

  it('Giám sát KHÔNG ghi được bất kỳ loại nào và không xoá được dữ liệu của người khác', async () => {
    for (const type of ['hanhchinh', 'lamsang', 'canlamsang', 'ketluan'] as const)
      await expect(gs.saveRecord({ patientCode: cccd, type, khoa: type === 'hanhchinh' ? 'KSK' : 'Mat', data: { x: 1 } })).rejects.toThrow(/DENY_ROLE_NOT_ALLOWED/);
    await expect(saveImage(gs, { patientCode: cccd, original: { mime: 'image/png', bytes: encodePng(makePhantom(0)) }, pixels: makePhantom(0), regions: [] })).rejects.toThrow(/DENY_ROLE_NOT_ALLOWED/);
    const some = (await gs.listRecords(cccd))[0];
    await expect(gs.deleteRecord(some.id)).rejects.toThrow(/DENY_NOT_AUTHOR/);
  }, 300_000);

  it('Quản trị (cả hai tài khoản) vẫn KHÔNG tra được hồ sơ nào', async () => {
    for (const q of [qt1, qt2]) await expect(q.listRecords(cccd)).rejects.toThrow(/khoá chỉ mục/);
  }, 300_000);
});

describe.skipIf(!JAR)('B. Hạn chế nâng cao của Giám sát', () => {
  it('thiếu lý do thì máy chủ từ chối (428) và KHÔNG trả bản mã; lý do quá ngắn cũng bị từ chối', async () => {
    gs.accessReason = '';
    await expect(gs.listRecords(cccd)).rejects.toThrow(/ACCESS_REASON_REQUIRED/);
    gs.accessReason = 'ngan';
    await expect(gs.listRecords(cccd)).rejects.toThrow(/ACCESS_REASON_REQUIRED/);
    mat.accessReason = '';
    expect((await mat.listRecords(cccd)).length).toBeGreaterThan(0);             // vai trò thường không bị bắt buộc
  }, 300_000);

  it('lý do (kể cả tiếng Việt có dấu) được ghi vào nhật ký cùng đối tượng đọc; nhật ký toàn vẹn', async () => {
    gs.accessReason = REASON;
    await gs.listRecords(cccd);
    const audit = await qt1.api<{ chain: { ok: boolean }; records: { action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=1000');
    const hit = audit.records.filter((r) => r.action === 'v2.giamsat.read');
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((r) => r.detail.includes(REASON) && /patientIdx=[0-9a-f]{8}/.test(r.detail))).toBe(true);
    expect(audit.chain.ok).toBe(true);
    expect(JSON.stringify(audit.records)).toMatch(/ACCESS_REASON_REQUIRED/);    // lần bị từ chối cũng được ghi
  }, 300_000);

  it('đọc dồn dập (>=40 lần trong 10 phút) phát cảnh báo bất thường riêng', async () => {
    gs.accessReason = REASON;
    for (let i = 0; i < 45; i++) await gs.listRecords(cccd);
    expect(await auditText()).toContain('v2.giamsat.anomaly');
  }, 300_000);

  it('chỉ MỘT thiết bị: đăng ký thiết bị thứ hai bị từ chối DEVICE_LIMIT', async () => {
    await expect(login('giamsat01')).rejects.toThrow(/DEVICE_LIMIT/);
  }, 300_000);

  it('KHÔNG truy cập qua đường hầm Internet: yêu cầu có header IP khách của cổng tin cậy bị chặn 403, vai trò thường không bị ảnh hưởng', async () => {
    const via = { 'X-Medabe-Client-IP': '203.0.113.9' };
    const r = await raw(gs.s.token, '/api/records?patientIdx=' + gs.patientIdx(cccd), { headers: { ...via, 'x-access-reason': encodeURIComponent(REASON) } });
    expect([r.status, await errOf(r)]).toEqual([403, 'DENY_REMOTE_ACCESS']);
    const ok = await raw(nl.s.token, '/api/records?patientIdx=' + nl.patientIdx(cccd), { headers: via });
    expect(ok.status).toBe(200);
    // đăng nhập qua đường hầm cũng bị chặn (và phiên vừa tạo bị thu hồi)
    const lg = await S.fetch(`${S.baseUrl}/api/v2/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...via }, body: JSON.stringify({ username: 'giamsat01', password: pw('giamsat01') }) });
    expect([lg.status, await errOf(lg)]).toEqual([403, 'DENY_REMOTE_ACCESS']);
  }, 300_000);
});

describe.skipIf(!JAR)('C. Cấp tài khoản Giám sát cần QUẢN TRỊ KHÁC duyệt', () => {
  let newId = '', newUser = '', temp = '';
  const create = (admin: MedClient, body: Record<string, unknown>) => raw(admin.s.token, '/api/v2/admin/users', { method: 'POST', body: JSON.stringify(body) });

  it('mật khẩu Giám sát phải >= 14 ký tự; để trống thì hệ thống sinh mật khẩu tạm dài hơn', async () => {
    const weak = await create(qt1, { username: 'gs.yeu@congty.vn', role: 'GIAM_SAT', displayName: 'GS', password: 'Abc12345678' });
    expect([weak.status, ((await weak.json()) as { error?: string; message?: string }).error ?? '']).toEqual([400, expect.stringContaining('PASSWORD_WEAK')]);
    const ok = await create(qt1, { username: 'gs.moi@congty.vn', role: 'GIAM_SAT', displayName: 'GS moi' });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { userId: string; username: string; status: string; requestedBy: string; temporaryPassword: string };
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(body.status).toBe('PENDING_APPROVAL'); expect(body.requestedBy).toBe(qt1.s.account!.userId);
    newId = body.userId; newUser = body.username; temp = body.temporaryPassword;
  }, 300_000);

  it('chưa duyệt thì KHÔNG đăng nhập được; "mở khoá" không lách được; người yêu cầu không tự duyệt được', async () => {
    const lg = () => S.fetch(`${S.baseUrl}/api/v2/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: newUser, password: temp }) });
    let r = await lg(); expect([r.status, await errOf(r)]).toEqual([403, 'DENY_PENDING_APPROVAL']);
    r = await raw(qt1.s.token, `/api/v2/admin/users/${newId}`, { method: 'PUT', body: JSON.stringify({ status: 'ACTIVE' }) });
    expect([r.status, await errOf(r)]).toEqual([409, 'USE_APPROVAL']);
    r = await raw(qt1.s.token, `/api/v2/admin/users/${newId}/approve`, { method: 'POST', body: '{}' });
    expect([r.status, await errOf(r)]).toEqual([403, 'DENY_SELF_APPROVAL']);
  }, 300_000);

  it('quản trị KHÁC duyệt thì tài khoản dùng được; duyệt được ghi nhật ký; duyệt lần hai bị từ chối', async () => {
    let r = await raw(qt2.s.token, `/api/v2/admin/users/${newId}/approve`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { status: string }).status).toBe('ACTIVE');
    const lg = await S.fetch(`${S.baseUrl}/api/v2/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: newUser, password: temp }) });
    expect(lg.status).toBe(200);
    expect(await auditText()).toContain('v2.privileged.approve');
    r = await raw(qt2.s.token, `/api/v2/admin/users/${newId}/approve`, { method: 'POST', body: '{}' });
    expect([r.status, await errOf(r)]).toEqual([409, 'NOT_PENDING']);
  }, 300_000);

  it('cấp lại mật khẩu tạm cho Giám sát (admin nhìn thấy mật khẩu) lại thành "chờ duyệt"; vai trò thường không bị ảnh hưởng', async () => {
    let r = await raw(qt1.s.token, `/api/v2/admin/users/${newId}/reset-password`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(200);
    const users = (await (await raw(qt1.s.token, '/api/v2/admin/users')).json()) as { userId: string; status: string }[];
    expect(users.find((u) => u.userId === newId)!.status).toBe('PENDING_APPROVAL');
    const bs = await create(qt1, { username: 'bs.thuong@congty.vn', role: 'BAC_SI', khoa: 'Nhi', displayName: 'BS thuong' });
    expect(((await bs.json()) as { status: string }).status).toBe('ACTIVE');
  }, 300_000);
});

describe.skipIf(!JAR)('M2. MFA được ép bằng MẬT MÃ (không chỉ ở cổng đăng nhập)', () => {
  it('bản mã Giám sát mở được khi có thuộc tính MFA; bỏ thuộc tính MFA khỏi phiên thì KHÔNG giải mã được dù đã có khoá Role:GiamSat', async () => {
    gs.accessReason = REASON;
    const rows = (await gs.listRecords(cccd)).filter((r) => r.type === 'lamsang');
    expect(rows.length).toBeGreaterThan(0);
    expect((await gs.openRecord(rows[0]))?.signatureValid).toBe(true);
    // mô phỏng phiên KHÔNG có thuộc tính MFA: xoá khoá trong bộ nhớ + bỏ thuộc tính MFA khỏi danh sách (máy chủ cũng sẽ không cấp khoá cho nó)
    const saved = [...gs.s.attrs];
    gs.resetKeys();
    gs.s.attrs = saved.filter((a) => a !== 'MED:Auth:MFA');
    let opened: unknown = 'chua-thu';
    try { opened = await gs.openRecord(rows[0]); } catch { opened = null; }
    expect(opened).toBeNull();                                                      // có Role:GiamSat nhưng thiếu Auth:MFA => không đủ để giải mã
    gs.s.attrs = saved;
    expect((await gs.openRecord(rows[0]))?.signatureValid).toBe(true);              // có lại thuộc tính MFA => mở được
  }, 300_000);

  it('Quản trị đặt lại MFA của Giám sát: xoá bí mật, thu hồi phiên, tài khoản thành "chờ duyệt" (quản trị khác phải duyệt); nhật ký ghi lại', async () => {
    const id = gs.s.account!.userId;
    const r = await raw(qt1.s.token, `/api/v2/admin/users/${id}/mfa-reset`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; requestedBy: string };
    expect(body.status).toBe('PENDING_APPROVAL'); expect(body.requestedBy).toBe(qt1.s.account!.userId);
    const dead = await raw(gs.s.token, '/api/v2/auth/mfa');
    expect(dead.status).toBe(401);                                                  // phiên đang mở bị thu hồi
    const self = await raw(qt1.s.token, `/api/v2/admin/users/${id}/approve`, { method: 'POST', body: '{}' });
    expect([self.status, await errOf(self)]).toEqual([403, 'DENY_SELF_APPROVAL']);
    expect((await raw(qt2.s.token, `/api/v2/admin/users/${id}/approve`, { method: 'POST', body: '{}' })).status).toBe(200);
    expect(await auditText()).toContain('v2.mfa.reset');
    const bad = await raw(qt1.s.token, `/api/v2/admin/users/${mat.s.account!.userId}/mfa-reset`, { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);                                                   // vai trò thường không có MFA để đặt lại
  }, 300_000);
});
