// NGHIỆM THU KHÔI PHỤC MẬT KHẨU trên hệ thống thật (Spring HTTPS + 3 nút cấp khoá). DỮ LIỆU GIẢ. Cần jar: (cd security/storage && ./mvnw -DskipTests package).
//  A. "Quên mật khẩu" (chưa đăng nhập): luôn cùng một phản hồi dù email có/không tồn tại (không dò được tài khoản); mỗi người tối đa một yêu cầu mở; tài khoản bị khoá bị bỏ qua;
//     yêu cầu chỉ hiện cho Quản trị, không chứa bí mật nào.
//  B. Quản trị xác minh rồi cấp mật khẩu TẠM: buộc đổi ở lần đăng nhập đầu, mật khẩu cũ chết, phiên cũ bị thu hồi, DỮ LIỆU CŨ vẫn đọc được (khoá cấp theo tài khoản, không phụ thuộc mật khẩu);
//     quản trị không tự cấp cho chính mình; từ chối được; yêu cầu đã xử lý không xử lý lại; nhật ký không chứa mật khẩu.
//  C. Chống lạm dụng: tối đa 10 yêu cầu/phút/địa chỉ.
//  D. Khôi phục CỤC BỘ tài khoản Quản trị duy nhất (đặt biến môi trường lúc khởi động máy chủ): mật khẩu cũ chết, mật khẩu tạm bắt buộc đổi.
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { fakePatients } from '../research/fake-data.js';
import { PasswordChangeRequiredError } from '../research/client.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { MedClient } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [A] = fakePatients(1, 4242);
const UNIT = 'TRUONG-A';
let S: ResearchStack;
const login = (u: string, p = pw(u), newPassword?: string) => MedClient.signIn(S.baseUrl, u, p, new MemoryDeviceKeyStore(), { fetch: S.fetch, newPassword });
const forgot = (username: string) => S.fetch(S.baseUrl + '/api/v2/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username }) });
type Req = { id: string; userId: string; username: string; displayName: string; role: string };
let qt1: MedClient, qt2: MedClient, td: MedClient, nl: MedClient;
const open = () => qt1.api<Req[]>('GET', '/api/v2/admin/password-requests');
const users = () => qt1.api<{ userId: string; username: string; status: string }[]>('GET', '/api/v2/admin/users');

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
  [qt1, qt2, td, nl] = await Promise.all(['quantri01', 'quantri02', 'tiepdon01', 'nhaplieu01'].map((u) => login(u)));
  await td.saveMany([{ patientCode: A.hanhchinh.cccd, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: A.hanhchinh.hoTen, cccd: A.hanhchinh.cccd, canary: A.hanhchinh.canary }, group: UNIT }]);
}, 300_000);
afterAll(async () => { await S?.stop(); });

describe.skipIf(!JAR)('A. Gửi yêu cầu "Quên mật khẩu" (chưa đăng nhập)', () => {
  it('email không tồn tại và email có thật cho cùng một phản hồi; chỉ email có thật tạo yêu cầu; gửi lại không tạo thêm', async () => {
    const unknown = await forgot('khong.co.nguoi.nay@congty.vn');
    const known = await forgot('tiepdon01');
    const again = await forgot('TiepDon01');                      // chữ hoa/thường không quan trọng
    expect([unknown.status, known.status, again.status]).toEqual([200, 200, 200]);
    expect(await unknown.json()).toEqual(await known.json());       // không phân biệt được tài khoản có tồn tại hay không
    const list = await open();
    expect(list.map((r) => r.username)).toEqual(['tiepdon01']);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|passwordSalt|token|secret/i);
  }, 120_000);

  it('chỉ Quản trị xem/xử lý được danh sách yêu cầu (nhân viên thường bị từ chối)', async () => {
    await expect(td.api('GET', '/api/v2/admin/password-requests')).rejects.toThrow(/403|DENY|PERMISSION/i);
    const id = (await open())[0].id;
    await expect(nl.api('POST', `/api/v2/admin/password-requests/${id}/fulfill`, {})).rejects.toThrow(/403|DENY|PERMISSION/i);
    expect((await open()).length).toBe(1);                          // chưa ai xử lý
  }, 120_000);

  it('tài khoản đang bị khoá không tạo được yêu cầu', async () => {
    const ktv = (await users()).find((u) => u.username === 'ktv01')!;
    await qt1.api('PUT', `/api/v2/admin/users/${ktv.userId}`, { status: 'DISABLED' });
    expect((await forgot('ktv01')).status).toBe(200);
    expect((await open()).some((r) => r.username === 'ktv01')).toBe(false);
  }, 120_000);
});

describe.skipIf(!JAR)('B. Quản trị cấp mật khẩu tạm', () => {
  let temp = '';
  it('cấp mật khẩu tạm: buộc đổi mật khẩu ở lần đăng nhập đầu; mật khẩu cũ chết; phiên cũ bị thu hồi', async () => {
    const r = (await open()).find((x) => x.username === 'tiepdon01')!;
    temp = (await qt2.api<{ temporaryPassword: string }>('POST', `/api/v2/admin/password-requests/${r.id}/fulfill`, {})).temporaryPassword;
    expect(temp).toMatch(/^[A-Za-z0-9]{12,}$/);
    await expect(td.api('GET', '/api/v2/auth/me')).rejects.toThrow();                                       // phiên cũ bị đăng xuất
    await expect(login('tiepdon01', pw('tiepdon01'))).rejects.toThrow(/BAD_CREDENTIALS/);                   // mật khẩu cũ không còn dùng được
    await expect(login('tiepdon01', temp)).rejects.toBeInstanceOf(PasswordChangeRequiredError);             // mật khẩu tạm: bắt buộc tự đặt mật khẩu mới
  }, 300_000);

  it('đặt mật khẩu mới xong: đăng nhập được, vẫn đọc được hồ sơ do chính mình nhập TRƯỚC khi quên mật khẩu (dữ liệu không mất)', async () => {
    const fresh = await login('tiepdon01', temp, 'MatKhauMoi-Cua-Toi-2026');
    const rows = await fresh.listGroup(UNIT);
    const opened = (await fresh.openMany(rows)).map((o) => (o?.data as { canary?: string } | undefined)?.canary);
    expect(opened).toContain(A.hanhchinh.canary);
    await expect(login('tiepdon01', temp)).rejects.toThrow(/BAD_CREDENTIALS/);                              // mật khẩu tạm dùng xong là hết hiệu lực
  }, 300_000);

  it('yêu cầu đã xử lý biến mất khỏi danh sách và không xử lý lại được; nhật ký ghi sự kiện nhưng KHÔNG chứa mật khẩu', async () => {
    expect((await open()).some((r) => r.username === 'tiepdon01')).toBe(false);
    await expect(qt2.api('POST', '/api/v2/admin/password-requests/pr-khong-ton-tai/fulfill', {})).rejects.toThrow(/404|REQUEST_NOT_FOUND/);
    const audit = JSON.stringify((await qt1.api<{ records: unknown[] }>('GET', '/api/v2/admin/audit?limit=1000')).records);
    expect(audit).toContain('v2.password-request.done');
    expect(audit).toContain('v2.password-request"');
    expect(audit).not.toContain(temp);
  }, 120_000);

  it('quản trị quên mật khẩu: KHÔNG tự cấp cho chính mình, phải nhờ quản trị khác', async () => {
    expect((await forgot('quantri01')).status).toBe(200);
    const r = (await open()).find((x) => x.username === 'quantri01')!;
    await expect(qt1.api('POST', `/api/v2/admin/password-requests/${r.id}/fulfill`, {})).rejects.toThrow(/403|DENY_SELF_FULFILL/);
    const t = (await qt2.api<{ temporaryPassword: string }>('POST', `/api/v2/admin/password-requests/${r.id}/fulfill`, {})).temporaryPassword;
    await expect(login('quantri01', pw('quantri01'))).rejects.toThrow(/BAD_CREDENTIALS/);
    const me = await login('quantri01', t, 'QuanTri-MatKhau-Moi-2026');
    qt1 = me;                                                                                                  // phiên cũ của quantri01 đã bị thu hồi khi cấp mật khẩu tạm: các bước sau dùng phiên mới
    expect(await me.api('GET', '/api/v2/admin/users')).toBeTruthy();                                         // quản trị mới vào lại được và dùng được
  }, 300_000);

  it('từ chối yêu cầu: không đổi mật khẩu của ai', async () => {
    expect((await forgot('nhaplieu02')).status).toBe(200);
    const r = (await open()).find((x) => x.username === 'nhaplieu02')!;
    await qt2.api('POST', `/api/v2/admin/password-requests/${r.id}/reject`, {});
    expect((await open()).some((x) => x.username === 'nhaplieu02')).toBe(false);
    expect(await login('nhaplieu02')).toBeTruthy();                                                          // mật khẩu cũ của nhaplieu02 vẫn dùng được
    await expect(qt2.api('POST', `/api/v2/admin/password-requests/${r.id}/fulfill`, {})).rejects.toThrow(/409|REQUEST_NOT_OPEN/);
  }, 300_000);
});

describe.skipIf(!JAR)('C. Chống lạm dụng', () => {
  it('quá 10 yêu cầu/phút từ một địa chỉ bị chặn (429); không tạo thêm yêu cầu nào ngoài của tài khoản thật', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await forgot(`gia-mao-${i}@congty.vn`)).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(10);                       // hạn mức là 10 yêu cầu/phút/địa chỉ (các bước trước đã dùng một phần)
    expect((await open()).every((r) => !r.username.startsWith('gia-mao'))).toBe(true);
  }, 300_000);
});

describe.skipIf(!JAR)('D. Khôi phục cục bộ tài khoản Quản trị (đặt biến môi trường khi khởi động máy chủ)', () => {
  it('mật khẩu cũ của quản trị chết; mật khẩu tạm bắt buộc đổi; sau đó quản trị dùng lại bình thường', async () => {
    const tmp = 'KhoiPhucTam2026ab';
    const S2 = await startResearchStack({ passwordIterations: 20000, legacyBridge: true, env: { MEDABE_RESEARCH_RECOVER_ADMIN: `quantri01|${tmp}` } });
    try {
      const l = (u: string, p: string, np?: string) => MedClient.signIn(S2.baseUrl, u, p, new MemoryDeviceKeyStore(), { fetch: S2.fetch, newPassword: np });
      await expect(l('quantri01', pw('quantri01'))).rejects.toThrow(/BAD_CREDENTIALS/);
      await expect(l('quantri01', tmp)).rejects.toBeInstanceOf(PasswordChangeRequiredError);
      const a = await l('quantri01', tmp, 'QuanTri-Sau-Khoi-Phuc-2026');
      expect(await a.api('GET', '/api/v2/admin/users')).toBeTruthy();
      expect(await l('quantri02', pw('quantri02'))).toBeTruthy();                                            // quản trị khác không bị ảnh hưởng
      const audit = JSON.stringify((await a.api<{ records: unknown[] }>('GET', '/api/v2/admin/audit?limit=1000')).records);
      expect(audit).toContain('v2.password-recover-local');
      expect(audit).not.toContain(tmp);
    } finally { await S2.stop(); }
  }, 400_000);
});
