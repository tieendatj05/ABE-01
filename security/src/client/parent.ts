// Tra cứu của PHỤ HUYNH bằng HAI thông tin phụ huynh vốn đã biết (không tài khoản, không thuộc tính ABE, không cần ai phát mã):
// số CCCD của học sinh + HỌ TÊN của học sinh. Mỗi bản ghi mang thêm một bản bọc khoá nội dung bằng khoá suy ra từ CẢ HAI;
// máy chủ chỉ thấy chỉ mục băm và dữ liệu mã hoá.
import { scrypt } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const te = new TextEncoder();
const enc = (s: string) => te.encode(s) as BufferSource;

export interface ParentWrap { iv: string; ct: string }

/** CCCD/mã học sinh: bỏ khoảng trắng, chữ hoa. */
export const normId = (s: string) => s.replace(/\s/g, '').toUpperCase();
/**
 * Họ tên về dạng chuẩn để hai bên (nhân viên nhập, phụ huynh gõ trên điện thoại) ra CÙNG một khoá: bỏ dấu tiếng Việt (cả dạng tổ hợp lẫn dựng sẵn),
 * đ→D, chữ hoa, mọi ký tự không phải chữ/số thành khoảng trắng rồi gộp khoảng trắng. "Nguyễn  Văn-An" == "NGUYEN VAN AN".
 */
export const normName = (s: string) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/** Họ tên hợp lệ để làm khoá: ít nhất 2 ký tự chữ/số sau khi chuẩn hoá. */
export const validName = (s: string) => normName(s).replace(/ /g, '').length >= 2;

/**
 * Ngày sinh về dạng chuẩn yyyy-mm-dd. Nhận "2012-03-15", "15/03/2012", "15-3-2012", "15.03.2012". Ngày không có thật => ''.
 * (Không còn dùng làm khoá tra cứu; giữ lại cho phần hiển thị/nhập liệu.)
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

// Từ (CCCD + họ tên) suy ra (bằng KDF CHẬM scrypt) một chỉ mục tra cứu công khai và một khoá giải mã của gia đình.
// ĐÁNH ĐỔI ĐÃ CHẤP NHẬN (để phụ huynh chỉ cần nhập họ tên + CCCD): họ tên KHÔNG phải bí mật, nên thực chất bí mật còn lại là số CCCD của em.
// Bảo vệ còn lại: (1) phải biết CCCD của đúng em đó, (2) cổng giới hạn tốc độ tra cứu và chặn IP dò nhiều lần không ra kết quả, ghi nhật ký.
// Đây KHÔNG phải ABE - ai biết CCCD + họ tên của học sinh đều xem được hồ sơ đó. Kẻ có bản sao CSDL có thể đoán CCCD OFFLINE (không bị giới hạn tốc độ).
export interface ParentCreds { idx: string; key: Uint8Array }
const derived = new Map<string, ParentCreds>();
export function clearParentCache() {
  for (const value of derived.values()) value.key.fill(0);
  derived.clear();
}
/** Suy khoá tra cứu từ CCCD + họ tên (chậm có chủ đích, ~100-300 ms trên điện thoại). Kết quả được nhớ trong phiên. */
export function parentCreds(id: string, name: string): ParentCreds {
  const secret = normId(id) + '|' + normName(name);
  let d = derived.get(secret);
  if (!d) {
    const out = scrypt(te.encode(secret), te.encode('medabe/parent/v4-name'), { N: 2 ** 12, r: 8, p: 1, dkLen: 48 });
    d = { idx: bytesToHex(out.slice(0, 16)), key: out.slice(16) };
    derived.set(secret, d);
  }
  return d;
}
/** Dạng lưu được (hex) của thông tin tra cứu; app điện thoại cất nó đã mã hoá để mở lại không cần gõ lại. */
export const exportCreds = (c: ParentCreds) => ({ idx: c.idx, key: bytesToHex(c.key) });
export const importCreds = (c: { idx: string; key: string }): ParentCreds => ({ idx: c.idx, key: hexToBytes(c.key) });

/** Chỉ mục tra cứu công khai (máy chủ lưu và so khớp). Phụ thuộc cả CCCD lẫn họ tên. */
export const parentIdxOf = (id: string, name: string) => parentCreds(id, name).idx;

const aes = (raw: Uint8Array, use: KeyUsage[]) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, use);

/** Bọc khoá nội dung của một bản ghi dưới khoá gia đình. */
export async function wrapForParent(id: string, name: string, recordId: string, contentKey: Uint8Array): Promise<ParentWrap> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc('parent|' + recordId) }, await aes(parentCreds(id, name).key, ['encrypt']), contentKey as BufferSource));
  return { iv: bytesToHex(iv), ct: bytesToHex(ct) };
}

async function unwrapWith(key: Uint8Array, recordId: string, w: ParentWrap): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(w.iv) as BufferSource, additionalData: enc('parent|' + recordId) }, await aes(key, ['decrypt']), hexToBytes(w.ct) as BufferSource));
}
export const unwrapForParent = (id: string, name: string, recordId: string, w: ParentWrap) => unwrapWith(parentCreds(id, name).key, recordId, w);

export interface ParentRow {
  id: string; patientIdx: string; type: string; khoa: string; createdAt: string;
  envelope: { iv: string; ciphertext: string }; parentWrap?: ParentWrap;
}
export interface ParentItem { type: string; khoa: string; data: unknown; ts: string; authorName: string }

const base = (b: string) => b.replace(/\/+$/, '');

/** Dấu vân tay "có dữ liệu mới chưa" (rẻ, gọi mỗi vài giây). Đổi giá trị => tải lại hồ sơ. */
export async function versionWithCreds(storageBase: string, creds: ParentCreds, f: typeof fetch = (...a) => fetch(...a), signal?: AbortSignal): Promise<string> {
  const r = await f(`${base(storageBase)}/api/public/parent-version?parentIdx=${creds.idx}`, { signal });
  if (r.status === 429) throw new Error('Tra cứu quá nhanh, vui lòng thử lại sau ít phút');
  if (!r.ok) throw new Error('version ' + r.status);
  const j = (await r.json()) as { n: number; last: string };
  return `${j.n}|${j.last}`;
}
export const parentVersion = (storageBase: string, id: string, name: string, f?: typeof fetch) => versionWithCreds(storageBase, parentCreds(id, name), f);

/** Tra cứu + giải mã tại máy phụ huynh bằng thông tin đã suy sẵn. Bản ghi không giải mã được (sai khoá/dữ liệu bị sửa) bị bỏ qua. */
export async function fetchWithCreds(storageBase: string, creds: ParentCreds, f: typeof fetch = (...a) => fetch(...a), signal?: AbortSignal): Promise<ParentItem[]> {
  const r = await f(`${base(storageBase)}/api/public/parent-records?parentIdx=${creds.idx}`, { signal });
  if (r.status === 429) throw new Error('Tra cứu quá nhanh hoặc nhập sai nhiều lần, vui lòng thử lại sau ít phút');
  if (!r.ok) throw new Error('Không tra cứu được (máy chủ trả ' + r.status + ')');
  const rows = (await r.json()) as ParentRow[];
  const out: ParentItem[] = [];
  for (const row of rows) {
    if (!row.parentWrap) continue;
    try {
      const key = await unwrapWith(creds.key, row.id, row.parentWrap);
      const ctx = `${row.patientIdx}|${row.type}|${row.id}`;
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(row.envelope.iv) as BufferSource, additionalData: enc(ctx) }, await aes(key, ['decrypt']), hexToBytes(row.envelope.ciphertext) as BufferSource));
      const { body } = JSON.parse(new TextDecoder().decode(plain)) as { body: string };
      const b = JSON.parse(body) as { data: unknown; ts: string; author: { name: string } };
      out.push({ type: row.type, khoa: row.khoa, data: b.data, ts: b.ts, authorName: b.author.name });
    } catch { /* sai họ tên hoặc dữ liệu bị sửa: bỏ qua bản ghi này */ }
  }
  return out;
}

/** Tra cứu bằng CCCD + họ tên. Sai CCCD hoặc sai họ tên đều cho kết quả rỗng (không tiết lộ sai yếu tố nào). */
export async function fetchForParent(storageBase: string, id: string, name: string, f?: typeof fetch): Promise<ParentItem[]> {
  if (normId(id).length < 5) throw new Error('Hãy nhập số CCCD của học sinh');
  if (!validName(name)) throw new Error('Hãy nhập họ và tên của học sinh');
  return fetchWithCreds(storageBase, parentCreds(id, name), f);
}
