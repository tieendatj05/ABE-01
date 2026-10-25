// Bí mật quản trị của hệ thống: sinh NGẪU NHIÊN lần đầu chạy (không còn token mặc định đoán được), lưu trong thư mục dữ liệu của máy chủ.
// Gói kích hoạt trạm quản trị (admin-package.txt) là bản sao các token cần cho MỘT trạm quản trị; sau khi kích hoạt trạm, có thể xoá file này.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORGS } from './init.js';

export interface AdminSecrets {
  storage: string;                    // admin registry/lưu trữ
  nodes: Record<string, string>;      // admin từng nút cấp khoá
  approver: string;                   // mã duyệt của app điện thoại
  service: string;                    // nút -> máy chủ (đẩy cảnh báo); KHÔNG đưa cho trạm quản trị
  siem: string;                       // hệ thống SIEM kéo log
}

const rnd = () => randomBytes(24).toString('base64url');

export function loadOrCreateSecrets(dataDir: string): AdminSecrets {
  const file = join(dataDir, 'admin-secrets.json');
  let s: AdminSecrets;
  if (existsSync(file)) {
    s = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    s = { storage: rnd(), nodes: Object.fromEntries(ORGS.map((o) => [o, rnd()])), approver: rnd(), service: rnd(), siem: rnd() };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  }
  // Biến môi trường (triển khai thật) ghi đè giá trị sinh ra.
  s.storage = process.env.MEDABE_ADMIN_TOKEN ?? s.storage;
  s.service = process.env.MEDABE_SERVICE_TOKEN ?? s.service;
  s.siem = process.env.MEDABE_SIEM_TOKEN ?? s.siem;
  s.approver = process.env.APPROVER_TOKEN ?? s.approver;
  for (const o of ORGS) s.nodes[o] = process.env[`ADMIN_TOKEN_${o}`] ?? s.nodes[o];
  return s;
}

export const ADMIN_PACKAGE_PREFIX = 'MEDABE-ADMIN1:';

/** Gói đưa cho trạm quản trị: chỉ chứa token quản trị + mã duyệt (không có token dịch vụ/SIEM). */
export function writeAdminPackage(dataDir: string, s: AdminSecrets): string {
  const pkg = ADMIN_PACKAGE_PREFIX + Buffer.from(JSON.stringify({ storage: s.storage, nodes: s.nodes, approver: s.approver })).toString('base64');
  const file = join(dataDir, 'admin-package.txt');
  writeFileSync(file, pkg + '\n', { mode: 0o600 });
  return file;
}
