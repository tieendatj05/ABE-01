import { describe, expect, it } from 'vitest';
import type { Hardware } from '../../security/src/hardware.js';
import { AdminVault, BASE_LOCK_MS, IDLE_MS, MAX_ATTEMPTS, PACKAGE_PREFIX, VaultError, checkPasswordStrength, type Attempts, type VaultEnv } from './adminvault.js';

const HW: Hardware = { cpu: 'CPU-AAA', board: 'BOARD-AAA', bios: 'BIOS-AAA', disk: 'DISK-AAA', macs: [], host: 'MAY-QUAN-TRI' };
const bundle = { storage: 'S'.repeat(32), nodes: { BenhVien: 'B'.repeat(32), SoYTe: 'Y'.repeat(32), DienThoai: 'D'.repeat(32) }, approver: 'A'.repeat(32) };
const PKG = PACKAGE_PREFIX + Buffer.from(JSON.stringify(bundle)).toString('base64');
const PW = 'Quan-tri-2026!x';

/** Môi trường giả: "đĩa" trong bộ nhớ, "DPAPI" đánh dấu bằng tiền tố, đồng hồ điều khiển được, phần cứng thay đổi được. */
function makeEnv(init: { hw?: Hardware } = {}) {
  const s = { blob: null as Buffer | null, attempts: { n: 0, lockouts: 0, until: 0 } as Attempts, t: 1_000_000, hw: init.hw ?? HW, log: [] as string[], osOwner: 'user1' };
  const env: VaultEnv = {
    read: () => s.blob,
    write: (b) => { s.blob = b; },
    remove: () => { s.blob = null; },
    seal: (p) => Buffer.from(`${s.osOwner}|${p}`),
    unseal: (b) => { const [o, ...rest] = b.toString().split('|'); if (o !== s.osOwner) throw new Error('khác tài khoản'); return rest.join('|'); },
    readAttempts: () => ({ ...s.attempts }),
    writeAttempts: (a) => { s.attempts = { ...a }; },
    hardware: async () => s.hw,
    matchHw: (a, b) => a.cpu === b.cpu && a.board === b.board,
    now: () => s.t,
    audit: (l) => s.log.push(l),
  };
  return { s, env };
}
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof VaultError ? e.code : String(e); } };

describe('trạm quản trị: kích hoạt và mật khẩu', () => {
  it('máy chưa kích hoạt: không có kho, không mở được', async () => {
    const { env } = makeEnv();
    const v = new AdminVault(env);
    expect((await v.status()).enrolled).toBe(false);
    expect(await code(v.unlock(PW))).toBe('NOT_ENROLLED');
    expect(() => v.use()).toThrow(/mở khoá/);
  });

  it('kích hoạt: yêu cầu mật khẩu mạnh và gói hợp lệ; token không nằm rõ trong file', async () => {
    const { s, env } = makeEnv();
    const v = new AdminVault(env);
    expect(await code(v.enroll(PKG, 'ngan'))).toBe('WEAK_PASSWORD');
    expect(await code(v.enroll(PKG, 'aaaaaaaaaaaa'))).toBe('WEAK_PASSWORD');
    expect(await code(v.enroll('rac', PW))).toBe('BAD_PACKAGE');
    expect(await code(v.enroll(PACKAGE_BAD(), PW))).toBe('BAD_PACKAGE');
    await v.enroll(PKG, PW);
    expect((await v.status()).enrolled).toBe(true);
    expect(s.blob!.toString('latin1')).not.toContain('S'.repeat(32));          // token không lộ trong file lưu trên đĩa
    expect(await code(v.enroll(PKG, PW))).toBe('ALREADY_ENROLLED');
  });

  it('mở khoá bằng đúng mật khẩu; sai mật khẩu bị từ chối và bị đếm', async () => {
    const { env } = makeEnv();
    const v = new AdminVault(env);
    await v.enroll(PKG, PW);
    expect(await code(v.unlock('sai-mat-khau-1'))).toBe('BAD_PASSWORD');
    await v.unlock(PW);
    expect(v.use()).toEqual(bundle);
    v.lock();
    expect(() => v.use()).toThrow();
  });

  it('sai 5 lần thì KHOÁ; khoá tăng gấp đôi mỗi đợt; đúng mật khẩu cũng không vào được khi đang khoá', async () => {
    const { s, env } = makeEnv();
    const v = new AdminVault(env);
    await v.enroll(PKG, PW);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) expect(await code(v.unlock('sai-' + i + '-xxxxxx'))).toBe('BAD_PASSWORD');
    expect(await code(v.unlock('sai-cuoi-xxxx'))).toBe('LOCKED');
    expect(await code(v.unlock(PW))).toBe('LOCKED');                              // kẻ dò không biết lúc nào đã đoán trúng
    s.t += BASE_LOCK_MS - 1;
    expect(await code(v.unlock(PW))).toBe('LOCKED');
    s.t += 2;                                                                      // hết đợt khoá đầu (15 phút)
    for (let i = 0; i < MAX_ATTEMPTS; i++) await code(v.unlock('sai-lai-' + i + '-xx'));
    expect(s.attempts.until - s.t).toBe(BASE_LOCK_MS * 2);                         // đợt 2: 30 phút
    s.t += BASE_LOCK_MS * 2 + 1;
    await v.unlock(PW);                                                            // hết khoá: đúng mật khẩu thì vào được
    expect(v.use()).toEqual(bundle);
  });

  it('trạng thái đếm lưu ra đĩa: tạo lại đối tượng (tắt/mở app) không xoá được khoá', async () => {
    const { s, env } = makeEnv();
    const v1 = new AdminVault(env);
    await v1.enroll(PKG, PW);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await code(v1.unlock('sai-' + i + '-xxxxxxx'));
    const v2 = new AdminVault(env);                                               // "mở lại app"
    expect(await code(v2.unlock(PW))).toBe('LOCKED');
    expect((await v2.status()).lockedUntil).toBeGreaterThan(s.t);
  });

  it('tự khoá sau 5 phút không dùng; mỗi lần dùng làm mới đồng hồ', async () => {
    const { s, env } = makeEnv();
    const v = new AdminVault(env);
    await v.enroll(PKG, PW);
    await v.unlock(PW);
    s.t += IDLE_MS - 1000; v.use();
    s.t += IDLE_MS - 1000; v.use();                                               // vẫn còn mở vì có hoạt động
    s.t += IDLE_MS + 1;
    expect(() => v.use()).toThrow(/mở khoá/);
    expect((await v.status()).unlocked).toBe(false);
  });
});

describe('trạm quản trị: buộc máy', () => {
  it('chép kho sang MÁY KHÁC (phần cứng khác): coi như không tồn tại -> menu quản trị không hiện', async () => {
    const a = makeEnv();
    await new AdminVault(a.env).enroll(PKG, PW);
    const b = makeEnv({ hw: { ...HW, cpu: 'CPU-KHAC', board: 'BOARD-KHAC' } });
    b.s.blob = a.s.blob;                                                          // kẻ gian chép nguyên file
    const v = new AdminVault(b.env);
    expect((await v.status()).enrolled).toBe(false);
    expect(await code(v.unlock(PW))).toBe('NOT_ENROLLED');                        // có cả mật khẩu cũng vô ích
  });

  it('chép sang tài khoản Windows khác (DPAPI khác): không mở được', async () => {
    const a = makeEnv();
    await new AdminVault(a.env).enroll(PKG, PW);
    const b = makeEnv();
    b.s.blob = a.s.blob; b.s.osOwner = 'user2';
    expect((await new AdminVault(b.env).status()).enrolled).toBe(false);
  });
});

describe('đổi mật khẩu / gỡ kích hoạt', () => {
  it('đổi mật khẩu: mật khẩu cũ hết hiệu lực; mật khẩu yếu bị từ chối', async () => {
    const { env } = makeEnv();
    const v = new AdminVault(env);
    await v.enroll(PKG, PW);
    expect(await code(v.changePassword(PW, 'yeu'))).toBe('WEAK_PASSWORD');
    await v.changePassword(PW, 'Mat-khau-moi-2027#');
    v.lock();
    expect(await code(v.unlock(PW))).toBe('BAD_PASSWORD');
    await v.unlock('Mat-khau-moi-2027#');
    expect(v.use()).toEqual(bundle);
  });

  it('gỡ kích hoạt cần đúng mật khẩu', async () => {
    const { env } = makeEnv();
    const v = new AdminVault(env);
    await v.enroll(PKG, PW);
    expect(await code(v.reset('sai-mat-khau-9'))).toBe('BAD_PASSWORD');
    await v.reset(PW);
    expect((await v.status()).enrolled).toBe(false);
  });

  it('kiểm tra độ mạnh mật khẩu', () => {
    expect(checkPasswordStrength('Abcdef12345')).toBeNull();
    expect(checkPasswordStrength('short1!')).not.toBeNull();
    expect(checkPasswordStrength('onlyletterslong')).not.toBeNull();
    expect(checkPasswordStrength('1111111111')).not.toBeNull();
  });
});

function PACKAGE_BAD() { return PACKAGE_PREFIX + Buffer.from(JSON.stringify({ storage: 'x' })).toString('base64'); }
