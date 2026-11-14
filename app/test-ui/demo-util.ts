// Tiện ích cho các kịch bản demo: đăng nhập tài khoản mẫu và DỌN THIẾT BỊ khi xong (mỗi lần chạy kịch bản là một "thiết bị" mới; mỗi tài khoản chỉ được 5 thiết bị,
// nếu không dọn thì lần đăng nhập thật của bạn trên trình duyệt sẽ bị DEVICE_LIMIT).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tlsFetch } from '../../security/src/common/tls.js';
import { MedClient } from '../../security/src/client/medclient.js';
import { DEMO_USERS } from '../../security/src/deploy/research-stack.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';
import { totpCode } from '../../security/src/research/totp.js';

export const DEMO_URL = process.env.DEMO_URL ?? 'https://localhost:8443';
const tls = tlsFetch(readFileSync(process.env.DEMO_CA ?? 'data-research/tls/ca.pem', 'utf8'));
/** https cho máy chủ chính (xác minh CA); riêng cổng liên thông Bộ Y tế (mô phỏng) chạy http trên CHÍNH MÁY NÀY (loopback) nên được phép gọi thẳng. */
export const demoFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
  return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') ? fetch(input, init) : tls(input, init);
}) as typeof fetch;
const used: { user: string; deviceId: string }[] = [];

export async function loginDemo(user: string): Promise<MedClient> {
  const u = DEMO_USERS.find((x) => x.username === user);
  if (!u) throw new Error('Không có tài khoản mẫu ' + user);
  const c = await MedClient.signIn(DEMO_URL, u.username, u.password, new MemoryDeviceKeyStore(), { fetch: demoFetch });
  used.push({ user, deviceId: c.s.deviceId });
  // Quản trị: nếu máy chủ bắt buộc MFA thì vượt qua ngay để mọi kịch bản cũ dùng API quản trị vẫn chạy
  if (u.role === 'QUAN_TRI') { const st = await c.mfaStatus().catch(() => null); if (st?.required && !st.verified) await completeMfa(c, u.username, u.password); }
  return c;
}

/**
 * Vượt qua MFA (TOTP) cho một tài khoản mẫu: Giám sát (bắt buộc để đọc dữ liệu) và Quản trị (bắt buộc khi máy chủ bật admin-mfa).
 * Bí mật TOTP lấy từ biến GIAMSAT_TOTP_SECRET (chỉ giamsat01) hoặc tệp .demo-mfa.json (theo địa chỉ máy chủ + tên tài khoản; tệp này bị bỏ qua bởi git). Chưa đăng ký thì tự đăng ký lần đầu và lưu bí mật.
 * Nếu bạn đã quét mã QR vào điện thoại cho tài khoản đó, kịch bản không biết bí mật: đặt biến môi trường hoặc bỏ qua phần cần MFA (trả false).
 */
const MFA_FILE = '.demo-mfa.json';
async function completeMfa(c: MedClient, username: string, password: string, reason?: string): Promise<boolean> {
  const map: Record<string, Record<string, string>> = existsSync(MFA_FILE) ? JSON.parse(readFileSync(MFA_FILE, 'utf8')) : {};
  let secret = (username === 'giamsat01' ? process.env.GIAMSAT_TOTP_SECRET : undefined) ?? map[DEMO_URL]?.[username];
  if (!secret) {
    if (username === 'giamsat01' && process.env.DEMO_KHONG_DANG_KY_MFA) { console.log('   (DEMO_KHONG_DANG_KY_MFA: không tự đăng ký MFA cho giamsat01, để người dùng tự đăng ký bằng điện thoại; bỏ qua phần Giám sát)'); return false; }
    if ((await c.mfaStatus()).enrolled) { console.log(`   (${username} đã đăng ký MFA trên điện thoại: đặt GIAMSAT_TOTP_SECRET hoặc ghi bí mật vào ${MFA_FILE} để kịch bản dùng được; bỏ qua phần cần MFA)`); return false; }
    secret = (await c.mfaEnroll(password)).secret;
    map[DEMO_URL] = { ...(map[DEMO_URL] ?? {}), [username]: secret };
    writeFileSync(MFA_FILE, JSON.stringify(map, null, 2));
  }
  // mỗi mã chỉ dùng một lần: nếu vừa dùng trong cùng bước 30 giây thì dùng mã của bước kế (máy chủ chấp nhận lệch ±1 bước), rồi chờ sang bước mới
  for (const [off, wait] of [[0, 0], [1, 0], [0, 31_000], [1, 0]] as const) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try { await c.mfaVerify(totpCode(secret, Math.floor(Date.now() / 1000), off)); if (reason) c.accessReason = reason; return true; }
    catch (e) {
      if (/MFA_CODE_REUSED/.test((e as Error).message)) continue;
      console.log(`   (không vượt được MFA cho ${username}: ` + (e as Error).message.slice(0, 60) + ')'); return false;
    }
  }
  return false;
}

/** Đăng nhập giamsat01 VÀ vượt qua MFA — bắt buộc để đọc dữ liệu (MFA là thuộc tính ABE của vai trò Giám sát). Trả null nếu không vượt được. */
export async function loginGiamSat(reason = 'Demo ABE (kich ban tu dong)'): Promise<MedClient | null> {
  const c = await loginDemo('giamsat01');
  return (await completeMfa(c, 'giamsat01', DEMO_USERS.find((x) => x.username === 'giamsat01')!.password, reason)) ? c : null;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/**
 * Đổi các tham số "họ tên hoặc CCCD" thành danh sách CCCD. Số 12 chữ số được giữ nguyên; chữ (không phân biệt hoa/thường/dấu) được tra theo họ tên
 * trong hồ sơ hành chính của đơn vị mà tài khoản tiếp đón giải mã được. Một tên khớp nhiều người -> lấy tất cả và in ra để bạn kiểm tra.
 */
export async function resolvePatients(args: string[], group?: string): Promise<string[]> {
  const out: string[] = [];
  const names = args.filter((a) => !/^\d{12}$/.test(a));
  out.push(...args.filter((a) => /^\d{12}$/.test(a)));
  if (names.length) {
    const td = await loginDemo('tiepdon01');
    const { UNITS } = await import('../web/src/data/catalog.js');
    const rows = await td.listGroup(group ?? UNITS[0].ma);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
    const people = (await td.openMany([...latest.values()])).flatMap((o) => { const d = o?.data as { hoTen?: string; cccd?: string } | undefined; return d?.cccd ? [{ hoTen: d.hoTen ?? '', cccd: d.cccd }] : []; });
    for (const n of names) {
      const hit = people.filter((p) => fold(p.hoTen).includes(fold(n)));
      if (!hit.length) console.log(`✗ Không thấy bệnh nhân nào có tên chứa "${n}"`);
      for (const p of hit) { console.log(`✓ "${n}" → ${p.hoTen} (${p.cccd})`); out.push(p.cccd); }
    }
  }
  return [...new Set(out)];
}

/** Thu hồi mọi thiết bị mà kịch bản này đã tạo (dùng tài khoản quản trị mẫu quantri02). */
export async function cleanupDevices(): Promise<void> {
  if (!used.length) return;
  try {
    const admin = await MedClient.signIn(DEMO_URL, 'quantri02', 'Passw0rd-QT02', new MemoryDeviceKeyStore(), { fetch: demoFetch });
    { const st = await admin.mfaStatus().catch(() => null); if (st?.required && !st.verified) await completeMfa(admin, 'quantri02', 'Passw0rd-QT02'); }
    for (const d of used) await admin.api('POST', `/api/v2/admin/devices/${d.deviceId}/revoke`, {}).catch(() => undefined);
    await admin.api('POST', `/api/v2/admin/devices/${admin.s.deviceId}/revoke`, {}).catch(() => undefined);
  } catch (e) { console.log('(không dọn được thiết bị demo:', (e as Error).message + ')'); }
}
