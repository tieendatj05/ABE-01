// NGHIỆM THU XÁC THỰC HAI LỚP (TOTP) CHO QUẢN TRỊ trên hệ thống thật (Spring HTTPS + 3 nút). DỮ LIỆU GIẢ. Cần jar: (cd security/storage && ./mvnw -DskipTests package).
// Máy chủ chạy với MEDABE_RESEARCH_ADMIN_MFA=true (thời hạn 1 phút để thử hết hạn).
//  A. Chưa nhập mã: MỌI việc quản trị (tài khoản, lịch, nhật ký, máy) bị chặn 428; nhân viên thường không bị ảnh hưởng.
//  B. Đăng ký (nhập lại mật khẩu) → xác nhận mã → quản trị mở khoá; mã sai bị từ chối; MFA tính THEO PHIÊN; hết hạn thì khoá lại.
//  C. Mất điện thoại: đặt lại MFA của một quản trị cần quản trị KHÁC duyệt (không tự duyệt được); xong thì đăng ký lại.
//  D. Khôi phục cục bộ (biến môi trường lúc khởi động máy chủ) cũng xoá MFA; quản trị khác không bị ảnh hưởng.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { totpCode } from '../research/totp.js';
import { MedClient } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
let S: ResearchStack;
const login = (u: string, p = pw(u), newPassword?: string, stack: ResearchStack = S) => MedClient.signIn(stack.baseUrl, u, p, new MemoryDeviceKeyStore(), { fetch: stack.fetch, newPassword });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ADMIN_URLS = ['/api/v2/admin/users', '/api/v2/admin/schedule', '/api/v2/admin/audit?limit=5', '/api/v2/admin/devices'];

/** Đăng ký MFA (nhập lại mật khẩu) và xác nhận bằng mã đầu tiên. Trả về bí mật TOTP. */
async function enroll(c: MedClient, password: string): Promise<string> {
  const { secret } = await c.mfaEnroll(password);
  await verify(c, secret, true);
  return secret;
}
/** Nhập mã 6 số; mỗi mã chỉ dùng một lần nên khi trùng bước thì dùng bước kế (máy chủ chấp nhận lệch ±1) hoặc chờ sang bước mới. */
async function verify(c: MedClient, secret: string, first = false): Promise<void> {
  for (const [off, wait] of (first ? [[0, 0], [1, 0]] : [[1, 0], [0, 31_000], [1, 0]]) as [number, number][]) {
    if (wait) await sleep(wait);
    try { await c.mfaVerify(totpCode(secret, Math.floor(Date.now() / 1000), off)); return; }
    catch (e) { if (!/MFA_CODE_REUSED|MFA_CODE_INVALID/.test((e as Error).message)) throw e; }
  }
  throw new Error('không vượt được MFA');
}

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true, env: { MEDABE_RESEARCH_ADMIN_MFA: 'true', MEDABE_RESEARCH_ADMIN_MFA_FRESH_MINUTES: '1' } });
}, 300_000);
afterAll(async () => { await S?.stop(); });

describe.skipIf(!JAR)('A. Chưa nhập mã thì chưa quản trị được', () => {
  it('quản trị đăng nhập được nhưng trạng thái = bắt buộc MFA, chưa đăng ký, chưa xác thực; MỌI việc quản trị bị chặn 428', async () => {
    const qt = await login('quantri01');
    expect(await qt.mfaStatus()).toMatchObject({ required: true, enrolled: false, verified: false, freshMinutes: 1 });
    for (const u of ADMIN_URLS) await expect(qt.api('GET', u), u).rejects.toThrow(/MFA_REQUIRED/);
    await expect(qt.api('POST', '/api/v2/admin/users', { username: 'khong.duoc@x.vn', role: 'TIEP_DON', displayName: 'x' })).rejects.toThrow(/MFA_REQUIRED/);   // cả thao tác ghi
  }, 300_000);

  it('nhân viên thường không bị ảnh hưởng (không bắt MFA)', async () => {
    const td = await login('tiepdon01');
    expect(await td.mfaStatus()).toMatchObject({ required: false });
    expect(await td.api('GET', '/api/v2/auth/me')).toBeTruthy();
  }, 300_000);
});

describe.skipIf(!JAR)('B. Đăng ký, xác thực, theo phiên, hết hạn', () => {
  let secret1 = '';
  it('đăng ký sai mật khẩu bị từ chối; mã sai bị từ chối; đúng thì mở khoá toàn bộ việc quản trị', async () => {
    const qt = await login('quantri01');
    await expect(qt.mfaEnroll('mat-khau-sai-12345')).rejects.toThrow(/STEP_UP_FAILED/);
    const { secret } = await qt.mfaEnroll(pw('quantri01'));
    secret1 = secret;
    await expect(qt.mfaVerify('000000')).rejects.toThrow(/MFA_CODE_INVALID/);
    await verify(qt, secret, true);
    expect(await qt.mfaStatus()).toMatchObject({ enrolled: true, verified: true });
    for (const u of ADMIN_URLS) expect(await qt.api('GET', u), u).toBeTruthy();
  }, 300_000);

  it('MFA tính THEO PHIÊN: đăng nhập lại (máy mới) thì lại bị chặn cho đến khi nhập mã; mã đã dùng không dùng lại được', async () => {
    const again = await login('quantri01');
    expect(await again.mfaStatus()).toMatchObject({ enrolled: true, verified: false });
    await expect(again.api('GET', '/api/v2/admin/users')).rejects.toThrow(/MFA_REQUIRED/);
    await verify(again, secret1);
    expect(await again.api('GET', '/api/v2/admin/users')).toBeTruthy();
    await expect(again.mfaVerify(totpCode(secret1, Math.floor(Date.now() / 1000), 1))).rejects.toThrow(/MFA_CODE_REUSED|MFA_CODE_INVALID/);   // chống phát lại
  }, 400_000);

  it('hết hạn (1 phút): màn quản trị khoá lại và phải nhập lại mã', async () => {
    const c = await login('quantri01');
    await verify(c, secret1);
    expect(await c.api('GET', '/api/v2/admin/users')).toBeTruthy();
    await sleep(65_000);
    await expect(c.api('GET', '/api/v2/admin/users')).rejects.toThrow(/MFA_REQUIRED/);
    expect(await c.mfaStatus()).toMatchObject({ verified: false });
  }, 400_000);
});

describe.skipIf(!JAR)('C. Mất điện thoại: đặt lại MFA cần quản trị KHÁC duyệt', () => {
  it('quản trị A đặt lại MFA của B ⇒ B chờ duyệt (không đăng nhập được); A không tự duyệt; quản trị thứ ba duyệt xong thì B đăng ký lại', async () => {
    const qt2 = await login('quantri02');
    await enroll(qt2, pw('quantri02'));
    const target = (await qt2.api<{ userId: string; username: string }[]>('GET', '/api/v2/admin/users')).find((u) => u.username === 'quantri01')!;
    const r = await qt2.api<{ status: string }>('POST', `/api/v2/admin/users/${target.userId}/mfa-reset`, {});
    expect(r.status).toBe('PENDING_APPROVAL');
    await expect(login('quantri01')).rejects.toThrow(/DENY_PENDING_APPROVAL/);
    await expect(qt2.api('POST', `/api/v2/admin/users/${target.userId}/approve`, {})).rejects.toThrow(/DENY_SELF_APPROVAL|403/);   // người yêu cầu không tự duyệt
    // quản trị thứ ba (do quantri02 tạo) duyệt
    const made = await qt2.api<{ temporaryPassword: string }>('POST', '/api/v2/admin/users', { username: 'quantri03', role: 'QUAN_TRI', displayName: 'Quan tri 3' });
    const qt3 = await login('quantri03', made.temporaryPassword, 'QuanTri03-MatKhau-2026');
    await enroll(qt3, 'QuanTri03-MatKhau-2026');
    await qt3.api('POST', `/api/v2/admin/users/${target.userId}/approve`, {});
    const back = await login('quantri01');                                          // mật khẩu cũ vẫn dùng được, MFA cũ đã bị xoá
    expect(await back.mfaStatus()).toMatchObject({ enrolled: false, verified: false });
    await expect(back.api('GET', '/api/v2/admin/users')).rejects.toThrow(/MFA_REQUIRED/);
    await enroll(back, pw('quantri01'));                                            // đăng ký lại bằng điện thoại mới
    expect(await back.api('GET', '/api/v2/admin/users')).toBeTruthy();
  }, 600_000);
});

describe.skipIf(!JAR)('D. Khôi phục cục bộ cũng xoá MFA của đúng tài khoản được khôi phục', () => {
  it('đã đăng ký MFA → khởi động lại máy chủ với biến khôi phục: quantri01 mất MFA (đăng ký lại), quantri02 vẫn còn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'medabe-mfa-rec-'));
    const persist = { dbUrl: `jdbc:h2:file:${join(dir, 'db').replace(/\\/g, '/')}`, serviceToken: 'a'.repeat(32), kek: 'b'.repeat(64), adminToken: 'c'.repeat(32), siemToken: 'd'.repeat(32) };
    const env = { MEDABE_RESEARCH_ADMIN_MFA: 'true' };
    const S1 = await startResearchStack({ dataDir: dir, passwordIterations: 20000, legacyBridge: true, persist, env });
    try {
      const a = await login('quantri01', pw('quantri01'), undefined, S1), b = await login('quantri02', pw('quantri02'), undefined, S1);
      await enroll(a, pw('quantri01')); await enroll(b, pw('quantri02'));
      await sleep(2000);                                                              // H2 ghi xuống đĩa trễ ~0,5 giây: chờ rồi mới tắt (tắt cứng ngay sẽ mất bản ghi cuối)
    } finally { await S1.stop(); }
    await sleep(3000);
    const tmp = 'KhoiPhucMFA2026ab';
    const S2 = await startResearchStack({ dataDir: dir, passwordIterations: 20000, legacyBridge: true, persist, env: { ...env, MEDABE_RESEARCH_RECOVER_ADMIN: `quantri01|${tmp}` } });
    try {
      const rec = await login('quantri01', tmp, 'QuanTri01-Moi-Sau-Khoi-Phuc', S2);
      expect(await rec.mfaStatus()).toMatchObject({ enrolled: false });               // MFA cũ bị xoá: phải đăng ký lại
      const other = await login('quantri02', pw('quantri02'), undefined, S2);
      expect(await other.mfaStatus()).toMatchObject({ enrolled: true });              // quản trị khác không bị ảnh hưởng
    } finally { await S2.stop(); }
  }, 600_000);
});
