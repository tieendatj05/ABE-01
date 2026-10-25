// Tra cứu của PHỤ HUYNH bằng HAI thông tin phụ huynh vốn đã biết (không tài khoản, không thuộc tính ABE, không cần ai phát mã):
// số CCCD của học sinh + NGÀY SINH của học sinh. Mỗi bản ghi mang thêm một bản bọc khoá nội dung bằng khoá suy ra từ CẢ HAI;
// máy chủ chỉ thấy chỉ mục băm và dữ liệu mã hoá.
import { scrypt } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const te = new TextEncoder();
const enc = (s: string) => te.encode(s) as BufferSource;

export interface ParentWrap { iv: string; ct: string }

/** CCCD/mã học sinh: bỏ khoảng trắng, chữ hoa. */
export const normId = (s: string) => s.replace(/\s/g, '').toUpperCase();
/**
 * Ngày sinh về dạng chuẩn yyyy-mm-dd. Nhận "2012-03-15", "15/03/2012", "15-3-2012", "15.03.2012". Ngày không có thật => ''.
 */
export function normDob(s: string): string {
  const t = (s ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return '';
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Từ (CCCD + ngày sinh) suy ra (bằng KDF CHẬM scrypt) một chỉ mục tra cứu công khai và một khoá giải mã của gia đình.
// ĐÁNH ĐỔI ĐÃ CHẤP NHẬN (để phụ huynh không phải giữ mã nào): ngày sinh có rất ít khả năng - CCCD đã chứa sẵn năm sinh, nên ai biết
// CCCD chỉ cần thử ~366 ngày. Bảo vệ thật sự còn lại là: (1) phải biết CCCD của đúng em đó, (2) máy chủ giới hạn tốc độ tra cứu
// (20 lần/phút/máy) và ghi nhật ký. Đây KHÔNG phải ABE - ai biết CCCD + ngày sinh của học sinh đều xem được hồ sơ đó.
const derived = new Map<string, { idx: string; key: Uint8Array }>();
export function clearParentCache() {
  for (const value of derived.values()) value.key.fill(0);
  derived.clear();
}
function derive(id: string, dob: string) {
  const secret = normId(id) + '|' + normDob(dob);
  let d = derived.get(secret);
  if (!d) {
    const out = scrypt(te.encode(secret), te.encode('medabe/parent/v3-dob'), { N: 2 ** 12, r: 8, p: 1, dkLen: 48 });
    d = { idx: bytesToHex(out.slice(0, 16)), key: out.slice(16) };
    derived.set(secret, d);
  }
  return d;
}
/** Chỉ mục tra cứu công khai (máy chủ lưu và so khớp). Phụ thuộc cả CCCD lẫn ngày sinh. */
export const parentIdxOf = (id: string, dob: string) => derive(id, dob).idx;
const parentKey = (id: string, dob: string) => derive(id, dob).key;

const aes = (raw: Uint8Array, use: KeyUsage[]) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, use);

/** Bọc khoá nội dung của một bản ghi dưới khoá gia đình. */
export async function wrapForParent(id: string, dob: string, recordId: string, contentKey: Uint8Array): Promise<ParentWrap> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc('parent|' + recordId) }, await aes(parentKey(id, dob), ['encrypt']), contentKey as BufferSource));
  return { iv: bytesToHex(iv), ct: bytesToHex(ct) };
}

export async function unwrapForParent(id: string, dob: string, recordId: string, w: ParentWrap): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(w.iv) as BufferSource, additionalData: enc('parent|' + recordId) }, await aes(parentKey(id, dob), ['decrypt']), hexToBytes(w.ct) as BufferSource));
}

export interface ParentRow {
  id: string; patientIdx: string; type: string; khoa: string; createdAt: string;
  envelope: { iv: string; ciphertext: string }; parentWrap?: ParentWrap;
}
export interface ParentItem { type: string; khoa: string; data: unknown; ts: string; authorName: string }

/** Dấu vân tay "có dữ liệu mới chưa" (rẻ, gọi mỗi vài giây). Đổi giá trị => tải lại hồ sơ. */
export async function parentVersion(storageBase: string, id: string, dob: string, f: typeof fetch = (...a) => fetch(...a)): Promise<string> {
  const r = await f(`${storageBase.replace(/\/+$/, '')}/api/public/parent-version?parentIdx=${parentIdxOf(id, dob)}`);
  if (!r.ok) throw new Error('version ' + r.status);
  const j = (await r.json()) as { n: number; last: string };
  return `${j.n}|${j.last}`;
}

/** Tra cứu + giải mã tại máy phụ huynh. Máy chủ chỉ biết "có người hỏi chỉ mục này". Bản ghi không giải mã được bị bỏ qua; sai CCCD hoặc sai ngày sinh đều cho kết quả rỗng (không tiết lộ sai yếu tố nào). */
export async function fetchForParent(storageBase: string, id: string, dob: string, f: typeof fetch = (...a) => fetch(...a)): Promise<ParentItem[]> {
  if (normId(id).length < 5) throw new Error('Hãy nhập số CCCD của học sinh');
  if (!normDob(dob)) throw new Error('Hãy nhập ngày sinh của học sinh (ngày/tháng/năm)');
  const r = await f(`${storageBase.replace(/\/+$/, '')}/api/public/parent-records?parentIdx=${parentIdxOf(id, dob)}`);
  if (r.status === 429) throw new Error('Tra cứu quá nhanh, vui lòng thử lại sau ít phút');
  if (!r.ok) throw new Error('Không tra cứu được (máy chủ trả ' + r.status + ')');
  const rows = (await r.json()) as ParentRow[];
  const out: ParentItem[] = [];
  for (const row of rows) {
    if (!row.parentWrap) continue;
    try {
      const key = await unwrapForParent(id, dob, row.id, row.parentWrap);
      const ctx = `${row.patientIdx}|${row.type}|${row.id}`;
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(row.envelope.iv) as BufferSource, additionalData: enc(ctx) }, await aes(key, ['decrypt']), hexToBytes(row.envelope.ciphertext) as BufferSource));
      const { body } = JSON.parse(new TextDecoder().decode(plain)) as { body: string };
      const b = JSON.parse(body) as { data: unknown; ts: string; author: { name: string } };
      out.push({ type: row.type, khoa: row.khoa, data: b.data, ts: b.ts, authorName: b.author.name });
    } catch { /* sai ngày sinh hoặc dữ liệu bị sửa: bỏ qua bản ghi này */ }
  }
  return out;
}
