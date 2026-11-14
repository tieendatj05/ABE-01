// Kho khoá KÝ cá nhân trong trình duyệt: IndexedDB lưu CryptoKey KHÔNG xuất được (structured clone). Mỗi người dùng một mục riêng.
// Lưu ý: đây là bảo vệ của trình duyệt/hệ điều hành cho khoá ký, không phải token phần cứng.
import type { DeviceKeyStore, LocalDevice } from '../../../security/src/research/keys.js';

const DB = 'medabe-research-keys', STORE = 'devices';
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'username' });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export class IdbDeviceKeyStore implements DeviceKeyStore {
  async get(username: string) { return ((await run('readonly', (s) => s.get(username.toLowerCase()))) as LocalDevice | undefined) ?? null; }
  async put(d: LocalDevice) { await run('readwrite', (s) => s.put({ ...d, username: d.username.toLowerCase() })); }
  async remove(username: string) { await run('readwrite', (s) => s.delete(username.toLowerCase())); }
  async list() { return (await run('readonly', (s) => s.getAllKeys())) as string[]; }
}
