// Kho khoá KÝ CÁ NHÂN trên một máy, tách theo tên đăng nhập.
//  - "Khoá ký cá nhân": cặp ECDSA P-256 sinh khi người dùng đăng ký thiết bị; backend cấp chứng chỉ gắn userId + GID + deviceId + khoá công khai.
//    Khoá riêng tạo với extractable=false (mã JS dùng được nhưng không xuất ra được).
//  - "Khoá bảo vệ cục bộ thiết bị": lớp bảo vệ của chính máy/trình duyệt (WebCrypto không-xuất-được + IndexedDB cô lập theo origin, hoặc DPAPI ở bản
//    desktop). Đây là lớp KHÁC: nó chỉ bảo vệ việc lưu khoá trên máy, KHÔNG gắn với người dùng và KHÔNG dùng để ký bản ghi.
//  - Hai người dùng cùng máy có hai mục riêng trong kho này (khác khoá, khác deviceId, khác phiên); một ResearchClient chỉ nhìn thấy mục của
//    người đã đăng nhập, và khoá ABE chỉ nằm trong bộ nhớ của đối tượng client đó.
import { bytesToHex } from '@noble/hashes/utils.js';

export interface LocalDevice {
  username: string;
  userId: string;
  deviceId: string;
  signPub: string;          // hex 130 ký tự (04||X||Y)
  signKey: CryptoKey;       // khoá riêng KHÔNG xuất được
}

export interface DeviceKeyStore {
  get(username: string): Promise<LocalDevice | null>;
  put(d: LocalDevice): Promise<void>;
  remove(username: string): Promise<void>;
  list(): Promise<string[]>;
}

export class MemoryDeviceKeyStore implements DeviceKeyStore {
  private m = new Map<string, LocalDevice>();
  async get(username: string) { return this.m.get(username.toLowerCase()) ?? null; }
  async put(d: LocalDevice) { this.m.set(d.username.toLowerCase(), d); }
  async remove(username: string) { this.m.delete(username.toLowerCase()); }
  async list() { return [...this.m.keys()]; }
}

export async function newSignKey(): Promise<{ key: CryptoKey; pub: string }> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  return { key: kp.privateKey, pub: bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))) };
}

export async function signHex(key: CryptoKey, message: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(message) as BufferSource)));
}
