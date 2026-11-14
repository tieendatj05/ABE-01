// Chính sách CP-ABE của app đang dùng (chế độ TÀI KHOẢN), sinh từ tài liệu policy do registry KÝ (cùng nguồn với kiểm quyền ở backend):
//   phần dữ liệu = Người nhập phần đó (MED:Author:<userId>)  HOẶC  (Vai trò bác sĩ VÀ chuyên khoa phù hợp)
// Không có nhánh "mọi bác sĩ" cho mục lâm sàng, không có nhánh "kết luận đọc mọi khoa", không có nhánh "máy tạo bản ghi", không có phá-vỡ-kính.
// Danh mục khoa có MÃ ỔN ĐỊNH; tên hiển thị ("Mắt", "MẮT", "mắt") được chuẩn hoá về cùng mã trước khi so với danh mục.

export interface KhoaCatalogItem { code: string; label: string; shared: boolean; aliases: string[] }
export interface AppTypeRule { khoa: 'none' | 'one' | 'many'; policy: string[]; write: string[]; identity?: boolean }
export interface AppModel { version: string; authorAttribute: string; types: Record<string, AppTypeRule> }
export interface PolicyMatrix { version: string; khoaCatalog: KhoaCatalogItem[]; app: AppModel }

const fold = (s: string): string => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

/** Tên hiển thị bất kỳ -> mã khoa ổn định; không có trong danh mục hoặc mơ hồ -> undefined. */
export function normalizeKhoa(catalog: KhoaCatalogItem[], raw: string): string | undefined {
  const want = fold(raw ?? '');
  const hit = new Set<string>();
  for (const c of catalog) if ([c.code, c.label, ...c.aliases].some((n) => fold(n) === want)) hit.add(c.code);
  return hit.size === 1 ? [...hit][0] : undefined;
}

/** "mat, NHI" -> ["Nhi","Mat"] theo thứ tự danh mục, không trùng. Có phần tử sai -> ném lỗi (không đoán). */
export function normalizeKhoaList(catalog: KhoaCatalogItem[], csv: string | string[]): string[] {
  const parts = (Array.isArray(csv) ? csv : String(csv ?? '').split(',')).map((x) => x.trim()).filter(Boolean);
  const codes = new Set<string>();
  for (const p of parts) {
    const c = normalizeKhoa(catalog, p);
    if (!c) throw new Error(`Chuyên khoa "${p}" không có trong danh mục`);
    codes.add(c);
  }
  return catalog.map((c) => c.code).filter((c) => codes.has(c));
}

/** Các nhánh OR (mỗi nhánh là các thuộc tính AND, CHƯA gắn epoch) của policy chuẩn cho (loại, các khoa, tác giả). uid rỗng: bản ghi cũ không biết tác giả. */
export function appBranches(m: PolicyMatrix, type: string, khoas: string[], uid?: string): string[][] {
  const rule = m.app.types[type];
  if (!rule) throw new Error(`Chính sách không có loại "${type}"`);
  const out: string[][] = [];
  for (const t of rule.policy) {
    if (t === m.app.authorAttribute) { if (uid) out.push([`MED:${t}:${uid}`]); }
    else if (t.endsWith('&Khoa')) for (const k of khoas) out.push([`MED:${t.slice(0, -5)}`, `MED:Khoa:${k}`]);
    else if (t.includes('+')) out.push(t.split('+').map((a) => `MED:${a}`));        // "A+B" = nhánh (A AND B), ví dụ Giám sát = Role:GiamSat+Auth:MFA
    else out.push([`MED:${t}`]);
  }
  return out;
}

/** Khoa hợp lệ cho loại này (đã chuẩn hoá). Loại không dùng khoa: []. */
export function khoasForType(m: PolicyMatrix, type: string, raw: string | string[]): string[] {
  const rule = m.app.types[type];
  if (!rule) throw new Error(`Chính sách không có loại "${type}"`);
  if (rule.khoa === 'none') return [];
  const ks = normalizeKhoaList(m.khoaCatalog, raw);
  if (!ks.length || (rule.khoa === 'one' && ks.length !== 1) || ks.length > 4) throw new Error(`Khoa không hợp lệ cho "${type}": ${String(raw)}`);
  return ks;
}

/** Chuỗi policy "A OR (B AND C)" — `ver` gắn phiên bản epoch cho từng thuộc tính. */
export function appPolicyString(m: PolicyMatrix, type: string, khoas: string[], uid: string | undefined, ver: (a: string) => string = (a) => a): string {
  return appBranches(m, type, khoas, uid)
    .map((b) => (b.length === 1 ? ver(b[0]) : `(${b.map(ver).join(' AND ')})`))
    .join(' OR ');
}
