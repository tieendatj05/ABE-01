// TOTP (RFC 6238, HMAC-SHA1, 30 giây, 6 chữ số) — CHỈ DÙNG CHO KIỂM THỬ/DEMO bằng Node (thay cho ứng dụng Authenticator trên điện thoại).
// Sản phẩm không sinh mã trong trình duyệt: người dùng quét mã QR vào ứng dụng xác thực của họ.
import { createHmac } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function unbase32(s: string): Uint8Array {
  const t = s.replace(/[\s=]/g, '').toUpperCase();
  const out: number[] = []; let buf = 0, bits = 0;
  for (const ch of t) {
    const v = B32.indexOf(ch); if (v < 0) throw new Error('base32 sai');
    buf = (buf << 5) | v; bits += 5;
    if (bits >= 8) { out.push((buf >> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Uint8Array.from(out);
}
export function totpCode(secretBase32: string, epochSeconds = Math.floor(Date.now() / 1000), stepOffset = 0): string {
  const counter = BigInt(Math.floor(epochSeconds / 30) + stepOffset);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(counter);
  const h = createHmac('sha1', Buffer.from(unbase32(secretBase32))).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}
