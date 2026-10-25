// Đọc token quản trị NGẪU NHIÊN mà máy chủ demo đã sinh (data-demo/admin-secrets.json) - chỉ dùng cho kịch bản kiểm thử cục bộ.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function loadTokens() {
  const dir = resolve(process.env.DATA_DIR ?? 'data-demo');
  const s = JSON.parse(readFileSync(join(dir, 'admin-secrets.json'), 'utf8'));
  return { storage: s.storage, BenhVien: s.nodes.BenhVien, SoYTe: s.nodes.SoYTe, DienThoai: s.nodes.DienThoai, approver: s.approver };
}
export const adminPackage = () => readFileSync(join(resolve(process.env.DATA_DIR ?? 'data-demo'), 'admin-package.txt'), 'utf8').trim();
