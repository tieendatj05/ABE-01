// Cầu nối tới tiến trình chính (chỉ có khi chạy trong ứng dụng desktop MedABE). Xem desktop/preload.ts.
export interface DeviceBlob {
  hwHash: string;
  sign: { priv: JsonWebKey; pub: JsonWebKey };
  wrap: string;
}
export interface AdminStatus { enrolled: boolean; unlocked: boolean; lockedUntil: number; attemptsLeft: number; setupMode: boolean }
export interface AdminBridge {
  status(): Promise<AdminStatus>;
  /** Gói kích hoạt do chính máy này sinh ra (trạm quản trị nhúng máy chủ); null nếu không có. */
  pending(): Promise<string | null>;
  enroll(pkg: string, password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  changePassword(oldPw: string, newPw: string): Promise<void>;
  reset(password: string): Promise<void>;
  /** Gọi máy chủ/nút bằng token quản trị giữ trong tiến trình chính (giao diện không bao giờ thấy token). */
  call(target: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any }>;
  /** Cảm biến mạng: đọc bảng ARP của card LAN trong tiến trình chính (không phải React). Chỉ Windows. */
  netScan(): Promise<{ iface: string | null; rows: { ip: string; mac: string; state: string }[]; unsupported?: boolean; error?: string }>;
}
export interface Bridge {
  desktop: true;
  network: {
    allowed(base: string): Promise<boolean>;
    probe(base: string): Promise<{ registryPk: string }>;
    discover(): Promise<{ url: string; registryPk: string }[]>;
  };
  /** Chỉ có ở bản "admin" (xem app/desktop/build.mjs); bản "user" không có thuộc tính này. */
  admin?: AdminBridge;
  hardware(): Promise<{ hash: string; host: string; macs: string[] }>;
  loadDevice(): Promise<DeviceBlob | null>;
  saveDevice(d: { sign: DeviceBlob['sign']; wrap: string }): Promise<{ hwHash: string }>;
  getVault(): Promise<string | null>;
  setVault(v: string): Promise<void>;
  wipe(): Promise<void>;
  autoPass: { get(): Promise<string | null>; set(p: string): Promise<void>; clear(): Promise<void> };
  getSetting(k: string): Promise<string | null>;
  setSetting(k: string, v: string): Promise<void>;
  quit(): Promise<void>;
  /** Tự cập nhật: chỉ thay app.asar (giao diện + logic) bằng bản máy chủ đang giữ, rồi tự khởi động lại. */
  update: {
    /** Hash SHA-256 của app.asar đang chạy trên máy này. */
    localHash(): Promise<string | null>;
    /** Tải + áp dụng bản mới từ storageBase rồi tự khởi động lại; ném lỗi nếu máy chủ chưa có bản mới hoặc tải lỗi. */
    apply(storageBase: string): Promise<true>;
  };
}
export const bridge: Bridge | undefined = (globalThis as unknown as { medabe?: Bridge }).medabe;

/** Lỗi từ ipcRenderer.invoke có tiền tố dài dòng - bỏ đi cho người dùng dễ đọc. */
export const cleanIpcError = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
