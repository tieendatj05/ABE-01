import { useEffect, useState, useSyncExternalStore } from 'react';
import { cleanIpcError } from './bridge.js';
import { defaultStorageBase, session } from './session.js';

export function useSession() {
  return useSyncExternalStore((cb) => session.subscribe(cb), () => session.unlocked);
}

/** Online is independent of an unlocked vault: losing LAN must also unmount plaintext pages. */
export function useConnection() {
  return useSyncExternalStore((cb) => session.subscribe(cb), () => session.connectionReady);
}
export function useConnectionGeneration() {
  return useSyncExternalStore((cb) => session.subscribe(cb), () => session.connectionGeneration);
}

// Nhật ký thao tác nhỏ hiển thị cuối trang.
export interface LogLine { t: string; msg: string; cls: string }
let lines: LogLine[] = [];
const subs = new Set<() => void>();
export function log(msg: string, cls = '') {
  lines = [{ t: new Date().toLocaleTimeString(), msg, cls }, ...lines].slice(0, 60);
  subs.forEach((s) => s());
}
export const useLog = () => useSyncExternalStore((cb) => { subs.add(cb); return () => void subs.delete(cb); }, () => lines);

/** Chạy một tác vụ, ghi log kết quả/lỗi; trả về undefined nếu lỗi. */
export async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  log(label + '...');
  try {
    const r = await fn();
    session.touch();
    return r;
  } catch (e) {
    log(`Lỗi: ${cleanIpcError((e as Error).message)}`, 'bad');
    return undefined;
  }
}

/** Địa chỉ máy chủ lưu trữ đã cấu hình (đọc bất đồng bộ từ cài đặt của app). */
export function useBase() {
  const [base, setBase] = useState('');
  useEffect(() => { void defaultStorageBase().then(setBase); }, []);
  return base;
}

/** Trạng thái giờ làm việc (chế độ tài khoản): đóng cửa chỉ khoá thao tác nghiệp vụ, KHÔNG gỡ màn hình/xoá dữ liệu đang nhập. */
export function useBusiness() {
  useSyncExternalStore((cb) => session.subscribe(cb), () => session.business?.open ?? null);
  return session.business;
}
