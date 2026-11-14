// Phiên làm việc của giao diện. Trong ứng dụng desktop: khoá thiết bị do tiến trình chính cất bằng kho khoá Windows (DPAPI)
// và buộc vào phần cứng máy; kho khoá (vault) là file trong thư mục dữ liệu của app. Chạy trong trình duyệt (chỉ để phát
// triển) thì dùng IndexedDB + localStorage với khoá không xuất ra được.
import { loadOrCreateDeviceKeys, openVault, sealVault, type DeviceKeys, type KeyStore, type SealedVault } from '../../../security/src/index.js';
import { MedClient, SessionExpiredError, type ClientState } from '../../../security/src/index.js';
import { IdbDeviceKeyStore } from '../../research/src/idb-store.js';
import { bridge, cleanIpcError } from './bridge.js';

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Khoá thiết bị do app desktop quản lý: sinh trong giao diện, giao main cất (DPAPI + phần cứng), nạp lại dạng không xuất ra được. */
class DesktopKeyStore implements KeyStore {
  private async import(d: { sign: { priv: JsonWebKey; pub: JsonWebKey }; wrap: string }): Promise<DeviceKeys> {
    const alg = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    return {
      sign: {
        privateKey: await crypto.subtle.importKey('jwk', d.sign.priv, alg, false, ['sign']),
        publicKey: await crypto.subtle.importKey('jwk', d.sign.pub, alg, true, ['verify']),
      },
      wrap: await crypto.subtle.importKey('raw', unb64(d.wrap) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']),
    };
  }
  async load() {
    const d = await bridge!.loadDevice();
    return d ? this.import(d) : null;
  }
  async save(): Promise<void> { throw new Error('dùng createKeys'); }
  async createKeys() {
    const sign = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const blob = {
      sign: { priv: await crypto.subtle.exportKey('jwk', sign.privateKey), pub: await crypto.subtle.exportKey('jwk', sign.publicKey) },
      wrap: b64(crypto.getRandomValues(new Uint8Array(32))),
    };
    await bridge!.saveDevice(blob);
    return this.import(blob);
  }
}

class IdbKeyStore implements KeyStore {
  private db(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const r = indexedDB.open('medabe-device', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('keys');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async load(): Promise<DeviceKeys | null> {
    const db = await this.db();
    return new Promise((res, rej) => {
      const q = db.transaction('keys').objectStore('keys').get('device');
      q.onsuccess = () => res((q.result as DeviceKeys) ?? null);
      q.onerror = () => rej(q.error);
    });
  }
  async save(k: DeviceKeys): Promise<void> {
    const db = await this.db();
    return new Promise((res, rej) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(k, 'device');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}

const VAULT = 'medabe.vault';
const BASE = 'medabe.storage';
const IDLE_MS = 5 * 60_000;

export const isDesktop = !!bridge;
const fallbackBase = () => (bridge ? 'http://localhost:8090' : `https://${location.hostname || 'localhost'}:8443`);   // trình duyệt: cùng máy với trang đang mở
export const defaultStorageBase = async () =>
  (bridge ? await bridge.getSetting('storage') : localStorage.getItem(BASE)) ?? fallbackBase();
export const setStorageBase = async (u: string) => {
  const v = u.replace(/\/+$/, '');
  if (bridge) await bridge.setSetting('storage', v); else localStorage.setItem(BASE, v);
};
const readVault = async () => (bridge ? bridge.getVault() : localStorage.getItem(VAULT));
const writeVault = async (v: string) => { if (bridge) await bridge.setVault(v); else localStorage.setItem(VAULT, v); };
export const hasVault = async () => !!(await readVault());
export const wipeVault = async () => { if (bridge) await bridge.wipe(); else localStorage.removeItem(VAULT); };
export const isAutoUnlockCapable = () => !!bridge;
export const hardwareInfo = () => bridge?.hardware();

type Listener = () => void;
class Session {
  client: MedClient | null = null;
  connectionReady = false;
  connectionGeneration = 0;
  private connectionAttempt = 0;
  private pass = '';
  private keys: DeviceKeys | null = null;
  private store: KeyStore = bridge ? new DesktopKeyStore() : new IdbKeyStore();
  private timer?: ReturnType<typeof setTimeout>;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<Listener>();

  subscribe(l: Listener) { this.listeners.add(l); return () => void this.listeners.delete(l); }
  private emit() { this.listeners.forEach((l) => l()); }
  get unlocked() { return !!this.client; }
  /** Chế độ tự mở khoá (không hỏi passphrase): không có khoá thủ công/ tự khoá khi rảnh vì chẳng có bí mật nào để nhập lại. */
  autoMode = false;

  async deviceKeys() {
    try {
      return (this.keys ??= await loadOrCreateDeviceKeys(this.store));
    } catch (e) {
      throw new Error(cleanIpcError((e as Error).message));
    }
  }

  /** Trạng thái giờ làm việc của chế độ tài khoản (cập nhật mỗi lần kiểm tra kết nối). */
  business: { open: boolean; nextOpenAt: string | null; closesAt: string | null } | null = null;
  private accountStore = new IdbDeviceKeyStore();

  /**
   * ĐĂNG NHẬP BẰNG TÀI KHOẢN (email + mật khẩu do công ty cấp). Khoá ký cá nhân của từng người nằm riêng trong kho của máy (không chia sẻ giữa hai người cùng máy);
   * vai trò/khoa/quyền do máy chủ quyết định. Không còn kho khoá bằng passphrase hay đăng ký thiết bị "nhập tên".
   */
  async signIn(storageBase: string, email: string, password: string, newPassword?: string) {
    const base = storageBase.replace(/\/+$/, '');
    if (!base) throw new Error('Hãy nhập địa chỉ máy chủ');
    const c = await MedClient.signIn(base, email, password, this.accountStore, { newPassword });
    await setStorageBase(base);
    this.client?.suspendNetwork();
    this.client = c; c.onDisconnect = () => this.suspendNetwork(); this.autoMode = false; this.pass = ''; this.business = null; this.connectionReady = false;
    this.touch(); this.emit();
  }

  /** Đăng xuất: bỏ phiên + khoá khỏi bộ nhớ (backend thu hồi phiên). */
  async signOut() {
    const c = this.client;
    clearTimeout(this.timer); clearTimeout(this.persistTimer);
    // Thu hồi phiên ở backend TRƯỚC khi ngắt mạng máy khách (sau suspendNetwork() mọi lời gọi đều bị hủy => phiên cũ vẫn sống đến khi hết hạn nhàn rỗi).
    if (c?.s.account) await c.api('POST', '/api/v2/auth/logout').catch(() => undefined);
    this.suspendNetwork(); this.client = null; this.pass = ''; this.business = null;
    this.emit();
  }

  /** Đăng ký thiết bị mới với registry rồi nhận khoá từ các nút bằng các mã đã được cấp. */
  async setup(storageBase: string, invite: string, nodeCodes: [string, string][], pass: string) {
    if (pass.length < 8) throw new Error('Passphrase tối thiểu 8 ký tự');
    const base = storageBase.replace(/\/+$/, '');
    await setStorageBase(base);
    const dk = await this.deviceKeys();
    const hw = bridge ? (await bridge.hardware()).hash : undefined;
    const c = await MedClient.register(base, invite.trim(), dk, undefined, hw);
    for (const [org, code] of nodeCodes) await c.claim(org, code);
    this.client = c; c.onDisconnect = () => this.suspendNetwork(); this.pass = pass;
    await this.persistNow();
    this.touch(); this.emit();
  }

  /**
   * ĐĂNG KÝ NHANH: chỉ cần tên. Máy chủ/nút cấp bộ quyền mặc định do admin đặt (người dùng không chọn quyền).
   * autoUnlock=true: mật khẩu kho khoá là chuỗi ngẫu nhiên do app cất bằng DPAPI + phần cứng, lần sau tự mở; false: dùng passphrase.
   */
  async quickSetup(storageBase: string, name: string, autoUnlock: boolean, passphrase = '') {
    if (!name.trim()) throw new Error('Hãy nhập họ tên');
    if (!autoUnlock && passphrase.length < 8) throw new Error('Passphrase tối thiểu 8 ký tự');
    const base = storageBase.replace(/\/+$/, '');
    await setStorageBase(base);
    const dk = await this.deviceKeys();
    const hw = bridge ? (await bridge.hardware()).hash : undefined;
    const pass = autoUnlock ? b64(crypto.getRandomValues(new Uint8Array(32))) : passphrase;
    await MedClient.registerOpen(base, name.trim(), dk, undefined, hw, async (c) => {
      this.client = c; c.onDisconnect = () => this.suspendNetwork(); this.pass = pass; this.autoMode = autoUnlock;
      await this.persistNow();
      if (autoUnlock) await bridge!.autoPass.set(pass);
    });
    this.touch(); this.emit();
  }

  /** Mở tự động nếu máy này đã chọn chế độ tự mở khoá. Trả về true nếu đã mở. */
  async tryAutoUnlock(): Promise<boolean> {
    if (!bridge || this.client) return !!this.client;
    const pass = await bridge.autoPass.get().catch(() => null);
    if (!pass) return false;
    try {
      await this.unlock(pass);
      this.autoMode = true;
      return true;
    } catch {
      return false;
    }
  }

  async unlock(pass: string) {
    const raw = await readVault();
    if (!raw) throw new Error('Chưa có kho khoá');
    const dk = await this.deviceKeys();
    const state = await openVault<ClientState>(JSON.parse(raw) as SealedVault, pass, dk);
    this.client = new MedClient(state, dk); this.client.onDisconnect = () => this.suspendNetwork(); this.client.suspendNetwork(); this.connectionReady = false; this.pass = pass;
    this.touch(); this.emit();
  }

  suspendNetwork() {
    ++this.connectionAttempt;
    this.client?.suspendNetwork();
    if (this.connectionReady) ++this.connectionGeneration;
    this.connectionReady = false;
    clearTimeout(this.persistTimer);
    this.emit();
  }

  async reconnect(base: string) {
    const client = this.client;
    if (!client) throw new Error('Hãy mở khoá thiết bị trước');
    const attempt = ++this.connectionAttempt;
    await client.reconnect(base);
    if (attempt !== this.connectionAttempt || client !== this.client) throw new Error('Phiên kết nối đã thay đổi');
    if (client.s.pendingEnrollment) {
      const claimed = await client.claimAllOpen(() => this.persistNow());
      if (claimed < (await client.config()).k) throw new Error('Chưa đủ nút cấp khóa. Ứng dụng sẽ thử tiếp khi kết nối ổn định.');
      client.s.pendingEnrollment = false;
    }
    await client.checkConnection();
    await setStorageBase(client.s.storageBase);
    await this.persistNow();
    if (attempt !== this.connectionAttempt || client !== this.client) throw new Error('Phiên kết nối đã thay đổi');
    this.connectionReady = true; ++this.connectionGeneration;
    this.emit();
  }

  async checkConnection() {
    if (!this.client || !this.connectionReady) throw new Error('Chưa kết nối máy chủ KSK');
    const client = this.client, attempt = this.connectionAttempt;
    try {
      await client.checkConnection();
      if (client.s.account) {
        const b = client.business, was = this.business;
        this.business = b ? { open: b.open, nextOpenAt: b.nextOpenAt, closesAt: b.closesAt } : null;
        if (was?.open !== this.business?.open) this.emit();       // đóng/mở cửa: báo giao diện, KHÔNG gỡ màn hình đang nhập
      }
    } catch (e) {
      if (e instanceof SessionExpiredError) { void this.signOut(); throw e; }
      if (attempt === this.connectionAttempt) this.suspendNetwork();
      throw e;
    }
    if (attempt !== this.connectionAttempt || client !== this.client) throw new Error('Phiên kết nối đã thay đổi');
  }

  async addNodeCode(org: string, code: string) {
    await this.client!.claim(org, code);
    await this.persistNow();
    this.emit();
  }

  lock() {
    if (this.client?.s.account) { void this.signOut(); return; }       // tài khoản: hết nhàn rỗi = đăng xuất, đăng nhập lại bằng mật khẩu
    if (this.autoMode) return; // tự mở khoá: không có gì để nhập lại
    clearTimeout(this.timer); clearTimeout(this.persistTimer);
    this.suspendNetwork(); this.client = null; this.pass = '';
    this.emit();
  }

  private async persistNow() {
    if (!this.client || !this.pass || this.client.s.account) return;       // chế độ tài khoản: không có kho khoá bằng passphrase để lưu
    await writeVault(JSON.stringify(await sealVault(this.client.s, this.pass, await this.deviceKeys())));
  }
  /** Gọi sau mỗi thao tác làm thay đổi khoá/trạng thái; gom lại để không băm PBKDF2 liên tục. */
  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persistNow(), 3000);
  }
  touch() {
    clearTimeout(this.timer);
    if (this.autoMode) return;
    this.timer = setTimeout(() => { void this.persistNow().finally(() => this.lock()); }, this.client?.s.account ? 30 * 60_000 : IDLE_MS);   // tài khoản: 30 phút không thao tác thì đăng xuất
  }
}

export const session = new Session();
