// ẢNH GIẢ để kiểm thử/trình diễn (KHÔNG phải ảnh y tế thật, không chứa người thật). Chỉ dùng ở Node (kiểm thử, công cụ dòng lệnh) — có mã hoá PNG bằng zlib.
// Hình mẫu gồm nền xám có dải chuyển, một "khối Mắt" xanh dương, một "khối Nhi/TMH" đỏ và một "khối KSK" xanh lá: nhờ màu khác nhau mà kiểm thử
// biết CHẮC điểm ảnh nào lọt tới người không đủ quyền. Một số vùng mô phỏng "lát cắt" khác nhau bằng tham số slice.
import { deflateSync, inflateSync } from 'node:zlib';
import type { Rgba } from '../client/imaging.js';

export const COLOR = { mat: [0, 0, 255, 255], nhiTmh: [255, 0, 0, 255], ksk: [0, 200, 0, 255] } as const;
export const PHANTOM = { w: 96, h: 64, mat: { x: 8, y: 8, w: 32, h: 24 }, nhiTmh: { x: 52, y: 8, w: 32, h: 24 }, ksk: { x: 30, y: 38, w: 36, h: 18 } };

export function makePhantom(slice = 0): Rgba {
  const { w, h } = PHANTOM;
  const data = new Uint8Array(w * h * 4);
  const fill = (r: { x: number; y: number; w: number; h: number }, c: readonly number[]) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.set(c, (y * w + x) * 4);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = 40 + ((x * 3 + y * 2 + slice * 17) % 90); data.set([g, g, g, 255], (y * w + x) * 4); }
  fill(PHANTOM.mat, COLOR.mat); fill(PHANTOM.nhiTmh, COLOR.nhiTmh); fill(PHANTOM.ksk, COLOR.ksk);
  return { w, h, data };
}

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, body.length); out.set(new TextEncoder().encode(type), 4); out.set(body, 8);
  v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}
/** PNG RGBA 8-bit không nén bộ lọc (filter 0). */
export function encodePng(p: Rgba): Uint8Array {
  const raw = new Uint8Array((p.w * 4 + 1) * p.h);
  for (let y = 0; y < p.h; y++) raw.set(p.data.subarray(y * p.w * 4, (y + 1) * p.w * 4), y * (p.w * 4 + 1) + 1);
  const ihdr = new Uint8Array(13); const v = new DataView(ihdr.buffer); v.setUint32(0, p.w); v.setUint32(4, p.h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}
/** Giải mã lại PNG do encodePng tạo (chỉ để kiểm thử vòng tròn; không phải bộ giải mã PNG tổng quát). */
export function decodePng(png: Uint8Array): Rgba {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8; let w = 0, h = 0; const idat: Uint8Array[] = [];
  while (o < png.length) {
    const len = v.getUint32(o); const type = new TextDecoder().decode(png.subarray(o + 4, o + 8)); const body = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = new DataView(body.buffer, body.byteOffset).getUint32(0); h = new DataView(body.buffer, body.byteOffset).getUint32(4); }
    if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  return { w, h, data };
}
export const pixelAt = (p: Rgba, x: number, y: number): number[] => Array.from(p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4));
/** Số điểm ảnh khác (0,0,0,0) nằm NGOÀI tập hình chữ nhật cho phép. */
export function pixelsOutside(p: Rgba, allowed: { x: number; y: number; w: number; h: number }[]): number {
  let n = 0;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (allowed.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
    const i = (y * p.w + x) * 4;
    if (p.data[i] | p.data[i + 1] | p.data[i + 2] | p.data[i + 3]) n++;
  }
  return n;
}
/** Có điểm ảnh nào đúng màu c không? */
export function hasColor(p: Rgba, c: readonly number[]): boolean {
  for (let i = 0; i < p.data.length; i += 4) if (p.data[i] === c[0] && p.data[i + 1] === c[1] && p.data[i + 2] === c[2] && p.data[i + 3] === c[3]) return true;
  return false;
}

// ---------- Ảnh "đầu" giả để trình diễn (cắt ngang, KHÔNG phải ảnh y tế thật; sinh bằng công thức elip, không có người thật) ----------
export const HEAD = {
  w: 256, h: 256,
  // các vùng khoanh sẵn (hình chữ nhật) trùng với cấu trúc vẽ: hốc mắt (Mắt), hốc mũi/xoang + tai (TMH), hàm dưới + răng (RHM), nhu mô não (Nhi)
  mat: { x: 52, y: 70, w: 152, h: 38 },
  tmh: { x: 100, y: 118, w: 56, h: 52 },
  rhm: { x: 70, y: 186, w: 116, h: 44 },
  nao: { x: 70, y: 22, w: 116, h: 44 },
};
export function makeHeadPhantom(slice = 0): Rgba {
  const { w, h } = HEAD;
  const data = new Uint8Array(w * h * 4);
  const ell = (cx: number, cy: number, rx: number, ry: number, v: number) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h - 1, Math.ceil(cy + ry)); y++) for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(w - 1, Math.ceil(cx + rx)); x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v)); data[i + 3] = 255; }
  };
  const s = slice * 4;
  ell(128, 128, 104, 122, 215);                 // xương sọ / mô mềm (sáng)
  ell(128, 128, 94, 112, 70);                   // trong sọ
  ell(128, 82 + s, 70, 52, 120);                // nhu mô não
  ell(110, 80, 22, 30, 95); ell(146, 80, 22, 30, 95);   // não thất
  ell(86, 90, 20, 15, 30); ell(170, 90, 20, 15, 30);    // hốc mắt (tối)
  ell(86, 90, 8, 8, 200); ell(170, 90, 8, 8, 200);      // nhãn cầu
  ell(128, 142, 14, 22, 20);                    // hốc mũi
  ell(100, 146, 10, 10, 35); ell(156, 146, 10, 10, 35); // xoang hàm
  ell(60, 150, 8, 12, 25); ell(196, 150, 8, 12, 25);    // ống tai
  ell(128, 208, 52, 16, 225);                   // xương hàm dưới
  for (let k = 0; k < 8; k++) ell(86 + k * 12, 206, 4, 7, 250);   // răng
  // vài chấm sáng ngẫu nhiên có quy luật để mỗi lát khác nhau
  for (let k = 0; k < 6; k++) ell(100 + ((k * 37 + slice * 11) % 56), 60 + ((k * 23) % 40), 3, 3, 185);
  return { w, h, data };
}
