// Khoá thiết bị + kho khoá hai lớp.
//  - Khoá ký ECDSA P-256 và khoá AES "bọc kho" đều tạo với extractable=false: mã JS (kể cả bị XSS) có thể DÙNG nhưng
//    không thể XUẤT khoá ra, nên sao chép kho khoá sang máy khác là vô dụng (ràng buộc thiết bị trong trình duyệt;
//    bản thật nên dùng WebAuthn/TPM).
//  - Kho khoá = AES-GCM( khoá-thiết-bị , AES-GCM( PBKDF2(passphrase) , dữ liệu ) ).
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export interface DeviceKeys { sign: CryptoKeyPair; wrap: CryptoKey }

/** Nơi cất CryptoKey: IndexedDB trong trình duyệt (xem web/), bộ nhớ trong test. */
export interface KeyStore {
  load(): Promise<DeviceKeys | null>;
  save(k: DeviceKeys): Promise<void>;
  /** Cửa hàng tự sinh khoá (vd app desktop sinh khoá rồi giao tiến trình chính cất bằng kho khoá hệ điều hành). */
  createKeys?(): Promise<DeviceKeys>;
}

export class MemoryKeyStore implements KeyStore {
  private k: DeviceKeys | null = null;
  async load() { return this.k; }
  async save(k: DeviceKeys) { this.k = k; }
}

export async function loadOrCreateDeviceKeys(store: KeyStore): Promise<DeviceKeys> {
  const have = await store.load();
  if (have) return have;
  if (store.createKeys) return store.createKeys();
  const sign = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  const wrap = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const keys = { sign, wrap };
  await store.save(keys);
  return keys;
}

export async function devicePubHex(k: DeviceKeys): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', k.sign.publicKey))); // khoá CÔNG KHAI xuất được
}

export async function signWithDevice(k: DeviceKeys, msg: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.sign.privateKey, new TextEncoder().encode(msg) as BufferSource);
  return bytesToHex(new Uint8Array(sig));
}

export async function verifySig(pubHex: string, msg: string, sigHex: string): Promise<boolean> {
  const pub = await crypto.subtle.importKey('raw', hexToBytes(pubHex) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, hexToBytes(sigHex) as BufferSource, new TextEncoder().encode(msg) as BufferSource);
}

// ---------- kho khoá ----------
export interface SealedVault { v: 2; iter: number; salt: string; iv1: string; iv2: string; ct: string }
const ITER = 600_000;

async function passKey(pass: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealVault(data: unknown, pass: string, dev: DeviceKeys, iter = ITER): Promise<SealedVault> {
  if (pass.length < 8) throw new Error('Passphrase tối thiểu 8 ký tự');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv1 = crypto.getRandomValues(new Uint8Array(12));
  const iv2 = crypto.getRandomValues(new Uint8Array(12));
  const inner = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv1 }, await passKey(pass, salt, iter), new TextEncoder().encode(JSON.stringify(data)));
  const outer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, dev.wrap, inner);
  return { v: 2, iter, salt: bytesToHex(salt), iv1: bytesToHex(iv1), iv2: bytesToHex(iv2), ct: bytesToHex(new Uint8Array(outer)) };
}

export async function openVault<T>(v: SealedVault, pass: string, dev: DeviceKeys): Promise<T> {
  let inner: ArrayBuffer;
  try {
    inner = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(v.iv2) as BufferSource }, dev.wrap, hexToBytes(v.ct) as BufferSource);
  } catch {
    throw new Error('Kho khoá này không thuộc về thiết bị hiện tại (đã bị sao chép sang máy khác?)');
  }
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(v.iv1) as BufferSource }, await passKey(pass, hexToBytes(v.salt), v.iter), inner);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    throw new Error('Sai passphrase');
  }
}
