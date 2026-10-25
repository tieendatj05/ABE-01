// Kho khoá của TRẠM QUẢN TRỊ (chạy trong tiến trình chính; giao diện không bao giờ thấy token).
//  - Token quản trị (registry + 3 nút + mã duyệt) được mã hoá bằng khoá dẫn xuất từ MẬT KHẨU QUẢN TRỊ (scrypt -> AES-256-GCM),
//    rồi bọc thêm một lớp bằng kho khoá hệ điều hành (DPAPI): cần ĐÚNG tài khoản Windows + ĐÚNG máy + ĐÚNG mật khẩu.
//  - Buộc phần cứng: chép file sang máy khác thì kho coi như KHÔNG TỒN TẠI (menu quản trị không hiện ra).
//  - Chống dò mật khẩu: sai 5 lần thì khoá, thời gian khoá tăng gấp đôi mỗi đợt (15 phút, 30 phút, ... tối đa 24 giờ); trạng thái đếm
//    được lưu ra đĩa nên tắt/mở lại app không xoá được.
//  - Tự khoá sau 5 phút không dùng; token chỉ nằm trong bộ nhớ của tiến trình chính khi đang mở khoá.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Hardware } from '../../security/src/hardware.js';

export interface AdminBundle { storage: string; nodes: Record<string, string>; approver: string }
export interface Attempts { n: number; lockouts: number; until: number }

export interface VaultEnv {
  read(): Buffer | null;
  write(b: Buffer): void;
  remove(): void;
  seal(plain: string): Buffer;            // kho khoá hệ điều hành (DPAPI)
  unseal(b: Buffer): string;              // ném lỗi nếu khác tài khoản/máy
  readAttempts(): Attempts;
  writeAttempts(a: Attempts): void;
  hardware(): Promise<Hardware>;
  matchHw(stored: Hardware, current: Hardware): boolean;
  now(): number;
  audit(line: string): void;
}

export const PACKAGE_PREFIX = 'MEDABE-ADMIN1:';
export const MAX_ATTEMPTS = 5;
export const BASE_LOCK_MS = 15 * 60_000;
export const MAX_LOCK_MS = 24 * 3600_000;
export const IDLE_MS = 5 * 60_000;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

interface Blob { v: 1; hw: Hardware; salt: string; iv: string; ct: string }

export class VaultError extends Error {
  constructor(public code: 'BAD_PASSWORD' | 'LOCKED' | 'NOT_ENROLLED' | 'ALREADY_ENROLLED' | 'WEAK_PASSWORD' | 'BAD_PACKAGE' | 'NOT_UNLOCKED', msg: string, public lockedUntil = 0, public attemptsLeft = 0) {
    super(msg);
  }
}

/** Mật khẩu quản trị: >= 10 ký tự, có chữ và số (hoặc ký tự đặc biệt), không phải chuỗi lặp. */
export function checkPasswordStrength(p: string): string | null {
  if (p.length < 10) return 'Mật khẩu quản trị tối thiểu 10 ký tự';
  if (!/[A-Za-zÀ-ỹ]/.test(p) || !/[\d\W_]/.test(p)) return 'Mật khẩu cần có cả chữ và số hoặc ký tự đặc biệt';
  if (new Set(p).size < 5) return 'Mật khẩu quá đơn điệu';
  return null;
}

const keyOf = (password: string, salt: Buffer) => scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);

function encrypt(key: Buffer, data: string): { iv: Buffer; ct: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(data, 'utf8'), c.final(), c.getAuthTag()]);
  return { iv, ct };
}
function decrypt(key: Buffer, iv: Buffer, ct: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8');
}

export function parsePackage(pkg: string): AdminBundle {
  const t = pkg.trim();
  if (!t.startsWith(PACKAGE_PREFIX)) throw new VaultError('BAD_PACKAGE', 'Gói kích hoạt không đúng định dạng');
  try {
    const b = JSON.parse(Buffer.from(t.slice(PACKAGE_PREFIX.length), 'base64').toString('utf8')) as AdminBundle;
    if (typeof b.storage !== 'string' || typeof b.approver !== 'string' || !b.nodes || Object.values(b.nodes).some((x) => typeof x !== 'string' || x.length < 16) || b.storage.length < 16) throw new Error();
    return b;
  } catch {
    throw new VaultError('BAD_PACKAGE', 'Gói kích hoạt hỏng hoặc không đầy đủ');
  }
}

export class AdminVault {
  private session: { bundle: AdminBundle; lastUse: number } | null = null;
  constructor(private env: VaultEnv) {}

  /** Đọc blob nếu có VÀ mở được bằng kho OS VÀ đúng phần cứng; ngược lại coi như chưa kích hoạt (giao diện sẽ không hiện menu quản trị). */
  private async load(): Promise<Blob | null> {
    const raw = this.env.read();
    if (!raw) return null;
    try {
      const blob = JSON.parse(this.env.unseal(raw)) as Blob;
      return this.env.matchHw(blob.hw, await this.env.hardware()) ? blob : null;
    } catch {
      return null;
    }
  }

  async status(): Promise<{ enrolled: boolean; unlocked: boolean; lockedUntil: number; attemptsLeft: number }> {
    const a = this.env.readAttempts();
    this.expire();
    return { enrolled: !!(await this.load()), unlocked: !!this.session, lockedUntil: a.until > this.env.now() ? a.until : 0, attemptsLeft: Math.max(0, MAX_ATTEMPTS - a.n) };
  }

  async enroll(pkg: string, password: string): Promise<void> {
    if (await this.load()) throw new VaultError('ALREADY_ENROLLED', 'Máy này đã là trạm quản trị. Cần xoá kích hoạt trước.');
    const weak = checkPasswordStrength(password);
    if (weak) throw new VaultError('WEAK_PASSWORD', weak);
    const bundle = parsePackage(pkg);
    const salt = randomBytes(16);
    const { iv, ct } = encrypt(keyOf(password, salt), JSON.stringify(bundle));
    const blob: Blob = { v: 1, hw: await this.env.hardware(), salt: salt.toString('hex'), iv: iv.toString('hex'), ct: ct.toString('hex') };
    this.env.write(this.env.seal(JSON.stringify(blob)));
    this.env.writeAttempts({ n: 0, lockouts: 0, until: 0 });
    this.env.audit('ENROLL: máy này được kích hoạt làm trạm quản trị');
  }

  async unlock(password: string): Promise<void> {
    const now = this.env.now();
    const a = this.env.readAttempts();
    if (a.until > now) throw new VaultError('LOCKED', `Đã khoá do nhập sai nhiều lần. Thử lại sau ${Math.ceil((a.until - now) / 60_000)} phút.`, a.until, 0);
    const blob = await this.load();
    if (!blob) throw new VaultError('NOT_ENROLLED', 'Máy này chưa phải trạm quản trị');
    try {
      const bundle = JSON.parse(decrypt(keyOf(password, Buffer.from(blob.salt, 'hex')), Buffer.from(blob.iv, 'hex'), Buffer.from(blob.ct, 'hex'))) as AdminBundle;
      this.env.writeAttempts({ n: 0, lockouts: a.lockouts, until: 0 });
      this.session = { bundle, lastUse: now };
      this.env.audit('UNLOCK: mở khoá quản trị thành công');
    } catch {
      const n = a.n + 1;
      if (n >= MAX_ATTEMPTS) {
        const ms = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** a.lockouts);
        this.env.writeAttempts({ n: 0, lockouts: a.lockouts + 1, until: now + ms });
        this.env.audit(`UNLOCK_FAILED: sai ${MAX_ATTEMPTS} lần, khoá ${Math.round(ms / 60_000)} phút`);
        throw new VaultError('LOCKED', `Sai mật khẩu ${MAX_ATTEMPTS} lần. Khoá ${Math.round(ms / 60_000)} phút.`, now + ms, 0);
      }
      this.env.writeAttempts({ n, lockouts: a.lockouts, until: 0 });
      this.env.audit(`UNLOCK_FAILED: sai mật khẩu (${n}/${MAX_ATTEMPTS})`);
      throw new VaultError('BAD_PASSWORD', `Sai mật khẩu. Còn ${MAX_ATTEMPTS - n} lần thử.`, 0, MAX_ATTEMPTS - n);
    }
  }

  private expire() {
    if (this.session && this.env.now() - this.session.lastUse > IDLE_MS) { this.session = null; this.env.audit('LOCK: tự khoá do không dùng'); }
  }

  /** Lấy token để gọi máy chủ (chỉ tiến trình chính); mỗi lần dùng làm mới đồng hồ không-hoạt-động. */
  use(): AdminBundle {
    this.expire();
    if (!this.session) throw new VaultError('NOT_UNLOCKED', 'Cần mở khoá quản trị bằng mật khẩu');
    this.session.lastUse = this.env.now();
    return this.session.bundle;
  }

  lock() { if (this.session) this.env.audit('LOCK: khoá thủ công'); this.session = null; }

  async changePassword(oldPw: string, newPw: string): Promise<void> {
    const weak = checkPasswordStrength(newPw);
    if (weak) throw new VaultError('WEAK_PASSWORD', weak);
    await this.unlock(oldPw);
    const blob = (await this.load())!;
    const salt = randomBytes(16);
    const { iv, ct } = encrypt(keyOf(newPw, salt), JSON.stringify(this.use()));
    this.env.write(this.env.seal(JSON.stringify({ ...blob, salt: salt.toString('hex'), iv: iv.toString('hex'), ct: ct.toString('hex') } satisfies Blob)));
    this.env.audit('PASSWORD_CHANGED');
  }

  /** Gỡ kích hoạt trạm quản trị (cần mật khẩu). */
  async reset(password: string): Promise<void> {
    await this.unlock(password);
    this.env.remove();
    this.session = null;
    this.env.audit('RESET: gỡ kích hoạt trạm quản trị');
  }
}
