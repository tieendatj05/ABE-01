// ĐỌC DICOM TỐI THIỂU (chạy được trong trình duyệt và Node, không phụ thuộc thư viện ngoài).
// PHẠM VI: tệp DICOM KHÔNG NÉN (Implicit VR LE hoặc Explicit VR LE), ảnh xám 8/16 bit, 1 mẫu/điểm ảnh. Tệp nén (JPEG, JPEG2000, RLE...) bị TỪ CHỐI rõ ràng.
// RIÊNG TƯ: bộ đọc này CHỈ trả về điểm ảnh và thông số kỹ thuật cần để hiển thị. Nó KHÔNG trả về và KHÔNG lưu họ tên, ngày sinh, mã bệnh nhân…
// của tệp. Riêng mã bệnh nhân chỉ được so với mẫu nguồn đã biết (UPENN-GBM-nnnnn) để nhận ra nguồn; nếu không khớp thì không giữ lại gì.
// Chỉ đọc các thẻ ở mức cao nhất; các chuỗi lồng (SQ) được bỏ qua đúng độ dài.
import type { Rgba } from './imaging.js';

export class DicomUnsupportedError extends Error {}

export interface DicomMeta {
  transferSyntax: string;
  modality: string;
  bodyPart: string;
  seriesDescription: string;
  rows: number; cols: number;
  bitsAllocated: number; bitsStored: number; pixelRepresentation: number;
  photometric: string;
  pixelSpacing?: [number, number];
  sliceLocation?: number;
  instanceNumber?: number;
  windowCenter?: number; windowWidth?: number;
  rescaleSlope: number; rescaleIntercept: number;
  /** Chỉ có giá trị khi mã bệnh nhân KHỚP một mẫu nguồn đã biết (ví dụ UPENN-GBM-00002). Không bao giờ chứa mã khác. */
  sourceId: string | null;
  /** Tiêu đề có vẻ chứa định danh thật (tên không phải mã, hoặc có ngày sinh). Chỉ là CỜ — không kèm giá trị. */
  hasIdentityTags: boolean;
  /** DICOM tự khai có chữ in lên ảnh (BurnedInAnnotation = YES). */
  burnedInAnnotation: boolean;
}
export interface DicomSlice { meta: DicomMeta; pixels: Uint16Array | Int16Array | Uint8Array }

const TS_IMPLICIT = '1.2.840.10008.1.2';
const TS_EXPLICIT = '1.2.840.10008.1.2.1';
const LONG_VR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);
const SOURCE_RE = /^UPENN-GBM-\d{5}(?:_\d+)?$/;
const CODE_LIKE = /^[A-Za-z0-9_-]{3,32}$/;           // mã ẩn danh kiểu "UPENN-GBM-00002"; tên người có dấu cách/dấu ^ nên không khớp

export function looksLikeDicom(b: Uint8Array): boolean {
  return b.length > 132 && String.fromCharCode(b[128], b[129], b[130], b[131]) === 'DICM';
}

export function parseDicom(bytes: Uint8Array): DicomSlice {
  if (!looksLikeDicom(bytes)) throw new DicomUnsupportedError('Không phải tệp DICOM (thiếu tiêu đề "DICM").');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (p: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) { const c = bytes[p + i]; if (c) s += String.fromCharCode(c); } return s.trim(); };
  const u16 = (p: number) => dv.getUint16(p, true);
  const u32 = (p: number) => dv.getUint32(p, true);

  let p = 132;
  let transferSyntax = TS_EXPLICIT;
  // --- meta group 0002 (luôn Explicit VR LE) ---
  while (p + 8 <= bytes.length && u16(p) === 0x0002) {
    const e = u16(p + 2); const vr = String.fromCharCode(bytes[p + 4], bytes[p + 5]);
    const long = LONG_VR.has(vr); const len = long ? u32(p + 8) : u16(p + 6); const hdr = long ? 12 : 8;
    if (e === 0x0010) transferSyntax = str(p + hdr, len);
    p += hdr + len;
  }
  if (transferSyntax !== TS_IMPLICIT && transferSyntax !== TS_EXPLICIT) {
    throw new DicomUnsupportedError(`DICOM nén/kiểu lưu "${transferSyntax}" chưa được hỗ trợ. Chỉ nhận DICOM không nén (Implicit/Explicit VR Little Endian).`);
  }
  const implicit = transferSyntax === TS_IMPLICIT;

  // bỏ qua một phần tử/chuỗi có độ dài không xác định
  const skipUndefined = (start: number): number => {
    let q = start;
    for (;;) {
      if (q + 8 > bytes.length) throw new DicomUnsupportedError('Tệp DICOM bị cắt cụt.');
      const g = u16(q), e = u16(q + 2), len = u32(q + 4);
      if (g === 0xfffe && e === 0xe0dd) return q + 8;                          // hết chuỗi
      if (g === 0xfffe && e === 0xe000) {                                       // một item
        if (len === 0xffffffff) q = skipItemUndefined(q + 8); else q += 8 + len;
      } else q += 8;
    }
  };
  const skipItemUndefined = (start: number): number => {
    let q = start;
    for (;;) {
      if (q + 8 > bytes.length) throw new DicomUnsupportedError('Tệp DICOM bị cắt cụt.');
      const g = u16(q), e = u16(q + 2);
      if (g === 0xfffe && e === 0xe00d) return q + 8;                           // hết item
      const vr = implicit ? '' : String.fromCharCode(bytes[q + 4], bytes[q + 5]);
      const long = implicit || LONG_VR.has(vr);
      const len = implicit ? u32(q + 4) : long ? u32(q + 8) : u16(q + 6); const hdr = implicit || long ? (implicit ? 8 : 12) : 8;
      q += hdr; if (len === 0xffffffff) q = skipUndefined(q); else q += len;
    }
  };

  const t: Record<string, string | number | number[]> = {};
  let pixelOffset = -1, pixelLen = 0;
  const WANT_STR = new Set(['0008,0060', '0008,103e', '0018,0015', '0010,0010', '0010,0020', '0010,0030', '0028,0004', '0028,0030', '0020,0013', '0020,1041', '0028,1050', '0028,1051', '0028,1052', '0028,1053', '0028,0301']);
  const WANT_US = new Set(['0028,0002', '0028,0010', '0028,0011', '0028,0100', '0028,0101', '0028,0103']);
  while (p + 8 <= bytes.length) {
    const g = u16(p), e = u16(p + 2);
    let vr = '', len: number, hdr: number;
    if (implicit) { len = u32(p + 4); hdr = 8; }
    else {
      vr = String.fromCharCode(bytes[p + 4], bytes[p + 5]);
      if (LONG_VR.has(vr)) { len = u32(p + 8); hdr = 12; } else { len = u16(p + 6); hdr = 8; }
    }
    const key = g.toString(16).padStart(4, '0') + ',' + e.toString(16).padStart(4, '0');
    if (g === 0x7fe0 && e === 0x0010) {
      if (len === 0xffffffff) throw new DicomUnsupportedError('Dữ liệu điểm ảnh dạng đóng gói (nén) chưa được hỗ trợ.');
      pixelOffset = p + hdr; pixelLen = len; break;
    }
    if (len === 0xffffffff) { p = skipUndefined(p + hdr); continue; }
    if (p + hdr + len > bytes.length) throw new DicomUnsupportedError('Tệp DICOM bị cắt cụt.');
    if (WANT_US.has(key) && len >= 2) t[key] = u16(p + hdr);
    else if (WANT_STR.has(key)) t[key] = str(p + hdr, len);
    p += hdr + len;
  }
  if (pixelOffset < 0) throw new DicomUnsupportedError('Tệp DICOM không có dữ liệu điểm ảnh.');

  const num = (k: string, d?: number) => { const v = t[k]; if (v === undefined || v === '') return d; const n = Number(String(v).split('\\')[0]); return Number.isFinite(n) ? n : d; };
  const rows = num('0028,0010')!, cols = num('0028,0011')!;
  const bitsAllocated = num('0028,0100', 16)!, bitsStored = num('0028,0101', bitsAllocated)!, pixelRepresentation = num('0028,0103', 0)!;
  if (!(Number.isInteger(rows) && Number.isInteger(cols) && rows > 0 && cols > 0 && rows * cols <= 16_000_000)) throw new DicomUnsupportedError('Kích thước ảnh DICOM không hợp lệ.');
  if ((num('0028,0002', 1) ?? 1) !== 1) throw new DicomUnsupportedError('Chỉ nhận ảnh xám (1 mẫu trên điểm ảnh); ảnh màu DICOM chưa được hỗ trợ.');
  if (bitsAllocated !== 8 && bitsAllocated !== 16) throw new DicomUnsupportedError(`BitsAllocated=${bitsAllocated} chưa được hỗ trợ (chỉ 8 hoặc 16).`);
  const n = rows * cols, need = n * (bitsAllocated / 8);
  if (pixelLen < need || pixelOffset + need > bytes.length) throw new DicomUnsupportedError('Dữ liệu điểm ảnh ngắn hơn kích thước khai báo.');

  let pixels: DicomSlice['pixels'];
  if (bitsAllocated === 8) pixels = bytes.slice(pixelOffset, pixelOffset + n);
  else {
    const arr = pixelRepresentation === 1 ? new Int16Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = pixelRepresentation === 1 ? dv.getInt16(pixelOffset + i * 2, true) : dv.getUint16(pixelOffset + i * 2, true);
    pixels = arr;
  }

  const pid = String(t['0010,0020'] ?? '');
  const name = String(t['0010,0010'] ?? '');
  const spacing = String(t['0028,0030'] ?? '').split('\\').map(Number);
  const meta: DicomMeta = {
    transferSyntax, modality: String(t['0008,0060'] ?? ''), bodyPart: String(t['0018,0015'] ?? ''), seriesDescription: String(t['0008,103e'] ?? ''),
    rows, cols, bitsAllocated, bitsStored, pixelRepresentation, photometric: String(t['0028,0004'] ?? 'MONOCHROME2'),
    ...(spacing.length === 2 && spacing.every(Number.isFinite) ? { pixelSpacing: [spacing[0], spacing[1]] as [number, number] } : {}),
    ...(num('0020,1041') !== undefined ? { sliceLocation: num('0020,1041') } : {}),
    ...(num('0020,0013') !== undefined ? { instanceNumber: num('0020,0013') } : {}),
    ...(num('0028,1050') !== undefined ? { windowCenter: num('0028,1050') } : {}),
    ...(num('0028,1051') !== undefined ? { windowWidth: num('0028,1051') } : {}),
    rescaleSlope: num('0028,1053', 1)!, rescaleIntercept: num('0028,1052', 0)!,
    sourceId: SOURCE_RE.test(pid) ? pid : null,
    hasIdentityTags: (name !== '' && !CODE_LIKE.test(name)) || String(t['0010,0030'] ?? '') !== '',
    burnedInAnnotation: String(t['0028,0301'] ?? '').toUpperCase() === 'YES',
  };
  return { meta, pixels };
}

/**
 * Điểm ảnh DICOM -> RGBA xám 8 bit (cửa sổ hiển thị). Nếu không chỉ định, dùng phân vị 1%..99,5% của chính lát đó (bỏ nền đen).
 * Đây là phép HIỂN THỊ: bản PNG 8 bit sinh ra KHÔNG giữ đủ độ sâu 16 bit của DICOM gốc.
 */
export function dicomToRgba(s: DicomSlice, win?: { low: number; high: number }): Rgba {
  const { rows, cols, photometric, rescaleSlope, rescaleIntercept } = s.meta;
  const n = rows * cols;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = s.pixels[i] * rescaleSlope + rescaleIntercept;
  let low: number, high: number;
  if (win) { low = win.low; high = win.high; }
  else {
    const sorted = Float32Array.from(v).sort();
    low = sorted[Math.floor(n * 0.01)]; high = sorted[Math.min(n - 1, Math.floor(n * 0.995))];
  }
  const span = high - low || 1;
  const data = new Uint8Array(n * 4);
  const inv = photometric.trim().toUpperCase() === 'MONOCHROME1';
  for (let i = 0; i < n; i++) {
    let g = Math.round(((v[i] - low) / span) * 255); g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (inv) g = 255 - g;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g; data[i * 4 + 3] = 255;
  }
  return { w: cols, h: rows, data };
}

/** Sắp các lát của một chuỗi: theo InstanceNumber, sau đó vị trí lát cắt. */
export function sortSlices<T extends { meta: DicomMeta }>(a: T[]): T[] {
  return [...a].sort((x, y) => (x.meta.instanceNumber ?? 0) - (y.meta.instanceNumber ?? 0) || (x.meta.sliceLocation ?? 0) - (y.meta.sliceLocation ?? 0));
}
