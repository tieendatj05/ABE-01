import { requestServerProof } from './server-proof.js';
import { verifyReceipt, type Receipt } from '../byt/receipt.js';
// Thư viện phía thiết bị cho ứng dụng y tế. Mọi mã hoá/giải mã/ký diễn ra Ở ĐÂY; máy chủ lưu trữ và các nút
// cấp khoá không bao giờ thấy plaintext. Bác sĩ chỉ gọi saveRecord/openRecord - policy, khoá, epoch, bọc lại khoá
// đều tự động.
import { nodeUrl, storageUrl } from './connection.js';
import { clearParentCache, normDob, parentIdxOf, wrapForParent, type ParentWrap } from './parent.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { leavesOf, parsePolicy } from '../abe/policy.js';
import {
  combineKey, decrypt, sharedRecordKey, decryptShared, encrypt, encryptShared, newKeyHeader, openDek, openKeyHeader, rewrap, rewrapKeyHeader,
  type AttrKey, type AuthorityPublic, type Envelope, type KeyHeader, type Partial, type SharedEnvelope,
} from '../abe/rw15.js';
import { parseVersioned, type EpochDirectory } from '../common/epoch.js';
import { devicePubHex, signWithDevice, verifySig, type DeviceKeys } from './device.js';
import { isStale, policyFor, SECTION_TYPES, type RecordProfile, type RecordType } from './policy.js';

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
  shared?: Record<string, string>;      // chính sách -> id header dùng chung đã tạo (không bí mật; DEK lấy lại bằng cách mở header)
}
export interface RecordRow {
  id: string; patientIdx: string; groupIdx?: string; type: RecordType; khoa: string; authorDevice: string;
  envelope: Envelope | SharedEnvelope; createdAt: string; parentIdx?: string; parentWrap?: ParentWrap;
}
type StoredHeader = KeyHeader & { id: string };
interface ServerConfig { registryPk: string; k: number; pk: AuthorityPublic; nodes: { org: string; url: string }[]; byt?: { url: string; pk: string } }
export interface BytFacility { ma: string; ten: string }
export type BytRow = RecordRow & { receipt?: Receipt };
export interface OpenResult {
  data: unknown;
  author: { name: string; deviceId: string };
  signatureValid: boolean;
  rewrapped: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
async function json(r: Response) {
  const j = await r.json().catch((e: unknown) => { if (e instanceof SyntaxError) return {}; throw e; });
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
      if (target.hostname !== new URL(this.s.storageBase).hostname) throw new Error('Nút cấp khóa phải thuộc máy chủ LAN đã xác minh');
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

  private auth() { return { authorization: `Bearer ${this.s.token}` }; }
  private async get(path: string) { return (await json(await this.f(`${this.s.storageBase}${path}`, { headers: this.auth() }))).body; }

  /** Xoá cả DEK/header đã nhớ khi làm mới quyền; nội dung đã tải về trước đó không thể thu lại. */
  resetKeys() {
    this.s.keys = {}; clearParentCache(); this.patients.clear();
    for (const key of this.deks.values()) key.fill(0);
    this.headers.clear(); this.deks.clear(); this.deniedHeaders.clear(); this.rewrappedHeaders.clear();
  }

  /** Chỉ mang token sang địa chỉ mới nếu máy chủ dùng đúng registry đã cấp chứng chỉ thiết bị. */
  private async verifiedConfig(base: string, signal?: AbortSignal): Promise<ServerConfig> {
    const proof = await requestServerProof(base, this.rawFetch, this.cfgCache?.registryPk, signal);
    if (!ed25519.verify(hexToBytes(this.s.cert), gidMessage(this.s.gid, this.s.devicePub), hexToBytes(proof.registryPk)))
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
      if (new URL(url).hostname !== new URL(base).hostname) throw new Error('Nút cấp khóa nằm ngoài máy chủ LAN đã xác minh');
      return { ...n, url };
    });
    this.abort.abort(); this.abort = new AbortController(); ++this.generation;
    this.s.storageBase = base; this.s.nodes = nodes; this.cfgCache = cfg; this.resetKeys(); this.online = true;
  }
  async checkConnection(): Promise<void> {
    const generation = this.begin();
    await this.verifiedConfig(this.s.storageBase, this.abort.signal); this.check(generation);
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

  /** Bảo đảm có khoá cho các thuộc tính (đã phiên bản) cần dùng; hỏi >= k nút đồng thuận. Trả về các thuộc tính vẫn thiếu. */
  async ensureKeys(attrs: string[]): Promise<string[]> {
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
  async saveRecord(input: { patientCode: string; type: RecordType; khoa: string; data: unknown; group?: string; dob?: string }): Promise<string> {
    const generation = this.begin();
    if (input.type === 'hanhchinh') return (await this.saveMany([{ ...input, type: 'hanhchinh' }]))[0]; // dùng header chung
    const [cfg, dir] = await Promise.all([this.config(), this.epochs()]);
    const patientIdx = this.patientIdx(input.patientCode);
    const groupIdx = input.group ? this.groupIdx(input.group) : undefined;
    const id = crypto.randomUUID();
    const profile: RecordProfile = { type: input.type, khoa: input.khoa, patientIdx, authorDevice: this.s.deviceId };
    const body = JSON.stringify({
      data: input.data, ts: new Date().toISOString(),
      author: { name: this.s.name, gid: this.s.gid, deviceId: this.s.deviceId, devicePub: this.s.devicePub, cert: this.s.cert },
    });
    const sig = await signWithDevice(this.dk, `${id}|${patientIdx}|${input.type}|${body}`);
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const dob = await this.dobFor(input.patientCode, patientIdx, input.dob); this.check(generation);
    const envelope = await encrypt({ MED: cfg.pk }, policyFor(profile, dir), new TextEncoder().encode(JSON.stringify({ body, sig })), `${patientIdx}|${input.type}|${id}`, dek);
    const parent = await this.forParent(input.patientCode, dob, id, dek); this.check(generation);
    await json(await this.f(`${this.s.storageBase}/api/records`, post({ id, patientIdx, groupIdx, type: input.type, khoa: input.khoa, authorDevice: this.s.deviceId, envelope, ...parent }, this.auth())));
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
    const policy = policyFor(profile, dir);
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
  async saveMany(inputs: { patientCode: string; type: RecordType; khoa: string; data: unknown; group?: string; dob?: string }[], onProgress?: (done: number, total: number) => void): Promise<string[]> {
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
        const dob = await this.dobFor(input.patientCode, patientIdx, input.dob);
        const profile: RecordProfile = { type: input.type, khoa: input.khoa, patientIdx, authorDevice: this.s.deviceId, bulk: true };
        const hk = `${input.type}|${input.khoa}`;
        let header = headers.get(hk);
        if (!header) { header = await this.sharedHeader(profile, dir); headers.set(hk, header); }
        const id = crypto.randomUUID();
        const body = JSON.stringify({
          data: input.data, ts: new Date().toISOString(),
          author: { name: this.s.name, gid: this.s.gid, deviceId: this.s.deviceId, devicePub: this.s.devicePub, cert: this.s.cert },
        });
        const sig = await signWithDevice(this.dk, `${id}|${patientIdx}|${input.type}|${body}`);
        const envelope = await encryptShared(header.dek, header.id, id, new TextEncoder().encode(JSON.stringify({ body, sig })), `${patientIdx}|${input.type}|${id}`);
        batch.push({ id, patientIdx, groupIdx: input.group ? this.groupIdx(input.group) : undefined, type: input.type, khoa: input.khoa, authorDevice: this.s.deviceId, envelope, ...(await this.forParent(input.patientCode, dob, id, sharedRecordKey(header.dek, id))) });
        ids.push(id);
        if (batch.length >= 100) await flush();
        onProgress?.(ids.length, inputs.length);
      }
      await flush();
      this.check(generation);
      return ids;
    });
  }

  // ---------- tra cứu của phụ huynh (CCCD + ngày sinh) ----------
  /** patientIdx -> (mã bệnh nhân, ngày sinh) học được từ mục Hành chính đã lưu/giải mã trong phiên. Chỉ nằm trong bộ nhớ. */
  private patients = new Map<string, { code: string; dob: string }>();

  /** Ghi nhớ ngày sinh từ dữ liệu Hành chính (chỉ khi CCCD trong dữ liệu khớp đúng chỉ mục của bản ghi). */
  private learnPatient(patientIdx: string, data: unknown) {
    const d = data as { cccd?: unknown; ngaySinh?: unknown } | undefined;
    const dob = normDob(String(d?.ngaySinh ?? ''));
    const code = String(d?.cccd ?? '');
    if (dob && code && this.patientIdx(code) === patientIdx) this.patients.set(patientIdx, { code, dob });
  }

  /** Ngày sinh để bọc khoá cho phụ huynh: tham số truyền vào > đã nhớ trong phiên > tự mở mục Hành chính mới nhất của người đó. '' = không biết. */
  private async dobFor(patientCode: string, patientIdx: string, given?: string): Promise<string> {
    const g = normDob(given ?? '');
    if (g) return g;
    const known = this.patients.get(patientIdx)?.dob;
    if (known) return known;
    try {
      const hc = (await this.listRecords(patientCode)).filter((r) => r.type === 'hanhchinh').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop();
      if (hc) await this.openRecord(hc);           // openRecord tự ghi nhớ ngày sinh
    } catch { /* không mở được: bản ghi này không có đường tra cứu cho phụ huynh */ }
    return this.patients.get(patientIdx)?.dob ?? '';
  }

  /** Bản bọc khoá nội dung cho phụ huynh + chỉ mục tra cứu, gửi kèm bản ghi. Không biết ngày sinh => không bọc (phụ huynh không thấy bản ghi này). */
  private async forParent(patientCode: string, dob: string, recordId: string, contentKey: Uint8Array): Promise<{ parentIdx?: string; parentWrap?: ParentWrap }> {
    if (!dob) return {};
    return { parentIdx: parentIdxOf(patientCode, dob), parentWrap: await wrapForParent(patientCode, dob, recordId, contentKey) };
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
   * Cập nhật lại đường tra cứu của phụ huynh (CCCD + ngày sinh) cho MỌI bản ghi của một đơn vị: dùng cho dữ liệu lưu từ trước khi đổi cách tra
   * cứu, hoặc sau khi sửa ngày sinh. Máy này giải mã khoá nội dung bằng ABE rồi bọc thêm dưới khoá gia đình; dữ liệu mã hoá giữ nguyên.
   * Trả về các patientIdx đã cập nhật (để gửi lại lên cổng Bộ Y tế).
   */
  async refreshParentAccess(group: string, onProgress?: (done: number, total: number) => void): Promise<{ updated: number; patients: Set<string>; noDob: number }> {
    const generation = this.begin();
    const hcRows = await this.listGroup(group, 'hanhchinh');
    await this.openMany(hcRows);                                // ghi nhớ CCCD + ngày sinh của cả đơn vị
    const rows: RecordRow[] = [...hcRows];
    for (const t of SECTION_TYPES) if (t !== 'hanhchinh') rows.push(...(await this.listGroup(group, t)));
    this.check(generation);
    const items: { id: string; parentIdx: string; parentWrap: ParentWrap }[] = [];
    const patients = new Set<string>();
    let noDob = 0, done = 0, updated = 0;
    const flush = async () => {
      if (!items.length) return;
      const res = await json(await this.f(`${this.s.storageBase}/api/records/parent-wraps`, { method: 'PUT', headers: { 'content-type': 'application/json', ...this.auth() }, body: JSON.stringify({ items: items.splice(0) }) }));
      updated += (res.body as { updated: number }).updated;
    };
    for (const r of rows) {
      this.check(generation);
      const who = this.patients.get(r.patientIdx);
      if (!who) noDob++;
      else {
        const idx = parentIdxOf(who.code, who.dob);
        if (r.parentIdx !== idx || !r.parentWrap) {
          const key = await this.contentKeyOf(r).catch(() => null);
          if (key) { items.push({ id: r.id, parentIdx: idx, parentWrap: await wrapForParent(who.code, who.dob, r.id, key) }); patients.add(r.patientIdx); }
        }
      }
      if (items.length >= 200) await flush();
      onProgress?.(++done, rows.length);
    }
    await flush();
    return { updated, patients, noDob };
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
    const device = btoa(JSON.stringify({ gid: this.s.gid, devicePub: this.s.devicePub, cert: this.s.cert }));
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
    if (rec.envelope.v !== 3) return rec.envelope.abe.policy;
    if (fresh) this.headers.delete(rec.envelope.headerId); // bỏ bản lưu tạm: lấy chính sách hiện hành trên máy chủ
    return (await this.getHeader(rec.envelope.headerId)).policy;
  }

  async listRecords(patientCode: string): Promise<RecordRow[]> {
    return (await this.get(`/api/records?patientIdx=${this.patientIdx(patientCode)}`)) as unknown as RecordRow[];
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

  /** Chỉ chủ bản ghi (thiết bị đã tạo) mới xoá được; máy chủ ghi nhật ký. */
  async deleteRecord(id: string): Promise<void> {
    await json(await this.f(`${this.s.storageBase}/api/records/${id}`, { method: 'DELETE', headers: this.auth() }));
  }

  /** Giải mã tuần tự nhiều bản ghi (mỗi bản ~50-130 ms); `onProgress` để giao diện hiện tiến độ. Bản không đủ quyền trả null. */
  async openMany(rows: RecordRow[], onProgress?: (done: number, total: number) => void): Promise<(OpenResult | null)[]> {
    const generation = this.begin();
    this.deniedHeaders.clear();
    await this.fetchHeaders(rows.flatMap((r) => (r.envelope.v === 3 ? [r.envelope.headerId] : [])));
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
    const parsed = JSON.parse(body) as { data: unknown; author: { name: string; gid: string; deviceId: string; devicePub: string; cert: string } };
    const cfg = await this.config();
    const a = parsed.author;
    const certOk = ed25519.verify(hexToBytes(a.cert), gidMessage(a.gid, a.devicePub), hexToBytes(cfg.registryPk));
    const sigOk = certOk && a.deviceId === rec.authorDevice && (await verifySig(a.devicePub, `${rec.id}|${rec.patientIdx}|${rec.type}|${body}`, sig));

    // Tự bọc lại khoá nếu policy đã lỗi thời so với epoch hiện hành (thu hồi / hết hạn phá-vỡ-kính / sang tuần mới).
    let rewrapped = false;
    const dir = await this.epochs();
    const profile: RecordProfile = { type: rec.type, khoa: rec.khoa, patientIdx: rec.patientIdx, authorDevice: rec.authorDevice, bulk: rec.envelope.v === 3 };
    if (rec.envelope.v === 3) {
      // Bản ghi dùng header chung: chỉ cần bọc lại MỘT header cho cả lô (một lần mỗi phiên).
      const h = this.headers.get(sharedHeaderId!)!;
      if (!this.rewrappedHeaders.has(h.id) && isStale(h.policy, profile, dir)) {
        const nh = await rewrapKeyHeader({ MED: cfg.pk }, policyFor(profile, dir), sharedDek!);
        const r = await this.f(`${this.s.storageBase}/api/headers/${h.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...this.auth() }, body: JSON.stringify(nh) });
        if (r.ok) { this.headers.set(h.id, { id: h.id, ...nh }); this.rewrappedHeaders.add(h.id); rewrapped = true; }
      }
    } else if (isStale(rec.envelope.abe.policy, profile, dir)) {
      const re = await rewrap(this.s.gid, this.s.keys, rec.envelope, { MED: cfg.pk }, policyFor(profile, dir));
      if (re) {
        const r = await this.f(`${this.s.storageBase}/api/records/${rec.id}/header`, { method: 'PUT', headers: { 'content-type': 'application/json', ...this.auth() }, body: JSON.stringify(re) });
        rewrapped = r.ok;
      }
    }
    this.check(generation);
    if (rec.type === 'hanhchinh' && sigOk) this.learnPatient(rec.patientIdx, parsed.data);
    return { data: parsed.data, author: { name: a.name, deviceId: a.deviceId }, signatureValid: sigOk, rewrapped };
  }

  /** Phá vỡ kính: kích hoạt ở TẤT CẢ nút (mỗi nút đều ghi log + bắn cảnh báo). Cần >= k nút chấp nhận. */
  async breakGlass(patientCode: string, reason: string): Promise<number> {
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
