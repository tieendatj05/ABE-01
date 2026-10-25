import { useEffect, useState } from 'react';
import { bridge, type AdminStatus } from './bridge.js';

/** Có phần quản trị trong bản build này không (bản "user" bị loại bỏ hoàn toàn). */
export const ADMIN_EDITION = typeof __EDITION__ === 'undefined' || __EDITION__ !== 'user';

/** Gọi máy chủ/nút bằng token quản trị trong tiến trình chính. Ném lỗi nếu thiết bị không phải trạm quản trị hoặc chưa mở khoá. */
export async function adm(target: 'storage' | 'BenhVien' | 'SoYTe' | 'DienThoai', method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  const a = bridge?.admin;
  if (!a) throw new Error('Thiết bị này không phải trạm quản trị');
  const r = await a.call(target, method, path, body);
  if (r.status >= 400) throw new Error((r.body && r.body.error) || `HTTP ${r.status}`);
  return r.body;
}

/** Trạng thái trạm quản trị (hỏi tiến trình chính). Bản "user" không có cầu nối admin nên luôn trả null: không có gì để hiện. */
export function useAdminStatus(): [AdminStatus | null, () => Promise<void>] {
  const [st, setSt] = useState<AdminStatus | null>(null);
  const refresh = async () => { try { setSt((await bridge?.admin?.status()) ?? null); } catch { setSt(null); } };
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 10_000); return () => clearInterval(t); }, []);
  return [st, refresh];
}
