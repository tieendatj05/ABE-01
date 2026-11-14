import { inflateSync } from 'node:zlib';
import type { Rgba } from '../../security/src/client/imaging.js';

// ---- giải mã PNG 8 bit (RGB hoặc RGBA, không xen kẽ) — đủ cho ảnh do System.Drawing xuất
export function readPng(buf: Uint8Array): Rgba {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0; const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = v.getUint32(o); const type = String.fromCharCode(...buf.subarray(o + 4, o + 8)); const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { const d = new DataView(body.buffer, body.byteOffset); w = d.getUint32(0); h = d.getUint32(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    if (type === 'IDAT') idat.push(Buffer.from(body));
    o += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6) || interlace) throw new Error(`PNG không hỗ trợ (bit ${depth}, loại ${ctype}, xen kẽ ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp; const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), dst = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0, b = up[i], c = i >= bpp ? up[i - bpp] : 0;
      let add = 0;
      if (ft === 1) add = a; else if (ft === 2) add = b; else if (ft === 3) add = (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      dst[i] = (src[i] + add) & 255;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = px[i * bpp]; data[i * 4 + 1] = px[i * bpp + 1]; data[i * 4 + 2] = px[i * bpp + 2]; data[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255; }
  return { w, h, data };
}

