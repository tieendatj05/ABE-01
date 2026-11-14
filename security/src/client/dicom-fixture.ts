// Bộ dựng tệp DICOM tối giản (Implicit/Explicit VR LE, không nén) CHỈ ĐỂ KIỂM THỬ. Không dùng trong sản phẩm.
// ---- Trình dựng DICOM tối giản cho kiểm thử ----
const enc = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const le16 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255]);
const le32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
const even = (b: Uint8Array) => (b.length % 2 ? cat(b, Uint8Array.from([0x20])) : b);
const tag = (g: number, e: number) => cat(le16(g), le16(e));

function el(g: number, e: number, vr: string, val: Uint8Array, implicit: boolean): Uint8Array {
  const v = even(val);
  if (implicit) return cat(tag(g, e), le32(v.length), v);
  return ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr) ? cat(tag(g, e), enc(vr), le16(0), le32(v.length), v) : cat(tag(g, e), enc(vr), le16(v.length), v);
}
export interface Opts { ts?: string; rows?: number; cols?: number; bits?: number; pid?: string; name?: string; birth?: string; body?: string; modality?: string; burned?: string; sq?: boolean; photometric?: string; px?: number[] }
export function makeDicom(o: Opts = {}): Uint8Array {
  const ts = o.ts ?? '1.2.840.10008.1.2';
  const imp = ts === '1.2.840.10008.1.2';
  const rows = o.rows ?? 4, cols = o.cols ?? 6, bits = o.bits ?? 16;
  const meta = cat(el(0x0002, 0x0010, 'UI', enc(ts), false));
  const px = o.px ?? Array.from({ length: rows * cols }, (_, i) => (i % cols < 3 ? 0 : 500 + i));
  const pixBytes = bits === 16 ? cat(...px.map(le16)) : Uint8Array.from(px);
  const parts: Uint8Array[] = [
    el(0x0008, 0x0060, 'CS', enc(o.modality ?? 'MR'), imp),
    el(0x0008, 0x103e, 'LO', enc('t2_Flair_axial'), imp),
  ];
  if (o.sq) {      // chuỗi có độ dài KHÔNG xác định, bên trong có phần tử trông như Rows (phải bị bỏ qua)
    const inner = el(0x0028, 0x0010, 'US', le16(9999), imp);
    parts.push(imp
      ? cat(tag(0x0008, 0x1140), le32(0xffffffff), tag(0xfffe, 0xe000), le32(0xffffffff), inner, tag(0xfffe, 0xe00d), le32(0), tag(0xfffe, 0xe0dd), le32(0))
      : cat(tag(0x0008, 0x1140), enc('SQ'), le16(0), le32(0xffffffff), tag(0xfffe, 0xe000), le32(0xffffffff), inner, tag(0xfffe, 0xe00d), le32(0), tag(0xfffe, 0xe0dd), le32(0)));
  }
  parts.push(
    el(0x0010, 0x0010, 'PN', enc(o.name ?? 'UPENN-GBM-00002'), imp),
    el(0x0010, 0x0020, 'LO', enc(o.pid ?? 'UPENN-GBM-00002'), imp),
    el(0x0010, 0x0030, 'DA', enc(o.birth ?? ''), imp),
    el(0x0018, 0x0015, 'CS', enc(o.body ?? 'BRAIN'), imp),
    el(0x0020, 0x0013, 'IS', enc('20'), imp),
    el(0x0028, 0x0002, 'US', le16(1), imp),
    el(0x0028, 0x0004, 'CS', enc(o.photometric ?? 'MONOCHROME2'), imp),
    el(0x0028, 0x0010, 'US', le16(rows), imp),
    el(0x0028, 0x0011, 'US', le16(cols), imp),
    el(0x0028, 0x0100, 'US', le16(bits), imp),
    el(0x0028, 0x0101, 'US', le16(bits), imp),
    el(0x0028, 0x0103, 'US', le16(0), imp),
  );
  if (o.burned) parts.push(el(0x0028, 0x0301, 'CS', enc(o.burned), imp));
  parts.push(el(0x7fe0, 0x0010, 'OW', pixBytes, imp));
  return cat(new Uint8Array(128), enc('DICM'), meta, ...parts);
}

