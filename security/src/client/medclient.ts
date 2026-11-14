import { requestServerProof } from './server-proof.js';
import { verifyReceipt, type Receipt } from '../byt/receipt.js';
// Thư viện phía thiết bị cho ứng dụng y tế. Mọi mã hoá/giải mã/ký diễn ra Ở ĐÂY; máy chủ lưu trữ và các nút
// cấp khoá không bao giờ thấy plaintext. Bác sĩ chỉ gọi saveRecord/openRecord - policy, khoá, epoch, bọc lại khoá
// đều tự động.
import { nodeUrl, storageUrl } from './connection.js';
import { clearParentCache, normName, parentIdxOf, validName, wrapForParent, type ParentWrap } from './parent.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { leavesOf, parsePolicy } from '../abe/policy.js';
import {
  combineKey, decrypt, sharedRecordKey, decryptShared, encrypt, encryptShared, newKeyHeader, openDek, openKeyHeader, rewrap, rewrapKeyHeader,
  type AttrKey, type AuthorityPublic, type Envelope, type KeyHeader, type Partial, type SharedEnvelope,
} from '../abe/rw15.js';
import { parseVersioned, versioned, type EpochDirectory } from '../common/epoch.js';
import { ResearchClient, type ServerConfig as AccountConfig } from '../research/client.js';
import { type DeviceKeyStore } from '../research/keys.js';
import { POLICY_DOMAIN, certMessage } from '../research/verify.js';
import { devicePubHex, signWithDevice, verifySig, type DeviceKeys } from './device.js';
import { isStale, policyFor, SECTION_TYPES, type RecordProfile, type RecordType } from './policy.js';
import { appPolicyString, khoasForType, type PolicyMatrix } from './app-policy.js';

export interface NodeRef { org: string; url: string; x: number; token: string; requiresApproval: boolean }
export interface ClientState {
  name: string;
  storageBase: string;
  gid: string;
  cert: string;
  token: string;
  deviceId: string;
  devicePub: string;
  nodes: NodeRef[];
  attrs: string[];                      // thuộc tính gốc đã được các nút cấp quyền (không gồm Device/BG)
  keys: Record<string, AttrKey>;        // khoá đã ghép, theo thuộc tính ĐÃ PHIÊN BẢN
  indexKey: string;
  bg: Record<string, number>;           // patientIdx -> hạn phá-vỡ-kính (ms)
  pendingEnrollment?: boolean;
  /** Có = đăng nhập bằng TÀI KHOẢN (email + mật khẩu): danh tính/vai trò/khoa do backend quản lý, "token" là token PHIÊN, khoá cấp qua vé. */
  account?: { userId: string; username: string; role: string; khoa: string | null; /** Máy chủ ở xa qua HTTPS công khai (đường hầm): tin cậy bằng chứng chỉ HTTPS + khoá registry đã ghim, không dùng "bằng chứng địa chỉ LAN". */ remote?: boolean };
  shared?: Record<string, string>;      // chính sách -> id header dùng chung đã tạo (không bí mật; DEK lấy lại bằng cách mở header)
}
export interface RecordRow {
  id: string; patientIdx: string; groupIdx?: string; type: RecordType; khoa: string; authorDevice: string;
  envelope: Envelope | SharedEnvelope; createdAt: string; parentIdx?: string; parentWrap?: ParentWrap;
  /** Tác giả THEO TÀI KHOẢN do backend gán từ phiên (không phải trường client tự khai). */
  authorUserId?: string;
  /** Mã ảnh gốc của một VÙNG ảnh (type 'vung'). */
  refId?: string;
}
type StoredHeader = KeyHeader & { id: string };
interface ServerConfig { registryPk: string; k: number; pk: AuthorityPublic; nodes: { org: string; url: string }[]; byt?: { url: string; pk: string } }
export interface BytFacility { ma: string; ten: string }
export type BytRow = RecordRow & { receipt?: Receipt };
export interface OpenResult {
  data: unknown;
  author: { name: string; deviceId: string; userId?: string };
  signatureValid: boolean;
  rewrapped: boolean;
  /** Trường được KÝ cùng nội dung (khoa, refId, ràng buộc ảnh...). */
  signed?: { khoa?: string; refId?: string; bind?: Record<string, unknown> };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
/** Ngoài giờ làm việc (backend trả 423): đọc/ghi/import/xin khoá bị khoá. KHÔNG phải mất kết nối — dữ liệu đang nhập trên màn hình phải được giữ nguyên. */
export class BusinessHoursError extends Error {
  constructor(public info: Record<string, unknown> = {}) { super('Ngoài giờ làm việc: hệ thống đã khóa đọc, ghi, import và xin khóa. Dữ liệu đang nhập vẫn được giữ trên màn hình; hãy lưu lại khi hệ thống mở cửa.'); }
}
/** Phiên tài khoản hết hạn / tài khoản bị khóa / thiết bị bị thu hồi: phải đăng nhập lại. */
export class SessionExpiredError extends Error {
  constructor() { super('Phiên đăng nhập đã hết hạn hoặc tài khoản/thiết bị đã bị khóa. Hãy đăng nhập lại.'); }
}
async function json(r: Response) {
  const j = await r.json().catch((e: unknown) => { if (e instanceof SyntaxError) return {}; throw e; });
  if (r.status === 423) throw new BusinessHoursError(j as Record<string, unknown>);
  if (!r.ok && r.status !== 202) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return { status: r.status, body: j as Record<string, unknown> };
}

export const gidMessage = (gid: string, devicePub: string) => new TextEncoder().encode(`medabe/gid/${gid}|${devicePub}`);

export class RecordIntegrityError extends Error {}

export class MedClient {
  private headers = new Map<string, StoredHeader>();        // header chung đã tải
  private deks = new Map<string, Uint8Array>();             // DEK đã mở - CHỈ trong bộ nhớ, không bao giờ lưu
  private deniedHeaders = new Set<string>();
  private rewrappedHeaders = new Set<string>();
  private cfgCache?: ServerConfig;
  private scopedDir?: EpochDirectory;

  private online = true;
  private generation = 0;
  private reconnectAttempt = 0;
  private abort = new AbortController();
  private rawFetch: typeof fetch;
  private f: typeof fetch;
  onDisconnect?: () => void;

  constructor(public s: ClientState, private dk: DeviceKeys, fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.rawFetch = fetcher;
    this.f = async (input, init = {}) => {
      const generation = this.begin();
      const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (!this.s.account && target.hostname !== new URL(this.s.storageBase).hostname) throw new Error('Nút cấp khóa phải thuộc máy chủ LAN đã xác minh');   // chế độ tài khoản: nút lấy từ cấu hình HTTPS đã xác minh, có thể ở địa chỉ khác
      try {
        const response = await this.rawFetch(input, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, this.abort.signal]) : AbortSignal.any([this.abort.signal, AbortSignal.timeout(10000)]) });
        this.check(generation);
        const read = response.json.bind(response);
        response.json = async () => { const value = await read(); this.check(generation); return value; };
        return response;
      } catch (e) {
        if (this.online && generation === this.generation && target.origin === new URL(this.s.storageBase).origin) {
          this.suspendNetwork(); this.onDisconnect?.();
        }
        throw e;
      }
    };
  }
  private begin() { this.check(this.generation); return this.generation; }
  private check(generation: number) {
    if (!this.online || generation !== this.generation) throw new Error('Chưa kết nối máy chủ KSK; thao tác đã bị hủy');
  }
  suspendNetwork() {
    this.online = false; ++this.generation; ++this.reconnectAttempt; this.abort.abort(); this.resetKeys(); this.scopedDir = undefined;
  }

  static async register(storageBase: string, inviteCode: string, dk: DeviceKeys, f: typeof fetch = (...a) => fetch(...a), hwHash?: string) {
    const devicePub = await devicePubHex(dk);
    const r = (await json(await f(`${storageBase}/api/register`, post({ code: inviteCode, devicePub, hwHash })))).body as Record<string, string>;
    return new MedClient({
      name: r.name, storageBase, gid: r.gid, cert: r.cert, token: r.token, deviceId: r.deviceId, devicePub,
      nodes: [], attrs: [], keys: {}, indexKey: '', bg: {},
    }, dk, f);
  }

  /**
   * QUÊN MẬT KHẨU (chưa đăng nhập): chỉ GỬI YÊU CẦU cho quản trị, không đổi gì. Máy chủ luôn trả cùng một kết quả dù tài khoản có tồn tại hay không.
   * Quản trị xác minh danh tính rồi cấp mật khẩu TẠM ở trang Quản trị tài khoản. Ném lỗi FORGOT_RATE_LIMIT nếu gửi quá nhiều.
   */
  static async requestPasswordReset(baseUrl: string, username: string, opts: { fetch?: typeof fetch } = {}): Promise<void> {
    const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const r = await f(`${storageUrl(baseUrl)}/api/v2/auth/forgot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: username.trim().toLowerCase() }), redirect: 'error' });
    if (r.status === 429) throw new Error('FORGOT_RATE_LIMIT');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }

  /**
   * ĐĂNG NHẬP BẰNG TÀI KHOẢN (email + mật khẩu do công ty cấp). Máy chưa có khoá ký của người này thì tự đăng ký thiết bị (nhập lại mật khẩu, backend cấp chứng chỉ);
   * tài khoản mới dùng mật khẩu TẠM phải truyền newPassword (nếu thiếu: ném PasswordChangeRequiredError). Vai trò/khoa/thuộc tính do backend quyết định.
   */
  static async signIn(baseUrl: string, username: string, password: string, store: DeviceKeyStore, opts: { newPassword?: string; fetch?: typeof fetch; deviceLabel?: string } = {}): Promise<MedClient> {
    const base = storageUrl(baseUrl);
    const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const rc = new ResearchClient({ baseUrl: base, fetch: f, store, deviceLabel: opts.deviceLabel });
    const me = await rc.signIn(username, password, { newPassword: opts.newPassword });
    const sess = await rc.exportSession();
    const alg = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const dk: DeviceKeys = {
      sign: { privateKey: sess.device.signKey, publicKey: await crypto.subtle.importKey('raw', hexToBytes(sess.device.signPub) as BufferSource, alg, true, ['verify']) },
      wrap: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),     // không dùng ở chế độ tài khoản (không có kho khoá bọc bằng passphrase)
    };
    const u = new URL(base);
    const remote = u.protocol === 'https:' && !/^(\d{1,3}(\.\d{1,3}){3}|localhost|\[.*\])$/.test(u.hostname);
    const c = new MedClient({
      name: me.displayName, storageBase: base, gid: me.gid, cert: sess.cert, token: sess.token, deviceId: sess.device.deviceId, devicePub: sess.device.signPub,
      nodes: sess.cfg.nodes.map((n) => ({ org: n.org, url: nodeUrl(n.url, base), x: 0, token: '', requiresApproval: false })),
      attrs: me.attributes ?? [], keys: {}, indexKey: '', bg: {},
      account: { userId: me.userId, username: me.username, role: me.role, khoa: me.khoa, remote },
    }, dk, f);
    if (remote) c.cfgCache = sess.cfg as ServerConfig;                  // khoá registry đã thấy lúc đăng nhập: từ nay ghim
    await c.warmUp();
    return c;
  }

  /** Máy chủ có đang cho phép đăng ký tự do (không cần mã mời) không? */
  static async openEnrollment(storageBase: string, f: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
    try { return !!((await json(await f(`${storageBase}/api/enrollment`))).body as { open?: boolean }).open; } catch { return false; }
  }

  /**
   * Đăng ký TỰ DO: chỉ cần tên. Registry cấp GID duy nhất + chứng chỉ cho khoá thiết bị; các nút cấp khoá sau đó cấp bộ quyền
   * MẶC ĐỊNH do admin đặt (người dùng không tự chọn quyền). Dùng được khi admin bật đăng ký tự do.
   */
  static async registerOpen(storageBase: string, name: string, dk: DeviceKeys, f: typeof fetch = (...a) => fetch(...a), hwHash?: string, checkpoint?: (client: MedClient) => Promise<void>) {
    const devicePub = await devicePubHex(dk);
    const r = (await json(await f(`${storageBase}/api/register`, post({ name, devicePub, hwHash })))).body as Record<string, string>;
    const c = new MedClient({
      name: r.name, storageBase, gid: r.gid, cert: r.cert, token: r.token, deviceId: r.deviceId, devicePub,
      nodes: [], attrs: [], keys: {}, indexKey: '', bg: {},
    }, dk, f);
    c.s.pendingEnrollment = true;
    await checkpoint?.(c);
    const claimed = await c.claimAllOpen(checkpoint ? () => checkpoint(c) : undefined);
    const k = (await c.config()).k;
    if (claimed < k) throw new Error(`Đăng ký tự do chỉ thành công ở ${claimed}/${k} nút cấp khoá cần thiết (đăng ký tự do có thể đang tắt ở một số nút)`);
    c.s.pendingEnrollment = false;
    await checkpoint?.(c);
    return c;
  }

  /** Nhận bộ quyền mặc định từ MỌI nút đang bật đăng ký tự do. Trả về số nút nhận được. */
  async claimAllOpen(checkpoint?: () => Promise<void>): Promise<number> {
    const cfg = await this.config();
    let ok = 0;
    for (const node of cfg.nodes) {
      if (this.s.nodes.some((n) => n.org === node.org)) { ok++; continue; }
      try { await this.claimOpen(node.org, node.url); await checkpoint?.(); ok++; } catch { /* nút tắt đăng ký tự do hoặc không phản hồi: bỏ qua */ }
    }
    return ok;
  }

  private async claimOpen(org: string, rawUrl: string): Promise<void> {
    const url = nodeUrl(rawUrl, this.s.storageBase);
    const info = (await json(await this.f(`${url}/info`))).body as { x: number };
    const sig = await signWithDevice(this.dk, `claim-open|${this.s.gid}`);
    const r = (await json(await this.f(`${url}/claim-open`, post({ gid: this.s.gid, devicePub: this.s.devicePub, cert: this.s.cert, sig, name: this.s.name })))).body as {
      token: string; requiresApproval: boolean; attrs: string[]; indexKey: string;
    };
    this.s.nodes = [...this.s.nodes.filter((n) => n.org !== org), { org, url, x: info.x, token: r.token, requiresApproval: r.requiresApproval }];
    this.s.attrs = [...new Set([...this.s.attrs, ...r.attrs])];
    if (r.indexKey) this.s.indexKey = r.indexKey;
  }

  /** Lý do truy cập hồ sơ. Máy chủ BẮT BUỘC với vai trò Giám sát (ghi nhật ký mỗi lần đọc); vai trò khác bỏ qua. Gửi kèm mọi yêu cầu, mã hoá URL (tiêu đề HTTP không chứa được dấu tiếng Việt). */
  accessReason = '';
  private auth(): Record<string, string> {
    const reason = this.accessReason.trim();
    return { authorization: `Bearer ${this.s.token}`, ...(reason ? { 'x-access-reason': encodeURIComponent(reason) } : {}) };
  }
  private async get(path: string) { return (await json(await this.f(`${this.s.storageBase}${path}`, { headers: this.auth() }))).body; }

  /** Xoá cả DEK/header đã nhớ khi làm mới quyền; nội dung đã tải về trước đó không thể thu lại. */
  resetKeys() {
    this.s.keys = {}; clearParentCache(); this.patients.clear();
    for (const key of this.deks.values()) key.fill(0);
    this.headers.clear(); this.deks.clear(); this.deniedHeaders.clear(); this.rewrappedHeaders.clear(); this.restricted.clear();
  }

  /** Chỉ mang token sang địa chỉ mới nếu máy chủ dùng đúng registry đã cấp chứng chỉ thiết bị. */
  private async verifiedConfig(base: string, signal?: AbortSignal): Promise<ServerConfig> {
    const certMsg = this.s.account ? new TextEncoder().encode(certMessage(this.s.account.userId, this.s.gid, this.s.deviceId, this.s.devicePub)) : gidMessage(this.s.gid, this.s.devicePub);
    if (this.s.account?.remote) {
      const r = await this.rawFetch(`${base}/api/config`, { signal, cache: 'no-store', redirect: 'error' });
      if (!r.ok) throw new Error('Máy chủ từ xa chưa sẵn sàng');
      const cfg = (await r.json()) as ServerConfig;
      const pinned = this.cfgCache?.registryPk;
      if (pinned && pinned.toLowerCase() !== cfg.registryPk.toLowerCase()) throw new Error('Máy chủ từ xa đã đổi khoá registry: dừng kết nối');
      if (!ed25519.verify(hexToBytes(this.s.cert), certMsg, hexToBytes(cfg.registryPk))) throw new Error('Đây là máy chủ khác nơi đã đăng ký thiết bị');
      return cfg;
    }
    const proof = await requestServerProof(base, this.rawFetch, this.cfgCache?.registryPk, signal);
    if (!ed25519.verify(hexToBytes(this.s.cert), certMsg, hexToBytes(proof.registryPk)))
      throw new Error('Đây là máy chủ khác nơi đã đăng ký thiết bị');
    return proof.config;
  }
  async reconnect(raw: string): Promise<void> {
    const attempt = ++this.reconnectAttempt;
    const base = storageUrl(raw);
    const cfg = await this.verifiedConfig(base);
    if (attempt !== this.reconnectAttempt) throw new Error('Kết nối đã bị hủy');
    const nodes = this.s.nodes.map((n) => {
      const current = cfg.nodes.find((v) => v.org === n.org);
      if (!current) throw new Error(`Không tìm thấy nút ${n.org}`);
      const url = nodeUrl(current.url, base);
      if (!this.s.account && new URL(url).hostname !== new URL(base).hostname) throw new Error('Nút cấp khóa nằm ngoài máy chủ LAN đã xác minh');
      return { ...n, url };
    });
    this.abort.abort(); this.abort = new AbortController(); ++this.generation;
    this.s.storageBase = base; this.s.nodes = nodes; this.cfgCache = cfg; this.resetKeys(); this.online = true;
  }
  /** Trạng thái giờ làm việc lần kiểm tra gần nhất (chỉ chế độ tài khoản). Đóng cửa KHÔNG phải mất kết nối: màn hình và dữ liệu đang nhập được giữ nguyên. */
  business: { open: boolean; nextOpenAt: string | null; closesAt: string | null; now: string; scheduleVersion: number } | null = null;

  async checkConnection(): Promise<void> {
    const generation = this.begin();
    if (!this.s.account?.remote) { await this.verifiedConfig(this.s.storageBase, this.abort.signal); this.check(generation); }   // từ xa: chứng chỉ HTTPS đã xác minh lúc kết nối; không lặp lại mỗi vài giây qua Internet
    if (this.s.account) {
      // Chế độ tài khoản: /status (công khai, luôn dùng được kể cả ngoài giờ) + /auth/me (phiên còn hiệu lực? tài khoản/thiết bị còn hoạt động?).
      const st = (await json(await this.f(`${this.s.storageBase}/api/v2/status`, { signal: AbortSignal.timeout(4000), cache: 'no-store' }))).body as { businessOpen: boolean; nextOpenAt: string | null; closesAt: string | null; now: string; scheduleVersion: number };
      this.business = { open: st.businessOpen, nextOpenAt: st.nextOpenAt, closesAt: st.closesAt, now: st.now, scheduleVersion: st.scheduleVersion };
      if (!st.businessOpen) this.resetKeys();                         // nỗ lực tốt nhất: bỏ khoá khỏi bộ nhớ khi đóng cửa (KHÔNG phải bảo đảm — khoá đã sao chép vẫn dùng được)
      const me = await this.f(`${this.s.storageBase}/api/v2/auth/me`, { headers: this.auth(), signal: AbortSignal.timeout(4000), cache: 'no-store' });
      if (me.status === 401) throw new SessionExpiredError();
      if (!me.ok) throw new Error('Tài khoản không còn được phép kết nối máy chủ KSK');
      this.check(generation);
      return;
    }
    const response = await this.f(`${this.s.storageBase}/api/records/version?groupIdx=${'0'.repeat(32)}&type=hanhchinh`, {
      headers: this.auth(), signal: AbortSignal.timeout(4000), cache: 'no-store',
    });
    if (!response.ok) throw new Error('Thiết bị không còn được phép kết nối máy chủ KSK');
    this.check(generation);
  }
  async config() {
    const generation = this.begin();
    if (!this.cfgCache) { const cfg = await this.verifiedConfig(this.s.storageBase, this.abort.signal); this.check(generation); this.cfgCache = cfg; }
    return this.cfgCache;
  }
  /** Thư mục epoch hiện hành. Trong một thao tác hàng loạt (openMany/saveMany) chỉ tải một lần. */
  async epochs(): Promise<EpochDirectory> {
    this.begin();
    return this.scopedDir ?? ((await json(await this.f(`${this.s.storageBase}/api/epochs`))).body as unknown as EpochDirectory);
  }
  private async withEpochScope<T>(fn: () => Promise<T>): Promise<T> {
    this.scopedDir = undefined;
    this.scopedDir = await this.epochs();
    try { return await fn(); } finally { this.scopedDir = undefined; }
  }

  /** Đăng ký với MỘT nút (mỗi nút có mã riêng do admin của nút đó cấp). */
  async claim(org: string, code: string): Promise<void> {
    const cfg = await this.config();
    const node = cfg.nodes.find((n) => n.org === org);
    if (!node) throw new Error(`Không biết nút "${org}"`);
    const url = nodeUrl(node.url, this.s.storageBase);
    this.deniedHeaders.clear();
    const info = (await json(await this.f(`${url}/info`))).body as { x: number };
    const sig = await signWithDevice(this.dk, `claim|${code}|${this.s.gid}`); // chứng minh đang giữ khoá riêng của thiết bị
    const r = (await json(await this.f(`${url}/claim`, post({ code, gid: this.s.gid, devicePub: this.s.devicePub, cert: this.s.cert, sig })))).body as {
      token: string; requiresApproval: boolean; attrs: string[]; indexKey: string;
    };
    this.s.nodes = [...this.s.nodes.filter((n) => n.org !== org), { org, url, x: info.x, token: r.token, requiresApproval: r.requiresApproval }];
    this.s.attrs = [...new Set([...this.s.attrs, ...r.attrs])];
    if (r.indexKey) this.s.indexKey = r.indexKey;
  }

  /** Chỉ mục mù của bệnh nhân: máy chủ lưu trữ chỉ thấy HMAC, không thấy mã bệnh nhân. */
  patientIdx(patientCode: string): string {
    if (!this.s.indexKey) throw new Error('Thiết bị chưa được cấp khoá chỉ mục (cần quyền lâm sàng)');
    return bytesToHex(hmac(sha256, hexToBytes(this.s.indexKey), new TextEncoder().encode(patientCode.trim().toUpperCase()))).slice(0, 32);
  }

  // ---------- khoá ----------
  private async askNode(n: NodeRef, attrs: string[]): Promise<{ partials: Record<string, Partial> }> {
    const hdr = { authorization: `Bearer ${n.token}` };
    let r = await json(await this.f(`${n.url}/partials`, { ...post({ attrs }, hdr), signal: AbortSignal.timeout(8000) }));
    for (let i = 0; r.status === 202 && i < 120; i++) { // nút cần duyệt trên điện thoại: chờ tối đa ~60s
      await sleep(500);
      r = await json(await this.f(`${n.url}/partials/${r.body.pending}`, { headers: hdr, signal: AbortSignal.timeout(8000) }));
    }
    if (r.status === 202) throw new Error(`Nút ${n.org}: hết thời gian chờ duyệt trên điện thoại`);
    return r.body as { partials: Record<string, Partial> };
  }

  /**
   * Chế độ tài khoản: xin VÉ ở backend (kiểm phiên + thiết bị + tài khoản + GIỜ LÀM VIỆC + thuộc tính theo vai trò/khoa), rồi đưa vé + chứng minh sở hữu
   * khoá thiết bị cho từng nút; nút hỏi lại backend trước khi cấp. Ghép khoá từ >= k nút. Khoá gắn GID của NGƯỜI nên đổi máy vẫn dùng được.
   */
  private async ensureKeysAccount(attrs: string[]): Promise<string[]> {
    const generation = this.begin();
    const k = (await this.config()).k;
    const missing = [...new Set(attrs)].filter((a) => !this.s.keys[a]);
    if (!missing.length) return [];
    const ticket = (await json(await this.f(`${this.s.storageBase}/api/v2/keys/ticket`, post({ attrs: missing }, this.auth())))).body as { jti: string; attrs: string[] };
    const asked = missing.filter((a) => ticket.attrs.includes(parseVersioned(a)?.base ?? ''));
    let closed = false;
    const answers = await Promise.all(this.s.nodes.map(async (n) => {
      const sig = await signWithDevice(this.dk, `medabe/ticket/v1|${ticket.jti}|${n.org}`);
      try {
        const r = await this.f(`${n.url}/v2/partials`, { ...post({ jti: ticket.jti, sig, attrs: asked }), signal: AbortSignal.timeout(8000) });
        if (r.status === 423) closed = true;
        const j = (await r.json().catch(() => ({}))) as { partials?: Record<string, Partial>; indexKey?: string };
        return r.ok ? j : null;
      } catch { return null; }
    }));
    this.check(generation);
    if (closed) throw new BusinessHoursError();
    const ok = answers.filter((a): a is NonNullable<typeof a> => !!a);
    if (ok.length < k) throw new Error(`Chỉ liên lạc/được duyệt ở ${ok.length}/${k} nút cấp khoá cần thiết. Kiểm tra máy chủ, mạng rồi tải lại.`);
    for (const a of asked) {
      const ps = ok.map((x) => x.partials?.[a]).filter((p): p is Partial => !!p);
      if (ps.length >= k) this.s.keys[a] = combineKey(ps, k);
    }
    const ik = ok.find((x) => x.indexKey)?.indexKey;
    if (ik) this.s.indexKey = ik;
    return attrs.filter((a) => !this.s.keys[a]);
  }

  /** Lấy khoá chỉ mục (HMAC mã bệnh nhân/đơn vị) ngay sau khi đăng nhập: cần trước mọi thao tác theo bệnh nhân. Tài khoản không có thuộc tính (Quản trị) thì bỏ qua. */
  async warmUp(): Promise<void> {
    if (this.s.indexKey || !this.s.attrs.length) return;
    await this.ensureKeys([versioned(this.s.attrs[0], await this.epochs())]);
  }

  // ---------- MFA (TOTP): nhân tố thứ hai, đồng thời là THUỘC TÍNH ABE MED:Auth:MFA (chính sách của Giám sát = Role:GiamSat AND Auth:MFA) ----------
  /** Trạng thái MFA của phiên: có bắt buộc cho vai trò này không, đã đăng ký chưa, phiên đã xác thực còn hạn chưa. */
  async mfaStatus(): Promise<{ required: boolean; enrolled: boolean; verified: boolean; freshMinutes: number }> {
    return (await this.api<{ mfa: { required: boolean; enrolled: boolean; verified: boolean; freshMinutes: number } }>('GET', '/api/v2/auth/mfa')).mfa;
  }
  /** Bắt đầu đăng ký MFA (nhập lại mật khẩu). Trả bí mật + URI otpauth (quét mã QR); chưa có hiệu lực đến khi nhập đúng mã đầu tiên bằng mfaVerify. */
  async mfaEnroll(password: string): Promise<{ secret: string; uri: string }> {
    return this.api('POST', '/api/v2/auth/mfa/enroll', { password });
  }
  /**
   * Nhập mã 6 số. Đúng => máy chủ cấp thuộc tính MED:Auth:MFA cho phiên này; client làm mới danh sách thuộc tính để xin khoá tương ứng ở lần mở bản ghi kế tiếp.
   * Hết hạn (mfaFreshMinutes) thì phải nhập lại.
   */
  async mfaVerify(code: string): Promise<void> {
    await this.api('POST', '/api/v2/auth/mfa/verify', { code });
    await this.refreshAttributes();
  }
  /** Làm mới thuộc tính của phiên từ backend (sau khi xác thực MFA hoặc khi MFA hết hạn). Khoá đã có trong bộ nhớ giữ nguyên. */
  async refreshAttributes(): Promise<string[]> {
    const me = await this.api<{ attributes?: string[] }>('GET', '/api/v2/auth/me');
    this.s.attrs = me.attributes ?? [];
    return this.s.attrs;
  }

  /** Gọi API v2 của backend bằng phiên hiện tại (quản trị tài khoản, lịch giờ, nhật ký...). */
  async api<T = Record<string, any>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.f(`${this.s.storageBase}${path}`, { method, headers: { 'content-type': 'application/json', ...this.auth() }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) {
      // Chỉ "phiên không hợp lệ" mới là hết phiên; 401 của bước xác nhận (STEP_UP_FAILED, MFA_CODE_INVALID, MFA_CODE_REUSED...) là lỗi nghiệp vụ, giữ nguyên mã lỗi.
      const j = (await r.clone().json().catch(() => ({}))) as { error?: string };
      if (!j.error || j.error === 'SESSION_INVALID') throw new SessionExpiredError();
    }
    return (await json(r)).body as T;
  }

  /** Chính sách mã hoá của từng mục lấy từ tài liệu policy do registry KÝ (cùng ma trận với kiểm quyền ở backend). */
  private policyDocCache?: { version: string; abePolicies: Record<string, string>; matrix: PolicyMatrix };
  private async policyDoc() {
    if (this.policyDocCache) return this.policyDocCache;
    const cfg = await this.config();
    const raw = (await this.get('/api/v2/policy')) as unknown as { payload: string; signature: string };
    if (!ed25519.verify(hexToBytes(raw.signature), new TextEncoder().encode(POLICY_DOMAIN + raw.payload), hexToBytes(cfg.registryPk))) throw new Error('Chữ ký tài liệu chính sách không hợp lệ');
    return (this.policyDocCache = JSON.parse(raw.payload) as { version: string; abePolicies: Record<string, string>; matrix: PolicyMatrix });
  }
  private async policyForProfile(profile: RecordProfile, dir: EpochDirectory): Promise<string> {
    if (!this.s.account) return policyFor(profile, dir);
    // Chế độ tài khoản: policy = Người nhập (MED:Author:<userId>) HOẶC (Bác sĩ VÀ chuyên khoa); sinh từ tài liệu policy đã ký, cùng nguồn với kiểm quyền ở backend.
    const m = (await this.policyDoc()).matrix;
    return appPolicyString(m, profile.type, khoasForType(m, profile.type, profile.khoa), profile.authorUserId, (a) => versioned(a, dir));
  }

  /** Mã khoa chuẩn (theo danh mục trong tài liệu policy đã ký) của một mục sắp ghi; loại không dùng khoa => 'KSK'. Ở chế độ thiết bị: giữ nguyên. */
  private async canonKhoa(type: RecordType, raw: string): Promise<string> {
    if (!this.s.account) return raw;
    const m = (await this.policyDoc()).matrix;
    const ks = khoasForType(m, type, raw);
    return ks.length ? ks.join(',') : 'KSK';
  }

  /** Bảo đảm có khoá cho các thuộc tính (đã phiên bản) cần dùng; hỏi >= k nút đồng thuận. Trả về các thuộc tính vẫn thiếu. */
  async ensureKeys(attrs: string[]): Promise<string[]> {
    if (this.s.account) return this.ensureKeysAccount(attrs);
    const generation = this.begin();
    const k = (await this.config()).k;
    let missing = [...new Set(attrs)].filter((a) => !this.s.keys[a]);
    if (!missing.length) return [];
    const got: Record<string, Partial[]> = {};
    let responding = 0;
    const collect = (res: { partials: Record<string, Partial> }) => {
      responding++;
      for (const [a, p] of Object.entries(res.partials)) (got[a] ??= []).push(p);
    };
    const quick = this.s.nodes.filter((n) => !n.requiresApproval);
    const slow = this.s.nodes.filter((n) => n.requiresApproval);
    await Promise.all(quick.map((n) => this.askNode(n, missing).then(collect).catch(() => undefined)));
    missing = missing.filter((a) => (got[a]?.length ?? 0) < k);
    if (missing.length && slow.length) {
      await Promise.all(slow.map((n) => this.askNode(n, missing).then(collect).catch(() => undefined)));
    }
    this.check(generation);
    if (responding < k) throw new Error(`Chỉ liên lạc được ${responding}/${k} nút cấp khoá cần thiết. Kiểm tra máy chủ, mạng hoặc yêu cầu duyệt điện thoại rồi tải lại.`);
    for (const [a, ps] of Object.entries(got)) {
      if (ps.length >= k) this.s.keys[a] = combineKey(ps, k);
    }
    return attrs.filter((a) => !this.s.keys[a]);
  }

  // ---------- bản ghi ----------
  /**
   * `group` (mã đơn vị/trường/công ty) chỉ nên dùng cho mục hành chính: máy chủ lưu HMAC của nó để liệt kê danh sách
   * theo đơn vị mà không biết đơn vị nào (chỉ biết "các bản ghi cùng nhóm").
   */
  async saveRecord(input: { patientCode: string; type: RecordType; khoa: string; data: unknown; group?: string; name?: string; refId?: string; bind?: Record<string, unknown>; tags?: string[]; id?: string }): Promise<string> {
    const generation = this.begin();
    if (input.type === 'hanhchinh') return (await this.saveMany([{ ...input, type: 'hanhchinh' }]))[0]; // dùng header chung
    const [cfg, dir] = await Promise.all([this.config(), this.epochs()]);
    const patientIdx = this.patientIdx(input.patientCode);
    const groupIdx = input.group ? this.groupIdx(input.group) : undefined;
    const id = input.id ?? crypto.randomUUID();
    const khoa = await this.canonKhoa(input.type, input.khoa);
    const profile: RecordProfile = { type: input.type, khoa, patientIdx, authorDevice: this.s.deviceId, authorUserId: this.s.account?.userId };
    const body = JSON.stringify({
      data: input.data, ts: new Date().toISOString(),
      ...(this.s.account ? { khoa, ...(input.refId ? { refId: input.refId } : {}), ...(input.bind ? { bind: input.bind } : {}), ...(input.tags?.length ? { tags: input.tags } : {}) } : {}),
      author: { name: this.s.name, gid: this.s.gid, deviceId: this.s.deviceId, devicePub: this.s.devicePub, cert: this.s.cert, ...(this.s.account ? { userId: this.s.account.userId } : {}) },
    });
    const sig = await signWithDevice(this.dk, `${id}|${patientIdx}|${input.type}|${body}`);
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const pname = await this.nameFor(input.patientCode, patientIdx, input.name); this.check(generation);
    const envelope = await encrypt({ MED: cfg.pk }, await this.policyForProfile(profile, dir), new TextEncoder().encode(JSON.stringify({ body, sig })), `${patientIdx}|${input.type}|${id}`, dek);
    const parent = await this.forParent(input.patientCode, pname, id, dek); this.check(generation);
    await json(await this.f(`${this.s.storageBase}/api/records`, post({ id, patientIdx, groupIdx, type: input.type, khoa, authorDevice: this.s.deviceId, envelope, ...(input.refId ? { refId: input.refId } : {}), ...parent }, this.auth())));
    return id;
  }

  // ---------- khoá chung theo chính sách ----------
  private async fetchHeaders(ids: string[]): Promise<void> {
    const need = [...new Set(ids)].filter((i) => !this.headers.has(i));
    for (let i = 0; i < need.length; i += 100) {
      const list = (await this.get(`/api/headers?ids=${need.slice(i, i + 100).join(',')}`)) as unknown as StoredHeader[];
      for (const h of list) this.headers.set(h.id, h);
    }
  }
  private async getHeader(id: string): Promise<StoredHeader> {
    await this.fetchHeaders([id]);
    const h = this.headers.get(id);
    if (!h) throw new Error('Không có header khoá ' + id);
    return h;
  }

  /** Lấy (hoặc tạo) header chung cho chính sách này; trả về DEK để mã hoá các bản ghi của lô. */
  private async sharedHeader(profile: RecordProfile, dir: EpochDirectory): Promise<{ id: string; dek: Uint8Array }> {
    const generation = this.begin();
    const policy = await this.policyForProfile(profile, dir);
    this.s.shared ??= {};
    const known = this.s.shared[policy];
    if (known) {
      let dek = this.deks.get(known);
      if (!dek) { // phiên mới: mở lại header (người tạo luôn mở được nhờ thuộc tính thiết bị)
        const h = await this.getHeader(known);
        await this.ensureKeys(this.wanted(h.policy, ''));
        dek = (await openKeyHeader(this.s.gid, this.s.keys, h)) ?? undefined;
        this.check(generation);
        if (dek) this.deks.set(known, dek);
      }
      if (dek) return { id: known, dek };
    }
    const cfg = await this.config();
    const { header, dek } = await newKeyHeader({ MED: cfg.pk }, policy);
    const id = crypto.randomUUID();
    await json(await this.f(`${this.s.storageBase}/api/headers`, post({ id, ...header, authorDevice: this.s.deviceId }, this.auth())));
    this.check(generation);
    this.s.shared[policy] = id;
    this.deks.set(id, dek);
    this.headers.set(id, { id, ...header });
    return { id, dek };
  }

  /**
   * Lưu hàng loạt mục HÀNH CHÍNH (vd nhập Excel cả trường): chỉ tốn MỘT phép ABE cho cả lô vì các bản ghi cùng chính sách dùng
   * chung một header; mỗi bản ghi vẫn có chữ ký số riêng và khoá con riêng.
   */
  async saveMany(inputs: { patientCode: string; type: RecordType; khoa: string; data: unknown; group?: string; name?: string }[], onProgress?: (done: number, total: number) => void): Promise<string[]> {
    const generation = this.begin();
    return this.withEpochScope(async () => {
      const dir = await this.epochs();
      const ids: string[] = [];
      let batch: Record<string, unknown>[] = [];
      const flush = async () => {
        if (!batch.length) return;
        await json(await this.f(`${this.s.storageBase}/api/records/batch`, post({ records: batch }, this.auth())));
        batch = [];
      };
      const headers = new Map<string, { id: string; dek: Uint8Array }>();   // một header cho mỗi (loại mục, khoa)
      for (const input of inputs) {
        this.check(generation);
        const patientIdx = this.patientIdx(input.patientCode);
        if (input.type === 'hanhchinh') this.learnPatient(patientIdx, input.data);
        const pname = await this.nameFor(input.patientCode, patientIdx, input.name);
        const khoa = await this.canonKhoa(input.type, input.khoa);
        const profile: RecordProfile = { type: input.type, khoa, patientIdx, authorDevice: this.s.deviceId, bulk: true, authorUserId: this.s.account?.userId };
        const hk = `${input.type}|${khoa}`;
        let header = headers.get(hk);
        if (!header) { header = await this.sharedHeader(profile, dir); headers.set(hk, header); }
        const id = crypto.randomUUID();
        const body = JSON.stringify({
          data: input.data, ts: new Date().toISOString(),
          ...(this.s.account ? { khoa } : {}),
          author: { name: this.s.name, gid: this.s.gid, deviceId: this.s.deviceId, devicePub: this.s.devicePub, cert: this.s.cert, ...(this.s.account ? { userId: this.s.account.userId } : {}) },
        });
        const sig = await signWithDevice(this.dk, `${id}|${patientIdx}|${input.type}|${body}`);
        const envelope = await encryptShared(header.dek, header.id, id, new TextEncoder().encode(JSON.stringify({ body, sig })), `${patientIdx}|${input.type}|${id}`);
        batch.push({ id, patientIdx, groupIdx: input.group ? this.groupIdx(input.group) : undefined, type: input.type, khoa, authorDevice: this.s.deviceId, envelope, ...(await this.forParent(input.patientCode, pname, id, sharedRecordKey(header.dek, id))) });
        ids.push(id);
        if (batch.length >= 100) await flush();
        onProgress?.(ids.length, inputs.length);
      }
      await flush();
      this.check(generation);
      return ids;
    });
  }

  // ---------- tra cứu của phụ huynh (CCCD + họ tên) ----------
  /** patientIdx -> (mã bệnh nhân, ngày sinh) học được từ mục Hành chính đã lưu/giải mã trong phiên. Chỉ nằm trong bộ nhớ. */
  private patients = new Map<string, { code: string; name: string }>();

  /** Ghi nhớ ngày sinh từ dữ liệu Hành chính (chỉ khi CCCD trong dữ liệu khớp đúng chỉ mục của bản ghi). */
  private learnPatient(patientIdx: string, data: unknown) {
    const d = data as { cccd?: unknown; hoTen?: unknown } | undefined;
    const name = String(d?.hoTen ?? '');
    const code = String(d?.cccd ?? '');
    if (validName(name) && code && this.patientIdx(code) === patientIdx) this.patients.set(patientIdx, { code, name });
  }

  /** Họ tên để bọc khoá cho phụ huynh: tham số truyền vào > đã nhớ trong phiên > tự mở mục Hành chính mới nhất của người đó. '' = không biết. */
  private async nameFor(patientCode: string, patientIdx: string, given?: string): Promise<string> {
    if (validName(given ?? '')) return normName(given!);
    const known = this.patients.get(patientIdx)?.name;
    if (known) return known;
    try {
      const hc = (await this.listRecords(patientCode)).filter((r) => r.type === 'hanhchinh').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop();
      if (hc) await this.openRecord(hc);           // openRecord tự ghi nhớ họ tên
    } catch { /* không mở được: bản ghi này không có đường tra cứu cho phụ huynh */ }
    return this.patients.get(patientIdx)?.name ?? '';
  }

  /** Bản bọc khoá nội dung cho phụ huynh + chỉ mục tra cứu, gửi kèm bản ghi. Không biết họ tên => không bọc (phụ huynh không thấy bản ghi này). */
  private async forParent(patientCode: string, name: string, recordId: string, contentKey: Uint8Array): Promise<{ parentIdx?: string; parentWrap?: ParentWrap }> {
    if (!name) return {};
    return { parentIdx: parentIdxOf(patientCode, name), parentWrap: await wrapForParent(patientCode, name, recordId, contentKey) };
  }

  /** Khoá nội dung của một bản ghi (người gọi phải đọc được bản ghi theo ABE). null = không đủ quyền. */
  private async contentKeyOf(rec: RecordRow): Promise<Uint8Array | null> {
    if (rec.envelope.v === 3) {
      const h = await this.getHeader(rec.envelope.headerId);
      let dek = this.deks.get(h.id);
      if (!dek) {
        await this.ensureKeys(this.wanted(h.policy, rec.patientIdx));
        dek = (await openKeyHeader(this.s.gid, this.s.keys, h)) ?? undefined;
        if (dek) this.deks.set(h.id, dek);
      }
      return dek ? sharedRecordKey(dek, rec.id) : null;
    }
    await this.ensureKeys(this.wanted(rec.envelope.abe.policy, rec.patientIdx));
    return openDek(this.s.gid, this.s.keys, rec.envelope);
  }

  /**
   * Cập nhật lại đường tra cứu của phụ huynh (CCCD + họ tên) cho MỌI bản ghi của một đơn vị: dùng cho dữ liệu lưu từ trước khi đổi cách tra
   * cứu, hoặc sau khi sửa họ tên. Máy này giải mã khoá nội dung bằng ABE rồi bọc thêm dưới khoá gia đình; dữ liệu mã hoá giữ nguyên.
   * Trả về các patientIdx đã cập nhật (để gửi lại lên cổng Bộ Y tế).
   */
  async refreshParentAccess(group: string, onProgress?: (done: number, total: number) => void): Promise<{ updated: number; patients: Set<string>; noName: number }> {
    const generation = this.begin();
    const hcRows = await this.listGroup(group, 'hanhchinh');
    await this.openMany(hcRows);                                // ghi nhớ CCCD + họ tên của cả đơn vị
    const rows: RecordRow[] = [...hcRows];
    for (const t of SECTION_TYPES) if (t !== 'hanhchinh') rows.push(...(await this.listGroup(group, t)));
    this.check(generation);
    const items: { id: string; parentIdx: string; parentWrap: ParentWrap }[] = [];
    const patients = new Set<string>();
    let noName = 0, done = 0, updated = 0;
    const flush = async () => {
      if (!items.length) return;
      const res = await json(await this.f(`${this.s.storageBase}/api/records/parent-wraps`, { method: 'PUT', headers: { 'content-type': 'application/json', ...this.auth() }, body: JSON.stringify({ items: items.splice(0) }) }));
      updated += (res.body as { updated: number }).updated;
    };
    for (const r of rows) {
      this.check(generation);
      if (!r.envelope) continue;
      const who = this.patients.get(r.patientIdx);
      if (!who) noName++;
      else {
        const idx = parentIdxOf(who.code, who.name);
        if (r.parentIdx !== idx || !r.parentWrap) {
          const key = await this.contentKeyOf(r).catch(() => null);
          if (key) { items.push({ id: r.id, parentIdx: idx, parentWrap: await wrapForParent(who.code, who.name, r.id, key) }); patients.add(r.patientIdx); }
        }
      }
      if (items.length >= 200) await flush();
      onProgress?.(++done, rows.length);
    }
    await flush();
    return { updated, patients, noName };
  }

  // ---------- liên thông Bộ Y tế (cổng mô phỏng) ----------
  /** Địa chỉ + khoá công khai của cổng: lấy từ cấu hình có chữ ký registry (ghim), không tin địa chỉ nào khác. */
  private async bytTarget(): Promise<{ url: string; pk: string }> {
    const cfg = await this.config();
    if (!cfg.byt) throw new Error('Máy chủ chưa cấu hình cổng liên thông Bộ Y tế');
    return { url: nodeUrl(cfg.byt.url, this.s.storageBase), pk: cfg.byt.pk };
  }
  /** Gọi cổng bằng chữ ký thiết bị lên từng yêu cầu (method + đường dẫn + thời điểm + băm nội dung). Cổng kiểm tra chứng chỉ registry nên không cần token nào. */
  private async bytCall(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, any>> {
    const { url } = await this.bytTarget();
    const raw = body === undefined ? '' : JSON.stringify(body);
    const ts = String(Date.now());
    const sig = await signWithDevice(this.dk, `byt|${method}|${path}|${ts}|${bytesToHex(sha256(new TextEncoder().encode(raw)))}`);
    const device = btoa(JSON.stringify({ gid: this.s.gid, devicePub: this.s.devicePub, cert: this.s.cert, ...(this.s.account ? { userId: this.s.account.userId, deviceId: this.s.deviceId } : {}) }));
    const r = await this.f(url + path, { method, headers: { 'content-type': 'application/json', 'x-device': device, 'x-ts': ts, 'x-sig': sig }, body: raw || undefined, signal: AbortSignal.timeout(30000) });
    return (await json(r)).body;
  }
  private async verifiedReceipts(list: unknown): Promise<Receipt[]> {
    const { pk } = await this.bytTarget();
    return (Array.isArray(list) ? (list as Receipt[]) : []).filter((r) => verifyReceipt(pk, r));
  }
  /** Cổng có đang hoạt động không, và các mã cơ sở được phép gửi. Khoá công khai cổng tự công bố phải khớp khoá đã ghim. */
  async bytInfo(): Promise<{ facilities: BytFacility[] }> {
    const { url, pk } = await this.bytTarget();
    const r = (await json(await this.f(url + '/byt/info', { signal: AbortSignal.timeout(4000) }))).body as { pk?: string; facilities?: BytFacility[] };
    if (r.pk !== pk) throw new Error('Cổng liên thông không khớp khoá đã được registry công bố');
    return { facilities: r.facilities ?? [] };
  }
  /**
   * Gửi các bản ghi (ĐÃ MÃ HOÁ) lên cổng Bộ Y tế kèm header khoá chung cần thiết; trả về các biên nhận ĐÃ KIỂM CHỮ KÝ theo id bản ghi.
   * Gửi lại bản ghi đã có (cùng nội dung) không tạo biên nhận mới, chỉ làm mới phần ABE.
   */
  async bytSubmit(rows: RecordRow[], maCskcb: string, onProgress?: (done: number, total: number) => void): Promise<{ receipts: Map<string, Receipt>; rejected: { id: string; error: string }[] }> {
    const out = new Map<string, Receipt>();
    const rejected: { id: string; error: string }[] = [];
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await this.fetchHeaders(batch.flatMap((r) => (r.envelope.v === 3 ? [r.envelope.headerId] : [])));
      const headers = [...new Set(batch.flatMap((r) => (r.envelope.v === 3 ? [r.envelope.headerId] : [])))].map((id) => this.headers.get(id)).filter(Boolean);
      const res = await this.bytCall('POST', '/byt/submit', { maCskcb, records: batch, headers });
      for (const r of await this.verifiedReceipts(res.receipts)) out.set(r.recordId, r);
      rejected.push(...((res.rejected as { id: string; error: string }[]) ?? []));
      onProgress?.(Math.min(rows.length, i + 100), rows.length);
    }
    return { receipts: out, rejected };
  }
  /** Bản ghi nào trong danh sách đã được cổng nhận (có biên nhận hợp lệ). Biên nhận sai chữ ký bị bỏ qua. */
  async bytStatus(ids: string[]): Promise<Map<string, Receipt>> {
    const out = new Map<string, Receipt>();
    for (let i = 0; i < ids.length; i += 400) {
      const res = await this.bytCall('POST', '/byt/status', { ids: ids.slice(i, i + 400) });
      for (const r of await this.verifiedReceipts(res.receipts)) out.set(r.recordId, r);
    }
    return out;
  }
  /** Phía Bộ Y tế: tải ciphertext từ cổng (theo đơn vị+loại mục, hoặc theo bệnh nhân). Có đọc được hay không do ABE quyết định khi gọi openRecord/openMany. */
  async bytRecords(q: { group: string; type: RecordType } | { patientCode: string }): Promise<BytRow[]> {
    const path = 'group' in q ? `/byt/records?groupIdx=${this.groupIdx(q.group)}&type=${q.type}` : `/byt/records?patientIdx=${this.patientIdx(q.patientCode)}`;
    const res = await this.bytCall('GET', path);
    for (const h of (res.headers ?? []) as StoredHeader[]) if (h?.id) this.headers.set(h.id, h);          // header khoá chung kèm theo, để openRecord không phải hỏi kho chính
    const { pk } = await this.bytTarget();
    return ((res.records ?? []) as BytRow[]).map((r) => (r.receipt && verifyReceipt(pk, r.receipt) ? r : { ...r, receipt: undefined }));
  }
  async bytStats(): Promise<{ total: number; facilities: { ma: string; ten: string; records: number; patients: number; types: Record<string, number> }[] }> {
    return (await this.bytCall('GET', '/byt/stats')) as never;
  }

  /** Chính sách truy cập của bản ghi (công khai), kể cả khi nằm trong header chung. */
  async policyOf(rec: RecordRow, fresh = false): Promise<string> {
    if (!rec.envelope) return '(không đủ quyền xem)';
    if (rec.envelope.v !== 3) return rec.envelope.abe.policy;
    if (fresh) this.headers.delete(rec.envelope.headerId); // bỏ bản lưu tạm: lấy chính sách hiện hành trên máy chủ
    return (await this.getHeader(rec.envelope.headerId)).policy;
  }

  /** patientIdx -> số mục của hồ sơ mà backend KHÔNG trả vì tài khoản không được xem (chỉ số lượng, không lộ loại/khoa/nội dung). */
  private restricted = new Map<string, number>();
  /** Hồ sơ này còn bao nhiêu mục tài khoản KHÔNG được xem (sau lần listRecords gần nhất). Dùng để giao diện báo rõ, tránh hiểu nhầm phần trống là bình thường. */
  restrictedCount(patientCode: string): number { return this.restricted.get(this.patientIdx(patientCode)) ?? 0; }

  async listRecords(patientCode: string): Promise<RecordRow[]> {
    const idx = this.patientIdx(patientCode);
    const res = await this.f(`${this.s.storageBase}/api/records?patientIdx=${idx}`, { headers: this.auth() });
    const rows = (await json(res)).body as unknown as RecordRow[];
    this.restricted.set(idx, Number(res.headers.get('x-restricted-count') ?? 0) || 0);
    return rows;
  }

  /** Danh sách bản ghi của một đơn vị (mặc định mục hành chính) - dùng cho lưới danh sách. */
  async listGroup(group: string, type: RecordType = 'hanhchinh'): Promise<RecordRow[]> {
    return (await this.get(`/api/records?groupIdx=${this.groupIdx(group)}&type=${type}`)) as unknown as RecordRow[];
  }

  /** Dấu vân tay của danh sách một đơn vị: đổi giá trị nghĩa là có người nhập/sửa hồ sơ. Rất nhẹ, gọi mỗi vài giây. */
  async groupVersion(group: string, type: RecordType = 'hanhchinh'): Promise<string> {
    const v = (await this.get(`/api/records/version?groupIdx=${this.groupIdx(group)}&type=${type}`)) as unknown as { n: number; last: string };
    return `${v.n}|${v.last}`;
  }

  /**
   * Dấu vân tay hồ sơ MỘT bệnh nhân (chỉ tính các mục tài khoản này được xem; không ghi nhật ký, rất nhẹ): đổi giá trị nghĩa là có người vừa nhập/sửa/xoá.
   * App tra cứu hỏi mỗi vài giây; đổi thì mới tải và giải mã lại.
   */
  async patientVersion(patientCode: string): Promise<string> {
    const v = (await this.get(`/api/records/version?patientIdx=${this.patientIdx(patientCode)}`)) as unknown as { n: number; last: string };
    return `${v.n}|${v.last}`;
  }

  /** Chỉ chủ bản ghi (thiết bị đã tạo) mới xoá được; máy chủ ghi nhật ký. */
  async deleteRecord(id: string): Promise<void> {
    await json(await this.f(`${this.s.storageBase}/api/records/${id}`, { method: 'DELETE', headers: this.auth() }));
  }

  /** Giải mã tuần tự nhiều bản ghi (mỗi bản ~50-130 ms); `onProgress` để giao diện hiện tiến độ. Bản không đủ quyền trả null. */
  async openMany(rows: RecordRow[], onProgress?: (done: number, total: number) => void): Promise<(OpenResult | null)[]> {
    const generation = this.begin();
    this.deniedHeaders.clear();
    await this.fetchHeaders(rows.flatMap((r) => (r.envelope?.v === 3 ? [r.envelope.headerId] : [])));
    return this.withEpochScope(async () => {
      const out: (OpenResult | null)[] = [];
      for (const r of rows) {
        try { out.push(await this.openRecord(r)); }
        catch (e) { if (e instanceof RecordIntegrityError) out.push(null); else throw e; }
        this.check(generation);
        onProgress?.(out.length, rows.length);
      }
      return out;
    });
  }

  /** Chỉ mục mù của một nhóm (đơn vị/trường/công ty): HMAC riêng, không đoán ngược được mã nhóm nếu không có khoá chỉ mục. */
  groupIdx(group: string): string {
    if (!this.s.indexKey) throw new Error('Thiết bị chưa được cấp khoá chỉ mục (cần quyền lâm sàng)');
    return bytesToHex(hmac(sha256, hexToBytes(this.s.indexKey), new TextEncoder().encode('GROUP|' + group.trim().toUpperCase()))).slice(0, 32);
  }

  /** Thuộc tính trong policy mà người này CÓ THỂ có (tránh hỏi nút những thứ chắc chắn bị từ chối). */
  private wanted(policy: string, patientIdx: string): string[] {
    const mine = new Set<string>([...this.s.attrs, `MED:Device:${this.s.deviceId}`]);
    if ((this.s.bg[patientIdx] ?? 0) > Date.now()) mine.add(`MED:BG:${patientIdx}`);
    return [...new Set(leavesOf(parsePolicy(policy)))].filter((a) => mine.has(parseVersioned(a)?.base ?? a));
  }

  /** null = không đủ quyền. Ném lỗi nếu bản ghi bị can thiệp (đồng thời báo SIEM). */
  async openRecord(rec: RecordRow): Promise<OpenResult | null> {
    if (!rec.envelope || (rec as { denied?: boolean }).denied) return null;       // backend không trả bản mã cho người sai quyền: hiện khoá
    const generation = this.begin();
    const ctx = `${rec.patientIdx}|${rec.type}|${rec.id}`;
    let plain: Uint8Array | null;
    let sharedHeaderId: string | undefined;
    let sharedDek: Uint8Array | undefined;
    if (rec.envelope.v === 3) {
      const env = rec.envelope;
      const h = await this.getHeader(env.headerId);
      if (this.deniedHeaders.has(h.id)) return null;           // đã biết không đủ quyền: không báo lại cho từng dòng của lô
      sharedHeaderId = h.id;
      sharedDek = this.deks.get(h.id);
      if (!sharedDek) await this.ensureKeys(this.wanted(h.policy, rec.patientIdx));
      try {
        if (!sharedDek) {
          sharedDek = (await openKeyHeader(this.s.gid, this.s.keys, h)) ?? undefined;
          this.check(generation);
          if (sharedDek) this.deks.set(h.id, sharedDek);
        }
        plain = sharedDek ? await decryptShared(sharedDek, rec.id, env, ctx) : null;
      } catch {
        this.check(generation);
        await this.report('DECRYPT_FAIL', 'WARN', `bản ghi ${rec.id}: giải mã thất bại dù đủ thuộc tính trên giấy (khoá lỗi thời hoặc dữ liệu bị sửa)`);
        throw new RecordIntegrityError('Giải mã thất bại: khoá lỗi thời hoặc bản ghi bị can thiệp');
      }
      if (!plain) {
        this.deniedHeaders.add(h.id);
        await this.report('ACCESS_DENIED', 'INFO', `lô bản ghi (header ${h.id}): thuộc tính không thoả policy`);
        return null;
      }
    } else {
      await this.ensureKeys(this.wanted(rec.envelope.abe.policy, rec.patientIdx));
      try {
        plain = await decrypt(this.s.gid, this.s.keys, rec.envelope, ctx);
      } catch (e) {
        this.check(generation);
        await this.report('DECRYPT_FAIL', 'WARN', `bản ghi ${rec.id}: giải mã thất bại dù đủ thuộc tính trên giấy (khoá lỗi thời hoặc dữ liệu bị sửa)`);
        throw new RecordIntegrityError('Giải mã thất bại: khoá lỗi thời hoặc bản ghi bị can thiệp');
      }
      if (!plain) {
        await this.report('ACCESS_DENIED', 'INFO', `bản ghi ${rec.id}: thuộc tính không thoả policy`);
        return null;
      }
    }
    this.check(generation);
    const { body, sig } = JSON.parse(new TextDecoder().decode(plain)) as { body: string; sig: string };
    const parsed = JSON.parse(body) as { data: unknown; khoa?: string; refId?: string; bind?: Record<string, unknown>; author: { name: string; gid: string; deviceId: string; devicePub: string; cert: string; userId?: string } };
    const cfg = await this.config();
    const a = parsed.author;
    const certOk = ed25519.verify(hexToBytes(a.cert), a.userId ? new TextEncoder().encode(certMessage(a.userId, a.gid, a.deviceId, a.devicePub)) : gidMessage(a.gid, a.devicePub), hexToBytes(cfg.registryPk));   // chứng chỉ tài khoản gắn userId + GID + thiết bị + khoá
    // Chữ ký phải khớp: thiết bị tạo, TÀI KHOẢN tác giả (backend gán == người ký trong chứng chỉ), khoa/refId máy chủ trả về == khoa/refId nằm trong phần ĐÃ KÝ (phát hiện sửa nhãn / tráo ngữ cảnh).
    const metaOk = (rec.authorUserId === undefined || a.userId === undefined || rec.authorUserId === a.userId)
      && (parsed.khoa === undefined || parsed.khoa === rec.khoa) && (parsed.refId ?? null) === (rec.refId ?? null);
    const sigOk = certOk && metaOk && a.deviceId === rec.authorDevice && (await verifySig(a.devicePub, `${rec.id}|${rec.patientIdx}|${rec.type}|${body}`, sig));

    // Tự bọc lại khoá nếu policy đã lỗi thời so với epoch hiện hành (thu hồi / hết hạn phá-vỡ-kính / sang tuần mới).
    let rewrapped = false;
    const dir = await this.epochs();
    const profile: RecordProfile = { type: rec.type, khoa: rec.khoa, patientIdx: rec.patientIdx, authorDevice: rec.authorDevice, bulk: rec.envelope.v === 3, authorUserId: rec.authorUserId };
    if (!sigOk) {
      // Bản ghi nghi ngờ (sai chữ ký / sai nhãn): KHÔNG bọc lại khoá, để người dùng thấy cảnh báo thay vì củng cố bản bị sửa.
    } else if (rec.envelope.v === 3) {
      // Bản ghi dùng header chung: chỉ cần bọc lại MỘT header cho cả lô (một lần mỗi phiên).
      const h = this.headers.get(sharedHeaderId!)!;
      const wantPolicy = await this.policyForProfile(profile, dir);
      if (!this.rewrappedHeaders.has(h.id) && h.policy !== wantPolicy) {
        const nh = await rewrapKeyHeader({ MED: cfg.pk }, wantPolicy, sharedDek!);
        const r = await this.f(`${this.s.storageBase}/api/headers/${h.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...this.auth() }, body: JSON.stringify(nh) });
        if (r.ok) { this.headers.set(h.id, { id: h.id, ...nh }); this.rewrappedHeaders.add(h.id); rewrapped = true; }
      }
    } else if (rec.envelope.abe.policy !== (await this.policyForProfile(profile, dir))) {
      const re = await rewrap(this.s.gid, this.s.keys, rec.envelope, { MED: cfg.pk }, await this.policyForProfile(profile, dir));
      if (re) {
        const r = await this.f(`${this.s.storageBase}/api/records/${rec.id}/header`, { method: 'PUT', headers: { 'content-type': 'application/json', ...this.auth() }, body: JSON.stringify(re) });
        rewrapped = r.ok;
      }
    }
    this.check(generation);
    if (rec.type === 'hanhchinh' && sigOk) this.learnPatient(rec.patientIdx, parsed.data);
    return { data: parsed.data, author: { name: a.name, deviceId: a.deviceId, userId: a.userId }, signatureValid: sigOk, rewrapped, signed: { khoa: parsed.khoa, refId: parsed.refId, bind: parsed.bind } };
  }

  /** Phá vỡ kính: kích hoạt ở TẤT CẢ nút (mỗi nút đều ghi log + bắn cảnh báo). Cần >= k nút chấp nhận. */
  async breakGlass(patientCode: string, reason: string): Promise<number> {
    if (this.s.account) throw new Error('Phá vỡ kính chưa có trong chế độ tài khoản (đã bỏ nhánh "phá vỡ kính" khỏi chính sách).');
    const generation = this.begin();
    const k = (await this.config()).k;
    const patientIdx = this.patientIdx(patientCode);
    const ok = await Promise.all(this.s.nodes.map(async (n) => {
      try {
        const r = (await json(await this.f(`${n.url}/breakglass`, post({ patientIdx, reason }, { authorization: `Bearer ${n.token}` })))).body as { until: number };
        return r.until;
      } catch { return null; }
    }));
    this.check(generation);
    const untils = ok.filter((x): x is number => x !== null);
    if (untils.length < k) throw new Error(`Phá-vỡ-kính cần ${k} nút chấp nhận, mới có ${untils.length}`);
    this.s.bg[patientIdx] = Math.min(...untils);
    return this.s.bg[patientIdx];
  }

  async report(type: string, severity: 'INFO' | 'WARN' | 'CRITICAL', detail: string): Promise<void> {
    await this.f(`${this.s.storageBase}/api/events`, post({ type, severity, detail }, this.auth())).catch(() => undefined);
  }
}
