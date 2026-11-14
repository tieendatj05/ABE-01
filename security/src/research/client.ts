// Máy khách luồng nghiên cứu: MỘT giao diện, HAI chế độ đối chứng.
//   baseline : gửi bản rõ qua HTTPS; backend ABAC rồi mã hoá khi lưu (KEK máy chủ) và tự giải mã khi trả về.
//   abe      : mã hoá AES-256-GCM tại máy; CP-ABE bọc khoá theo policy của mục; backend chỉ giữ phong bì, không có khoá.
// Cùng tài khoản, cùng phiên đăng nhập (kèm chứng minh sở hữu khoá thiết bị), cùng chữ ký cá nhân, cùng kiểm tra quyền ở backend.
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { leavesOf, parsePolicy } from '../abe/policy.js';
import { combineKey, decrypt, encrypt, type AttrKey, type AuthorityPublic, type Envelope, type Partial } from '../abe/rw15.js';
import { parseVersioned, versioned, type EpochDirectory } from '../common/epoch.js';
import { nodeUrl } from '../client/connection.js';
import { newSignKey, signHex, type DeviceKeyStore, type LocalDevice } from './keys.js';
import { LOGIN_DOMAIN, POLICY_DOMAIN, SIG_DOMAIN, TICKET_DOMAIN, sha256Hex, verifyRecord, type Manifest, type SignatureCheck, type SignedRecordView } from './verify.js';

export type Mode = 'baseline' | 'abe';
export type SectionKey = 'hanhchinh' | 'lamsang.Nhi' | 'lamsang.Mat';
export const SECTIONS: SectionKey[] = ['hanhchinh', 'lamsang.Nhi', 'lamsang.Mat'];

export interface Status {
  now: string; zone: string; businessOpen: boolean; scheduleVersion: number; closesAt: string | null; nextOpenAt: string | null;
  policyVersion: string; networkZone: string | null; registryPk: string; afterHoursAllowed: string[];
}
export interface Me {
  userId: string; username: string; displayName: string; role: 'TIEP_DON' | 'BAC_SI' | 'QUAN_TRI'; khoa: string | null; status: string; gid: string;
  deviceId: string | null; sessionId: string; networkZone: string | null; expiresAt: string; attributes?: string[]; mustChangePassword?: boolean;
}
export interface PolicyDoc {
  version: string; hash: string; abePolicies: Record<SectionKey, string>;
  matrix: { sections: Record<string, { type: string; khoa: string; label: string }>; roles: Record<string, unknown>; khoas: string[]; afterHoursAllowed: string[] };
}
export interface ServerConfig { registryPk: string; k: number; pk: AuthorityPublic; nodes: { org: string; url: string }[] }
export type SectionStatus = 'OPEN' | 'DENIED_BACKEND' | 'DENIED_CRYPTO' | 'INTEGRITY_ERROR';
export interface SectionView {
  section: SectionKey; status: SectionStatus; reason?: string; data?: unknown; versions: number;
  signature?: SignatureCheck; record?: SignedRecordView & Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown> = {}) { super(`${code} (HTTP ${status})`); }
}
/** Tài khoản đang dùng mật khẩu TẠM do admin cấp: giao diện phải hỏi mật khẩu mới rồi gọi lại signIn(..., { newPassword }). */
export class PasswordChangeRequiredError extends ApiError {
  constructor() { super(403, 'PASSWORD_CHANGE_REQUIRED'); }
}
/** Ngoài giờ làm việc: backend trả 423. `status` chứa giờ mở lại để giao diện hiển thị; KHÔNG có hàng đợi tự gửi lại. */
export class BusinessClosedError extends ApiError {
  constructor(public closed: Status, body: Record<string, unknown>) { super(423, 'OUTSIDE_BUSINESS_HOURS', body); }
}

export interface ResearchClientOptions {
  baseUrl: string;
  /** Mặc định fetch toàn cục. Với HTTPS tự ký/CA nội bộ truyền tlsFetch(CA) để GHIM CA (không bao giờ tắt kiểm tra chứng chỉ). */
  fetch?: typeof fetch;
  store: DeviceKeyStore;
  /** Ghim ngoài băng tần: khoá registry (hex) và/hoặc băm tham số công khai ABE. Thiếu => tin vào kênh HTTPS đã xác minh. */
  pin?: { registryPk?: string; abePkSha256?: string };
  deviceLabel?: string;
  onBusinessClosed?: (s: Status) => void;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const norm = (code: string) => code.trim().toUpperCase();

export const abePkDigest = (pk: AuthorityPublic) => bytesToHex(sha256(utf8(`${pk.id}|${pk.eAlpha}|${pk.gBeta}`)));

export class ResearchClient {
  private f: typeof fetch;
  private token = '';
  private local: LocalDevice | null = null;
  me: Me | null = null;
  private cfg?: ServerConfig;
  private doc?: PolicyDoc;
  private keys: Record<string, AttrKey> = {};
  private indexKey = '';
  /** Số lần gọi mạng/phép toán, để đo chi phí bổ sung của ABE. */
  readonly stats = { keyRequests: 0, nodeCalls: 0, abeEncrypts: 0, abeDecrypts: 0 };

  constructor(private o: ResearchClientOptions) {
    this.f = o.fetch ?? ((...a) => fetch(...a));
  }

  // ------------------------------------------------------------------ HTTP
  async call<T = Record<string, any>>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    const r = await this.f(this.o.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (r.status === 423) {
      this.wipeKeys();                       // nỗ lực tốt nhất: bỏ khoá khỏi bộ nhớ. KHÔNG phải đảm bảo (khoá đã sao chép vẫn dùng được).
      const st = j as unknown as Status;
      this.o.onBusinessClosed?.(st);
      throw new BusinessClosedError(st, j);
    }
    if (!r.ok) throw new ApiError(r.status, String(j.error ?? `HTTP ${r.status}`), j);
    return j as T;
  }
  private node(url: string, body: unknown) {
    this.stats.nodeCalls++;
    return this.f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error' });
  }

  status(): Promise<Status> { return this.call<Status>('GET', '/api/v2/status', undefined, false); }

  // ------------------------------------------------------------------ danh tính / phiên / thiết bị
  /**
   * Đăng nhập bằng tài khoản cá nhân. Nếu máy này CHƯA có khoá ký của người này: đăng nhập tạm → đăng ký thiết bị (nhập lại mật khẩu,
   * backend cấp chứng chỉ) → đăng nhập lại KÈM chứng minh sở hữu khoá. Đổi máy = đúng quy trình này, cùng userId/GID/quyền.
   */
  async signIn(username: string, password: string, opts: { newPassword?: string } = {}, reenrolled = false): Promise<Me> {
    username = username.trim().toLowerCase();
    let dev = await this.o.store.get(username);
    if (!dev) {
      const tmp = await this.call<Me & { token: string }>('POST', '/api/v2/auth/login', { username, password }, false);
      this.token = tmp.token;
      // Tài khoản do admin cấp có mật khẩu TẠM: phải tự đổi TRƯỚC khi đăng ký thiết bị (server chặn mọi việc khác), để admin không còn biết mật khẩu.
      if (tmp.mustChangePassword) password = await this.forcePasswordChange(password, opts.newPassword);
      const k = await newSignKey();
      const res = await this.call<{ deviceId: string; userId: string }>('POST', '/api/v2/devices', { signPub: k.pub, label: this.o.deviceLabel ?? 'may-nay', password });
      dev = { username, userId: res.userId, deviceId: res.deviceId, signPub: k.pub, signKey: k.key };
      await this.o.store.put(dev);
      await this.call('POST', '/api/v2/auth/logout');
      this.token = '';
    }
    const proofLogin = async (d: LocalDevice) => {
      const { nonce } = await this.call<{ nonce: string }>('GET', '/api/v2/auth/challenge', undefined, false);
      const sig = await signHex(d.signKey, `${LOGIN_DOMAIN}${nonce}|${username}|${d.deviceId}`);
      return this.call<Me & { token: string }>('POST', '/api/v2/auth/login', { username, password, deviceId: d.deviceId, nonce, sig }, false);
    };
    let r: Me & { token: string };
    try { r = await proofLogin(dev); }
    catch (e) {
      if (!(e instanceof ApiError && e.code === 'DEVICE_PROOF_INVALID')) throw e;
      try { r = await proofLogin(dev); }                         // thử lại một lần với thử thách mới (phòng lỗi nhất thời)
      catch (e2) {
        if (!(e2 instanceof ApiError && e2.code === 'DEVICE_PROOF_INVALID') || reenrolled) throw e2;
        // Khoá thiết bị đang lưu ở trình duyệt không còn hợp lệ ở máy chủ (thiết bị đã bị thu hồi, hoặc dữ liệu máy chủ đã đổi): bỏ khoá cũ và đăng ký lại
        // như một máy mới (vẫn cần đúng mật khẩu; máy chủ vẫn áp giới hạn số thiết bị). Không có thêm quyền nào được cấp.
        await this.o.store.remove(username);
        return this.signIn(username, password, opts, true);
      }
    }
    this.token = r.token; this.local = dev; this.wipeKeys(); this.doc = undefined;
    if (r.mustChangePassword) await this.forcePasswordChange(password, opts.newPassword);     // vd admin vừa cấp lại mật khẩu tạm cho máy đã đăng ký
    this.me = await this.call<Me>('GET', '/api/v2/auth/me');
    return this.me;
  }

  private async forcePasswordChange(current: string, next?: string): Promise<string> {
    if (!next) { await this.call('POST', '/api/v2/auth/logout').catch(() => undefined); this.token = ''; throw new PasswordChangeRequiredError(); }
    await this.changePassword(current, next);
    return next;
  }

  /** Cho MedClient (app nhân viên) dùng lại phiên đã đăng nhập: token phiên, khoá ký của thiết bị, chứng chỉ do registry ký và cấu hình máy chủ. */
  async exportSession(): Promise<{ token: string; me: Me; device: LocalDevice; cert: string; cfg: ServerConfig }> {
    if (!this.token || !this.local || !this.me) throw new Error('Chưa đăng nhập');
    const mine = await this.call<{ deviceId: string; cert: string }[]>('GET', '/api/v2/devices');
    const cert = mine.find((d) => d.deviceId === this.local!.deviceId)?.cert;
    if (!cert) throw new Error('Không có chứng chỉ cho thiết bị này');
    return { token: this.token, me: this.me, device: this.local, cert, cfg: await this.config() };
  }

  /** Tự đổi mật khẩu (cần mật khẩu hiện tại). Các phiên khác của chính người này bị thu hồi. */
  async changePassword(current: string, next: string): Promise<void> {
    await this.call('POST', '/api/v2/auth/password', { currentPassword: current, newPassword: next });
  }

  async signOut(): Promise<void> {
    if (this.token) await this.call('POST', '/api/v2/auth/logout').catch(() => undefined);
    this.token = ''; this.me = null; this.wipeKeys();
  }
  get loggedIn() { return !!this.token; }
  /** Xoá khoá/chỉ mục khỏi bộ nhớ (khi khoá màn hình, đăng xuất, nhận trạng thái đóng cửa). */
  wipeKeys() { this.keys = {}; this.indexKey = ''; }
  heldKeys(): Record<string, AttrKey> { return { ...this.keys }; }
  get gid() { return this.me?.gid ?? ''; }

  // ------------------------------------------------------------------ cấu hình + policy (có chữ ký, có ghim)
  async config(): Promise<ServerConfig> {
    if (this.cfg) return this.cfg;
    const c = await this.call<ServerConfig>('GET', '/api/config', undefined, false);
    if (this.o.pin?.registryPk && this.o.pin.registryPk.toLowerCase() !== c.registryPk.toLowerCase()) throw new Error('Khoá registry khác khoá đã ghim: dừng kết nối');
    if (this.o.pin?.abePkSha256 && this.o.pin.abePkSha256 !== abePkDigest(c.pk)) throw new Error('Tham số công khai ABE khác giá trị đã ghim: dừng kết nối');
    return (this.cfg = c);
  }
  async policy(): Promise<PolicyDoc> {
    if (this.doc) return this.doc;
    const cfg = await this.config();
    const raw = await this.call<{ payload: string; signature: string }>('GET', '/api/v2/policy');
    if (!ed25519.verify(hexToBytes(raw.signature), utf8(POLICY_DOMAIN + raw.payload), hexToBytes(cfg.registryPk))) throw new Error('Chữ ký tài liệu policy không hợp lệ');
    return (this.doc = JSON.parse(raw.payload) as PolicyDoc);
  }
  async epochs(): Promise<EpochDirectory> { return this.call<EpochDirectory>('GET', '/api/epochs', undefined, false); }

  // ------------------------------------------------------------------ khoá ABE qua vé
  /** Xin khoá cho các thuộc tính (đã gắn epoch) còn thiếu: vé từ backend → đưa cho từng nút kèm chứng minh sở hữu → ghép khoá (≥ k nút). */
  async ensureKeys(attrs: string[]): Promise<void> {
    const missing = [...new Set(attrs)].filter((a) => !this.keys[a]);
    if (!missing.length) return;
    if (!this.local || !this.me) throw new Error('Chưa đăng nhập');
    const cfg = await this.config();
    this.stats.keyRequests++;
    const ticket = await this.call<{ jti: string; attrs: string[] }>('POST', '/api/v2/keys/ticket', { attrs: missing });
    const asked = missing.filter((a) => ticket.attrs.includes(parseVersioned(a)?.base ?? ''));
    let closed: Record<string, unknown> | null = null;
    const answers = await Promise.all(cfg.nodes.map(async (n) => {
      const sig = await signHex(this.local!.signKey, `${TICKET_DOMAIN}${ticket.jti}|${n.org}`);
      try {
        const r = await this.node(`${nodeUrl(n.url, this.o.baseUrl)}/v2/partials`, { jti: ticket.jti, sig, attrs: asked });      // nút công bố là localhost = nút nằm cùng máy chủ
        const j = (await r.json().catch(() => ({}))) as { partials?: Record<string, Partial>; indexKey?: string; error?: string };
        if (r.status === 423) closed = j;
        return r.ok ? j : null;
      } catch { return null; }
    }));
    if (closed) { this.wipeKeys(); throw new BusinessClosedError(await this.status(), closed); }
    const ok = answers.filter((a): a is NonNullable<typeof a> => !!a);
    if (ok.length < cfg.k) throw new Error(`Chỉ liên lạc/được duyệt ở ${ok.length}/${cfg.k} nút cấp khoá cần thiết`);
    for (const a of asked) {
      const ps = ok.map((x) => x.partials?.[a]).filter((p): p is Partial => !!p);
      if (ps.length >= cfg.k) this.keys[a] = combineKey(ps, cfg.k);
    }
    const ik = ok.find((x) => x.indexKey)?.indexKey;
    if (ik) this.indexKey = ik;
  }

  private async ensureIndexKey(): Promise<string> {
    if (this.indexKey) return this.indexKey;
    const dir = await this.epochs();
    const entitled = this.me?.attributes ?? [];
    if (!entitled.length) throw new ApiError(403, 'DENY_NO_ATTRIBUTES');
    await this.ensureKeys([versioned(entitled[0], dir)]);
    if (!this.indexKey) throw new Error('Không nhận được khoá chỉ mục từ các nút');
    return this.indexKey;
  }

  /** Chỉ mục bệnh nhân. baseline: băm công khai (backend vốn thấy bản rõ). abe: HMAC bằng khoá chỉ mục do các nút cấp => kho lưu trữ không dò ngược được mã. */
  async patientRef(mode: Mode, code: string): Promise<string> {
    if (mode === 'baseline') return bytesToHex(sha256(utf8(`MEDABE-BASELINE-REF|${norm(code)}`))).slice(0, 32);
    return bytesToHex(hmac(sha256, hexToBytes(await this.ensureIndexKey()), utf8(norm(code)))).slice(0, 32);
  }

  // ------------------------------------------------------------------ ghi
  private async buildRecord(mode: Mode, input: { patientCode: string; section: SectionKey; data: unknown; supersedes?: string }, dir?: EpochDirectory) {
    if (!this.local || !this.me) throw new Error('Chưa đăng nhập');
    const doc = await this.policy();
    const patientRef = await this.patientRef(mode, input.patientCode);
    const id = crypto.randomUUID();
    const type = input.section === 'hanhchinh' ? 'hanhchinh' : 'lamsang';
    const khoa = input.section === 'hanhchinh' ? 'KSK' : input.section.slice('lamsang.'.length);
    const plain = JSON.stringify(input.data);
    let content: string | undefined, payload: string | undefined;
    if (mode === 'baseline') content = plain;
    else {
      const d = dir ?? (await this.epochs());
      const policy = doc.abePolicies[input.section].replace(/MED:[A-Za-z0-9_.:-]+/g, (a) => versioned(a, d));
      const env = await encrypt({ MED: (await this.config()).pk }, policy, utf8(plain), `${patientRef}|${input.section}|${id}`);
      this.stats.abeEncrypts++;
      payload = JSON.stringify(env);
    }
    const manifest: Manifest = {
      v: 1, recordId: id, patientRef, section: input.section, mode: mode === 'abe' ? 'ABE' : 'BASELINE', policyVersion: doc.version,
      payloadDigest: sha256Hex((mode === 'abe' ? payload : content)!), signerUserId: this.me.userId, signerDeviceId: this.local.deviceId, signedAt: new Date().toISOString(),
    };
    const m = JSON.stringify(manifest);
    return { id, patientRef, type, khoa, supersedes: input.supersedes, manifest: m, signature: await signHex(this.local.signKey, SIG_DOMAIN + m), content, payload };
  }

  async saveSection(mode: Mode, input: { patientCode: string; section: SectionKey; data: unknown; supersedes?: string }): Promise<string> {
    const rec = await this.buildRecord(mode, input);
    await this.call('POST', `/api/v2/${mode}/records`, rec);
    return rec.id;
  }

  /** Import nhiều mục (backend kiểm quyền `import` cho TỪNG bản ghi; tất cả-hoặc-không trong mỗi lô ≤ 100). Mỗi bản ghi có chữ ký riêng. */
  async importMany(mode: Mode, items: { patientCode: string; section: SectionKey; data: unknown }[], onProgress?: (done: number, total: number) => void): Promise<number> {
    const dir = mode === 'abe' ? await this.epochs() : undefined;
    let done = 0;
    for (let i = 0; i < items.length; i += 100) {
      const chunk = [];
      for (const it of items.slice(i, i + 100)) chunk.push(await this.buildRecord(mode, it, dir));
      await this.call('POST', `/api/v2/${mode}/records/batch`, { records: chunk });
      done += chunk.length; onProgress?.(done, items.length);
    }
    return done;
  }

  // ------------------------------------------------------------------ đọc
  /** Lấy danh sách mục của bệnh nhân (backend lọc theo ABAC), kiểm chữ ký từng mục, và giải mã (chế độ abe) bằng khoá của chính người dùng. */
  async readPatient(mode: Mode, patientCode: string): Promise<SectionView[]> {
    const cfg = await this.config();
    const patientRef = await this.patientRef(mode, patientCode);
    const res = await this.call<{ sections: { section: SectionKey; denied: boolean; reason?: string; versions: number; latest?: SignedRecordView & Record<string, unknown> }[] }>(
      'GET', `/api/v2/${mode}/records?patientRef=${patientRef}`);
    const out: SectionView[] = [];
    for (const s of res.sections) {
      if (s.denied || !s.latest) { out.push({ section: s.section, status: 'DENIED_BACKEND', reason: s.reason, versions: s.versions }); continue; }
      const sig = await verifyRecord(s.latest, cfg.registryPk);
      if (!sig.ok) { out.push({ section: s.section, status: 'INTEGRITY_ERROR', reason: `chữ ký: ${sig.failed}`, versions: s.versions, signature: sig, record: s.latest }); continue; }
      if (mode === 'baseline') { out.push({ section: s.section, status: 'OPEN', data: JSON.parse(s.latest.content!), versions: s.versions, signature: sig, record: s.latest }); continue; }
      const opened = await this.openEnvelope(s.latest);
      out.push({ section: s.section, versions: s.versions, signature: sig, record: s.latest, ...opened });
    }
    return out;
  }

  /** Giải mã một phong bì ABE bằng khoá đang giữ (xin thêm khoá CHỈ cho thuộc tính mình được cấp). null/DENIED_CRYPTO = không thoả policy. */
  async openEnvelope(rec: { id: string; patientRef: string; section: string; payload?: string }): Promise<{ status: SectionStatus; data?: unknown; reason?: string }> {
    const env = JSON.parse(rec.payload!) as Envelope;
    const entitled = new Set(this.me?.attributes ?? []);
    const wanted = leavesOf(parsePolicy(env.abe.policy)).filter((a) => entitled.has(parseVersioned(a)?.base ?? ''));
    if (wanted.length) await this.ensureKeys(wanted);
    this.stats.abeDecrypts++;
    try {
      const pt = await decrypt(this.me!.gid, this.keys, env, `${rec.patientRef}|${rec.section}|${rec.id}`);
      if (!pt) return { status: 'DENIED_CRYPTO', reason: 'không đủ thuộc tính để thoả policy' };
      return { status: 'OPEN', data: JSON.parse(new TextDecoder().decode(pt)) };
    } catch (e) { return { status: 'INTEGRITY_ERROR', reason: (e as Error).message }; }
  }
}
