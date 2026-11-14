// Kiểm chứng chữ ký bản ghi: chứng chỉ do registry ký → chữ ký ECDSA của khoá cá nhân → chuỗi dữ liệu nhận được khớp payloadDigest.
// Đây là chữ ký của ỨNG DỤNG để xác định trách nhiệm và phát hiện sửa dữ liệu; KHÔNG phải chữ ký số có giá trị pháp lý
// (không có CA được cấp phép, khoá không nằm trong token/HSM chuẩn).
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const CERT_DOMAIN = 'medabe/user-cert/v1|';
export const LOGIN_DOMAIN = 'medabe/login/v1|';
export const SIG_DOMAIN = 'medabe/record-sig/v1|';
export const TICKET_DOMAIN = 'medabe/ticket/v1|';
export const POLICY_DOMAIN = 'medabe/policy/v1|';

export const sha256Hex = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s)));
export const certMessage = (userId: string, gid: string, deviceId: string, signPub: string) => `${CERT_DOMAIN}${userId}|${gid}|${deviceId}|${signPub}`;

export interface Manifest {
  v: 1; recordId: string; patientRef: string; section: string; mode: 'BASELINE' | 'ABE'; policyVersion: string;
  payloadDigest: string; signerUserId: string; signerDeviceId: string; signedAt: string;
}
export interface SignedRecordView {
  id: string; patientRef: string; section: string; mode: string; manifest: string; signature: string;
  createdByUserId: string; signedByUserId: string;
  signer: { deviceId?: string; userId?: string; signPub?: string; cert?: string; gid?: string; displayName?: string };
  content?: string; payload?: string;
}
export interface SignatureCheck {
  ok: boolean;
  /** CERT | SIGNATURE | DIGEST | FIELDS | SIGNER (nguyên nhân thất bại đầu tiên) */
  failed?: 'CERT' | 'SIGNATURE' | 'DIGEST' | 'FIELDS' | 'SIGNER';
  signerUserId?: string; signerName?: string; signerDeviceId?: string;
}

async function p256Verify(pubHex: string, message: string, sigHex: string): Promise<boolean> {
  try {
    const pub = await crypto.subtle.importKey('raw', hexToBytes(pubHex) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, hexToBytes(sigHex) as BufferSource, new TextEncoder().encode(message) as BufferSource);
  } catch { return false; }
}

/** Người NHẬN tự kiểm chứng, không tin tên tác giả do máy chủ/máy khách hiển thị. */
export async function verifyRecord(view: SignedRecordView, registryPk: string): Promise<SignatureCheck> {
  const s = view.signer ?? {};
  const fail = (failed: SignatureCheck['failed']): SignatureCheck => ({ ok: false, failed, signerUserId: s.userId, signerName: s.displayName, signerDeviceId: s.deviceId });
  if (!s.userId || !s.gid || !s.deviceId || !s.signPub || !s.cert) return fail('CERT');
  try {
    if (!ed25519.verify(hexToBytes(s.cert), new TextEncoder().encode(certMessage(s.userId, s.gid, s.deviceId, s.signPub)), hexToBytes(registryPk))) return fail('CERT');
  } catch { return fail('CERT'); }
  let m: Manifest;
  try { m = JSON.parse(view.manifest) as Manifest; } catch { return fail('FIELDS'); }
  if (m.signerUserId !== s.userId || m.signerDeviceId !== s.deviceId || view.signedByUserId !== s.userId) return fail('SIGNER');
  if (!(await p256Verify(s.signPub, SIG_DOMAIN + view.manifest, view.signature))) return fail('SIGNATURE');
  if (m.recordId !== view.id || m.patientRef !== view.patientRef || m.section !== view.section || m.mode !== view.mode) return fail('FIELDS');
  const body = view.mode === 'ABE' ? view.payload : view.content;
  if (typeof body !== 'string' || sha256Hex(body) !== m.payloadDigest) return fail('DIGEST');
  return { ok: true, signerUserId: s.userId, signerName: s.displayName, signerDeviceId: s.deviceId };
}
