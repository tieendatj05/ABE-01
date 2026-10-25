// Biên nhận liên thông: cổng Bộ Y tế (mô phỏng) ký Ed25519 lên "bản ghi X của cơ sở Y đã được nhận lúc Z". Máy khách kiểm tra chữ ký bằng khoá công khai
// của cổng được GHIM trong cấu hình đã có chữ ký của registry, nên không giả được biên nhận và không đổi được nội dung sau khi đã nhận (contentHash).
// File này chạy cả ở trình duyệt/Electron lẫn Node (chỉ dùng @noble).
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export interface Receipt {
  receiptId: string;      // mã biên nhận (hiển thị cho người dùng)
  maCskcb: string;        // mã cơ sở khám chữa bệnh gửi
  recordId: string;
  contentHash: string;    // SHA-256 của (iv|ciphertext): bằng chứng nội dung mã hoá đã nhận, không đổi được
  receivedAt: string;
  seq: number;            // số thứ tự tăng dần của cổng
  deviceId: string;       // thiết bị gửi (đã được registry cấp chứng chỉ)
  sig: string;
}

export const receiptMessage = (r: Omit<Receipt, 'sig'>) =>
  new TextEncoder().encode('medabe/byt-receipt/v1|' + [r.receiptId, r.maCskcb, r.recordId, r.contentHash, r.receivedAt, r.seq, r.deviceId].join('|'));

export function verifyReceipt(gatewayPk: string, r: Receipt): boolean {
  try {
    return ed25519.verify(hexToBytes(r.sig), receiptMessage(r), hexToBytes(gatewayPk));
  } catch {
    return false;
  }
}

/** Băm phần KHÔNG đổi của phong bì (iv + ciphertext). Phần ABE có thể được bọc lại khi đổi epoch nên không tính vào. */
export const contentHashOf = (env: { iv?: unknown; ciphertext?: unknown }) =>
  bytesToHex(sha256(new TextEncoder().encode(`${String(env.iv)}|${String(env.ciphertext)}`)));
