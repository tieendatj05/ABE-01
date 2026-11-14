// ẢNH CT/MRI THEO VÙNG (chế độ tài khoản). PHẠM VI: ảnh 2D (PNG/JPEG đã giải mã thành điểm ảnh RGBA) và BỘ ẢNH NHIỀU LÁT CẮT 2D có thứ tự
// (mỗi lát là một ảnh 2D riêng, gắn seriesId + sliceIndex); KHÔNG phải xử lý khối 3D hay DICOM đầy đủ (không đọc DICOM, không dựng lại 3D).
//
// MÃ HOÁ: mỗi VÙNG là một bản ghi riêng (type 'vung') với khoá AES-256-GCM riêng, chỉ chứa ĐIỂM ẢNH CỦA CHÍNH VÙNG ĐÓ (đã cắt);
// khoá được CP-ABE bảo vệ theo policy  Author OR  (BacSi AND Khoa:k1) OR (BacSi AND Khoa:k2) ...  (một vùng có thể thuộc nhiều chuyên khoa).
// ẢNH GỐC nguyên vẹn (byte của tệp) là bản ghi 'anh' riêng, policy CHỈ tác giả. Người không đủ quyền KHÔNG nhận bản mã của vùng/ảnh gốc;
// điểm ảnh ngoài các vùng được cấp không tồn tại trên máy họ (nền trống), không phải bị che bằng CSS/canvas.
//
// TOÀN VẸN: phần được KÝ của mỗi bản ghi gồm imageId, regionId (= id bản ghi), toạ độ, kích thước ảnh gốc, SHA-256 ảnh gốc, các khoa, lát cắt, khoa/refId;
// AAD của AES-GCM = bệnh nhân|loại|id bản ghi. Tráo bản mã giữa các vùng, sửa nhãn khoa/refId/toạ độ, sửa bản mã đều bị phát hiện khi mở.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { RecordIntegrityError, type MedClient, type RecordRow } from './medclient.js';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Rgba { w: number; h: number; data: Uint8Array | Uint8ClampedArray }
export interface SeriesRef { id: string; index: number; count: number }
export const MAX_ORIGINAL_BYTES = 6 * 1024 * 1024;
export const MAX_REGIONS = 32;

// ---------- điểm ảnh ----------
export function validateRect(r: Rect, w: number, h: number): void {
  const ok = [r.x, r.y, r.w, r.h].every((n) => Number.isInteger(n)) && r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= w && r.y + r.h <= h;
  if (!ok) throw new Error(`Vùng ảnh không hợp lệ hoặc vượt ngoài ảnh ${w}x${h}: ${JSON.stringify(r)}`);
}
function assertRgba(p: Rgba) {
  if (!(Number.isInteger(p.w) && Number.isInteger(p.h) && p.w > 0 && p.h > 0 && p.w * p.h <= 64_000_000 && p.data.length === p.w * p.h * 4)) throw new Error('Điểm ảnh RGBA không hợp lệ');
}
export function cropRgba(img: Rgba, r: Rect): Rgba {
  assertRgba(img); validateRect(r, img.w, img.h);
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(img.data.subarray(((r.y + y) * img.w + r.x) * 4, ((r.y + y) * img.w + r.x + r.w) * 4), y * r.w * 4);
  return { w: r.w, h: r.h, data: out };
}
/** Nền trống: trong suốt hoàn toàn (0,0,0,0). Không chứa điểm ảnh gốc nào. */
export const blankRgba = (w: number, h: number): Rgba => ({ w, h, data: new Uint8Array(w * h * 4) });
export function pasteRgba(dst: Rgba, src: Rgba, x: number, y: number): void {
  validateRect({ x, y, w: src.w, h: src.h }, dst.w, dst.h);
  for (let row = 0; row < src.h; row++) dst.data.set(src.data.subarray(row * src.w * 4, (row + 1) * src.w * 4), ((y + row) * dst.w + x) * 4);
}

const b64 = (u: Uint8Array): string => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = t.writable.getWriter(); void w.write(bytes as BufferSource); void w.close();
  return new Uint8Array(await new Response(t.readable).arrayBuffer());
}
export const packPixels = async (p: Rgba): Promise<string> => b64(await pipe(new Uint8Array(p.data), new CompressionStream('deflate-raw')));
export async function unpackPixels(s: string, w: number, h: number): Promise<Rgba> {
  const data = await pipe(unb64(s), new DecompressionStream('deflate-raw'));
  if (data.length !== w * h * 4) throw new Error('Kích thước điểm ảnh của vùng không khớp toạ độ đã ký');
  return { w, h, data };
}

// ---------- ghi ----------
export interface SaveImageInput {
  patientCode: string;
  /** Byte NGUYÊN VẸN của tệp ảnh gốc (PNG/JPEG...). Không bị chỉnh sửa. Không nhận tên tệp (tránh đưa định danh vào nhãn). */
  original: { mime: string; bytes: Uint8Array };
  /** Điểm ảnh đã giải mã của chính tệp trên (để cắt vùng). */
  pixels: Rgba;
  regions: { rect: Rect; khoas: string[]; label?: string }[];
  series?: SeriesRef;
  modality?: 'CT' | 'MRI' | 'KHAC';
}
export interface SavedImage { imageId: string; originalId: string; regionIds: string[] }

export async function saveImage(c: MedClient, o: SaveImageInput): Promise<SavedImage> {
  if (!c.s.account) throw new Error('Ảnh theo vùng chỉ dùng ở chế độ tài khoản');
  assertRgba(o.pixels);
  if (!/^image\/(png|jpeg)$/.test(o.original.mime)) throw new Error('Chỉ nhận ảnh PNG hoặc JPEG (ảnh 2D)');
  if (o.original.bytes.length === 0 || o.original.bytes.length > MAX_ORIGINAL_BYTES) throw new Error(`Tệp ảnh gốc phải từ 1 byte đến ${MAX_ORIGINAL_BYTES} byte`);
  if (o.regions.length > MAX_REGIONS) throw new Error(`Tối đa ${MAX_REGIONS} vùng cho mỗi ảnh`);
  if (o.series && !(Number.isInteger(o.series.index) && Number.isInteger(o.series.count) && o.series.index >= 0 && o.series.index < o.series.count && /^[0-9a-f-]{36}$/.test(o.series.id))) throw new Error('Thông tin lát cắt không hợp lệ');
  const { w, h } = o.pixels;
  for (const r of o.regions) { validateRect(r.rect, w, h); if (!r.khoas.length) throw new Error('Mỗi vùng phải gán ít nhất một chuyên khoa'); }

  const imageId = crypto.randomUUID();
  const origSha256 = bytesToHex(sha256(o.original.bytes));
  const common = { imageId, imageW: w, imageH: h, origSha256, ...(o.series ? { series: o.series } : {}) };
  const made: string[] = [];
  try {
    const originalId = await c.saveRecord({
      patientCode: o.patientCode, type: 'anh', khoa: 'KSK', refId: imageId,
      data: { kind: 'original', mime: o.original.mime, modality: o.modality ?? 'KHAC', bytes: b64(o.original.bytes) },
      bind: { kind: 'original', ...common },
    });
    made.push(originalId);
    const regionIds: string[] = [];
    for (const r of o.regions) {
      const id = crypto.randomUUID();
      const khoaCsv = r.khoas.join(',');
      const crop = cropRgba(o.pixels, r.rect);
      await c.saveRecord({
        patientCode: o.patientCode, type: 'vung', khoa: khoaCsv, id, refId: imageId,
        data: { kind: 'region', label: r.label ?? '', pixels: await packPixels(crop) },
        bind: { kind: 'region', regionId: id, rect: r.rect, ...common },
      });
      made.push(id); regionIds.push(id);
    }
    return { imageId, originalId, regionIds };
  } catch (e) {
    for (const id of made) await c.deleteRecord(id).catch(() => undefined);      // không để lại ảnh dở dang
    throw e;
  }
}

// ---------- đọc ----------
export interface ImageView {
  imageId: string;
  width: number; height: number;
  /** Ảnh RGBA đã ghép: CHỈ có điểm ảnh của các vùng người này đủ quyền giải mã; phần còn lại là nền trống. */
  pixels: Rgba;
  regions: { id: string; rect: Rect; khoas: string[]; label: string }[];
  /** true = đây là bản hiển thị đã GIỚI HẠN (không phải ảnh gốc đầy đủ). */
  limited: boolean;
  /** Ảnh gốc nguyên vẹn — chỉ có khi người xem là tác giả. */
  original?: { mime: string; bytes: Uint8Array; sha256: string };
  series?: SeriesRef;
  /** Số bản ghi đủ quyền nhưng bị phát hiện can thiệp / sai chữ ký / sai ràng buộc (bỏ qua, không hiển thị). */
  tampered: number;
}

interface Bind { kind: string; imageId: string; regionId?: string; rect?: Rect; imageW: number; imageH: number; origSha256: string; series?: SeriesRef }

/** Các ảnh của bệnh nhân mà người này THẤY ĐƯỢC (có ít nhất một vùng/ảnh gốc được trả về): nhóm theo mã ảnh. Không mở khoá. */
export async function listImages(c: MedClient, patientCode: string): Promise<{ imageId: string; rows: RecordRow[] }[]> {
  const rows = (await c.listRecords(patientCode)).filter((r) => (r.type === 'vung' || r.type === 'anh') && r.refId);
  const by = new Map<string, RecordRow[]>();
  for (const r of rows) {
    (by.get(r.refId!) ?? by.set(r.refId!, []).get(r.refId!)!).push(r);
  }
  return [...by].map(([imageId, rs]) => ({ imageId, rows: rs }));
}

/** Mở một ảnh: giải mã CHỈ các vùng được phép, kiểm chữ ký + ràng buộc, ghép lên nền trống. */
export async function openImage(c: MedClient, rows: RecordRow[]): Promise<ImageView | null> {
  let tampered = 0;
  let base: { imageId: string; w: number; h: number; sha: string; series?: SeriesRef } | undefined;
  const regions: ImageView['regions'] = [];
  const parts: { rect: Rect; px: Rgba }[] = [];
  let original: ImageView['original'];
  const bad = (): void => { tampered++; };
  for (const row of rows) {
    let res;
    try { res = await c.openRecord(row); } catch (e) { if (e instanceof RecordIntegrityError) { bad(); continue; } throw e; }
    if (!res) continue;                                                               // không đủ quyền: bỏ qua (backend cũng không trả bản mã)
    const bind = res.signed?.bind as Bind | undefined;
    if (!res.signatureValid || !bind) { bad(); continue; }
    const d = res.data as { kind?: string; bytes?: string; mime?: string; pixels?: string; label?: string };
    if (row.type === 'anh') {
      if (bind.kind !== 'original' || d.kind !== 'original' || !d.bytes || !d.mime || bind.imageId !== row.refId) { bad(); continue; }
      const bytes = unb64(d.bytes);
      if (bytesToHex(sha256(bytes)) !== bind.origSha256) { bad(); continue; }     // ảnh gốc khớp băm đã ký
      original = { mime: d.mime, bytes, sha256: bind.origSha256 };
    } else if (row.type === 'vung') {
      const okShape = bind.kind === 'region' && d.kind === 'region' && !!d.pixels && !!bind.rect && bind.regionId === row.id && bind.imageId === row.refId
        && row.khoa === (res.signed?.khoa ?? '') && Number.isInteger(bind.imageW) && Number.isInteger(bind.imageH);
      if (!okShape) { bad(); continue; }
      try { validateRect(bind.rect!, bind.imageW, bind.imageH); } catch { bad(); continue; }
      let px: Rgba;
      try { px = await unpackPixels(d.pixels!, bind.rect!.w, bind.rect!.h); } catch { bad(); continue; }
      regions.push({ id: row.id, rect: bind.rect!, khoas: row.khoa.split(','), label: d.label ?? '' });
      parts.push({ rect: bind.rect!, px });
    } else continue;
    // mọi mảnh của cùng một ảnh phải khớp ảnh gốc (kích thước + băm + lát cắt): tráo mảnh của ảnh khác bị loại
    const cur = { imageId: bind.imageId, w: bind.imageW, h: bind.imageH, sha: bind.origSha256, series: bind.series };
    if (!base) base = cur;
    else if (base.imageId !== cur.imageId || base.w !== cur.w || base.h !== cur.h || base.sha !== cur.sha || JSON.stringify(base.series) !== JSON.stringify(cur.series)) {
      bad();
      if (row.type === 'vung') { regions.pop(); parts.pop(); } else original = undefined;
    }
  }
  if (!base) return tampered ? { imageId: rows[0]?.refId ?? '', width: 0, height: 0, pixels: blankRgba(1, 1), regions: [], limited: true, tampered } : null;
  const canvas = blankRgba(base.w, base.h);
  for (const p of parts) pasteRgba(canvas, p.px, p.rect.x, p.rect.y);
  return { imageId: base.imageId, width: base.w, height: base.h, pixels: canvas, regions, limited: !original, original, series: base.series, tampered };
}
