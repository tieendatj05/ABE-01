// NẠP 2 FILE: (1) công ty CNM LONGWELL (xlsx, công nhân) và (2) trường TH Phước Tân (xls → CSV, giáo viên) vào máy chủ demo, rồi LIÊN THÔNG những người ĐÃ CÓ CHIỀU CAO + CÂN NẶNG.
//   Mỗi người: Hành chính (import như nút "Import Excel") + Khám thể lực/lâm sàng/phân loại (như "Thêm xét nghiệm") → nếu có đủ chiều cao & cân nặng thì gửi lên cổng
//   Bộ Y tế (mô phỏng), nhận biên nhận có chữ ký → hiện ở tab "Đã liên thông". Người chưa có chiều cao/cân nặng chỉ được nạp phần Hành chính, vẫn ở "Chưa liên thông".
//
// QUYỀN RIÊNG TƯ: dữ liệu NGƯỜI THẬT. Script CHỈ in số lượng. Dữ liệu đi vào CSDL của máy chủ demo trên máy này, đã mã hoá (ABE), tác giả = nhaplieu01.
// CCCD: file công ty KHÔNG có CCCD (chỉ có Số thẻ 8 chữ số) mà hệ thống dùng CCCD làm mã hồ sơ → dùng MÃ TẠM 12 số "7700" + Số thẻ (không phải CCCD thật, tiền tố 770 không
// phải mã tỉnh nào). Số thẻ trùng giữa 2 người khác nhau: người sau dùng "7800". Khi có CCCD thật, hãy cập nhật lại.
//
//   npx tsx app/test-ui/nap-cty-truong.ts --ke-hoach --truong-csv=<csv>        (chỉ in kế hoạch)
//   npx tsx app/test-ui/nap-cty-truong.ts --truong-csv=<csv>                   (nạp + liên thông thật; chạy lại an toàn: bỏ qua người đã có)
import { readFileSync } from 'node:fs';
import readXlsx from 'read-excel-file/node';
import type { RecordType } from '../../security/src/index.js';
import { submitPatients } from '../web/src/byt.js';
import { norm, mapHeader, mapResultHeader, rowsToHanhChinh, rowsToResults, type Row } from '../web/src/excel.js';
import { checkMau, validateDetailed, type HanhChinh } from '../web/src/model.js';

const arg = (n: string, d = '') => process.argv.find((a) => a.startsWith(n + '='))?.slice(n.length + 1) ?? d;
const planOnly = process.argv.includes('--ke-hoach');
const CTY1 = arg('--cty', 'C:/Users/ASUS/Documents/Downloads/FILE_NHAP__CNM_LONGWELL 06_07_11_2026 (1).xlsx');
const CTY2 = arg('--cty2', 'C:/Users/ASUS/Documents/Downloads/FILE_NHAP__CNM_LONGWELL 06_07_11_2026 (2).xlsx');
const TRUONG = arg('--truong-csv');
const USER = arg('--tai-khoan', 'nhaplieu01');
const nguon = 'Nhà trường / Doanh nghiệp';

const RESULT_COLS = ['CHIỀU CAO', 'CÂN NẶNG', 'MẠCH', 'HUYẾT ÁP', 'MẮT PHẢI KHÔNG KÍNH', 'MẮT TRÁI KHÔNG KÍNH', 'MẮT PHẢI CÓ KÍNH', 'MẮT TRÁI CÓ KÍNH', 'BỆNH LÝ MẮT', 'TAI MŨI HỌNG', 'RĂNG HÀM MẶT', 'PHÂN LOẠI'];
const HEAD = ['Họ và tên', 'Giới tính', 'Ngày sinh', 'Số điện thoại', 'Nơi ở hiện tại', 'Ngày cấp', ...RESULT_COLS, 'Số định danh cá nhân/CCCD'];

interface Source { unit: string; label: string; rows: Row[]; stats: Record<string, number> }

/** CSV (UTF-8, có ngoặc kép) → mảng dòng. */
function parseCsv(txt: string): string[][] {
  const rows: string[][] = []; let cur: string[] = [], f = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { cur.push(f); f = ''; } else if (ch === '\n') { cur.push(f.replace(/\r$/, '')); rows.push(cur); cur = []; f = ''; } else f += ch;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  return rows;
}
const colOf = (head: unknown[], name: string) => head.findIndex((h) => norm(h).replace(/[^a-z0-9 ]/g, '') === norm(name).replace(/[^a-z0-9 ]/g, ''));
const clean = (v: unknown) => (v == null ? '' : v instanceof Date ? v : String(v).trim());

// ---------- (1) Công ty ----------
async function loadCty(): Promise<Source> {
  const sheetOf = async (f: string) => ((await readXlsx(f)) as { sheet: string; data: Row[] }[]).find((s) => s.sheet === 'NHẬP CÔNG NHÂN MỚI')!.data;
  const a = await sheetOf(CTY1);
  let dupFile = false;
  try { dupFile = JSON.stringify(a) === JSON.stringify(await sheetOf(CTY2)); } catch { /* không có file 2 */ }
  const head = a[0];
  const ix = (n: string) => { const j = head.findIndex((h) => norm(h).startsWith(norm(n))); if (j < 0) throw new Error('Thiếu cột ' + n); return j; };
  const iThe = ix('so the'), iTen = ix('ho va ten'), iGt = ix('gioi tinh'), iDt = ix('sdt'), iNs = ix('ngay sinh');
  const res = RESULT_COLS.map((c) => head.findIndex((h) => norm(h) === norm(c)));
  const rows: Row[] = [HEAD];
  const stats = { 'dòng trong sheet': a.length - 1, 'bỏ vì lỗi #N/A hoặc thiếu số thẻ/ngày sinh': 0, 'số thẻ trùng giữa 2 người (dùng mã 7800)': 0 };
  const used = new Set<string>();
  for (const r of a.slice(1)) {
    if (!r.some((c) => c != null && String(c).trim() !== '')) continue;
    const the = String(r[iThe] ?? '').trim();
    if (!/^\d{8}$/.test(the) || String(r[iTen] ?? '').includes('#') || String(r[iNs] ?? '').includes('#') || !String(r[iNs] ?? '').trim()) { stats['bỏ vì lỗi #N/A hoặc thiếu số thẻ/ngày sinh']++; continue; }
    let id = '7700' + the;
    if (used.has(id)) { id = '7800' + the; stats['số thẻ trùng giữa 2 người (dùng mã 7800)']++; }
    used.add(id);
    rows.push([clean(r[iTen]), clean(r[iGt]), clean(r[iNs]), clean(r[iDt]), '', '', ...res.map((j) => (j < 0 ? '' : clean(r[j]))), id]);
  }
  return { unit: 'CNM-LONGWELL', label: `Công ty CNM LONGWELL (${dupFile ? 'file (2) trùng hệt file (1) → nạp một lần' : 'chỉ file (1)'})`, rows, stats };
}

// ---------- (2) Trường ----------
function loadTruong(): Source {
  const csv = parseCsv(readFileSync(TRUONG, 'utf8').replace(/^\uFEFF/, ''));
  const head = csv[0];
  const ix = (n: string) => { const j = colOf(head, n); if (j < 0) throw new Error('Thiếu cột ' + n); return j; };
  const iTen = ix('HỌ TÊN'), iNs = ix('NGÀY SINH'), iGt = ix('GIỚI TÍNH'), iId = ix('Số định danh cá nhân/CCCD'), iCap = ix('Ngày, tháng, năm Cấp CCCD'), iDc = ix('Địa chỉ thường trú');
  const res = RESULT_COLS.map((c) => colOf(head, c));
  const stats = { 'dòng trong sheet': 0, 'CCCD thiếu số 0 đầu, đã bù cho đủ 12 số': 0, 'bỏ vì CCCD hỏng (không đọc được)': 0 };
  const rows: Row[] = [HEAD];
  for (const r of csv.slice(1)) {
    if (!r.some((c) => c.trim())) continue;
    stats['dòng trong sheet']++;
    let id = (r[iId] ?? '').trim().replace(/^\*/, '');
    if (/^\d{11}$/.test(id)) { id = '0' + id; stats['CCCD thiếu số 0 đầu, đã bù cho đủ 12 số']++; }
    if (!/^\d{12}$/.test(id)) { stats['bỏ vì CCCD hỏng (không đọc được)']++; continue; }
    const cap = (r[iCap] ?? '').trim();
    rows.push([r[iTen]?.trim() ?? '', r[iGt]?.trim() ?? '', (r[iNs] ?? '').trim(), '', (r[iDc] ?? '').trim() === '0' ? '' : (r[iDc] ?? '').trim(), /^\d{5}$/.test(cap) ? Number(cap) : cap, ...res.map((j) => (j < 0 ? '' : (r[j] ?? '').trim())), id]);
  }
  return { unit: 'TH-PHUOC-TAN', label: 'Trường TH Phước Tân (giáo viên, nhân viên)', rows, stats };
}

interface Person { data: HanhChinh; key: string }
interface Plan { src: Source; people: Person[]; results: Map<string, ReturnType<typeof rowsToResults>[number]>; withHW: Set<string>; bad: Map<string, number> }
function planOf(src: Source): Plan {
  const hm = mapHeader(src.rows)!;
  const items = rowsToHanhChinh(src.rows, hm, { nguonChiTra: nguon });
  const rm = mapResultHeader(src.rows)!;
  const results = new Map(rowsToResults(src.rows, rm).map((r) => [r.cccd, r]));
  const bad = new Map<string, number>(); const seen = new Set<string>(); const people: Person[] = [];
  for (const it of items) {
    const errs = validateDetailed(it.data); const m = checkMau(it.data, '18'); if (m) errs.push(m);
    if (seen.has(it.data.cccd)) errs.push({ col: 'Số CCCD', value: '', msg: 'trùng trong file' }); seen.add(it.data.cccd);
    if (errs.length) for (const e of errs) { const k = `${e.col}: ${e.msg.replace(/\d{5,}/g, '…')}`; bad.set(k, (bad.get(k) ?? 0) + 1); } else people.push({ data: it.data, key: it.data.cccd });
  }
  const num = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0;
  const withHW = new Set(people.filter((p) => { const t = results.get(p.key)?.thecuc; return !!t && num(t.chieuCao) && num(t.canNang); }).map((p) => p.key));
  return { src, people, results, withHW, bad };
}

const plans = [planOf(await loadCty()), planOf(loadTruong())];
console.log('\nKẾ HOẠCH (tài khoản ' + USER + '):');
for (const p of plans) {
  console.log(`- ${p.src.label}\n    → đơn vị ${p.src.unit}`);
  for (const [k, v] of Object.entries(p.src.stats)) console.log(`    · ${k}: ${v}`);
  console.log(`    · hợp lệ để nạp Hành chính: ${p.people.length} | lỗi dữ liệu: ${[...p.bad.values()].reduce((a, b) => a + b, 0)}`);
  for (const [k, n] of [...p.bad].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`        - ${n} dòng: ${k}`);
  console.log(`    · CÓ chiều cao + cân nặng → nạp Khám thể lực và LIÊN THÔNG: ${p.withHW.size}`);
  console.log(`    · chưa có chiều cao/cân nặng → chỉ Hành chính, ở "Chưa liên thông": ${p.people.length - p.withHW.size}`);
}
if (planOnly) { console.log('\n(--ke-hoach: chưa ghi gì.)'); process.exit(0); }

const { cleanupDevices, loginDemo } = await import('./demo-util.js');
try {
  const c = await loginDemo(USER);
  for (const p of plans) {
    const unit = p.src.unit;
    // 1) Hành chính cho người chưa có trong đơn vị
    const have = new Set<string>();
    for (const o of await c.openMany(await c.listGroup(unit))) { const k = (o?.data as { cccd?: string } | undefined)?.cccd; if (k) have.add(k); }
    const fresh = p.people.filter((x) => !have.has(x.key));
    if (fresh.length) await c.saveMany(fresh.map((x) => ({ patientCode: x.key, type: 'hanhchinh' as const, khoa: 'KSK', data: x.data, group: unit })));
    console.log(`${unit}: Hành chính — nạp ${fresh.length}, đã có sẵn ${p.people.length - fresh.length}.`);
    // 2) Khám thể lực + lâm sàng + phân loại, chỉ cho người có đủ chiều cao & cân nặng và chưa có thể lực
    const haveTl = new Set((await c.listGroup(unit, 'thecuc')).map((r) => r.patientIdx));
    const inputs: { patientCode: string; type: RecordType; khoa: string; data: unknown; group: string }[] = [];
    let people2 = 0;
    for (const x of p.people) {
      if (!p.withHW.has(x.key) || haveTl.has(c.patientIdx(x.key))) continue;
      const r = p.results.get(x.key)!; people2++;
      inputs.push({ patientCode: x.key, type: 'thecuc', khoa: 'KSK', data: r.thecuc, group: unit });
      for (const [khoa, d] of Object.entries(r.lamsang)) inputs.push({ patientCode: x.key, type: 'lamsang', khoa, data: d, group: unit });
      if (r.ketluan) inputs.push({ patientCode: x.key, type: 'ketluan', khoa: 'KSK', data: r.ketluan, group: unit });
    }
    if (inputs.length) await c.saveMany(inputs);
    console.log(`${unit}: kết quả khám — nạp ${inputs.length} mục cho ${people2} người.`);
    // 3) Liên thông những người có chiều cao + cân nặng
    const set = new Set([...p.withHW].map((k) => c.patientIdx(k)));
    const t0 = Date.now();
    const out = await submitPatients(c, unit, set, (d, t) => { if (d === t || d % 500 === 0) process.stdout.write(`\r${unit}: liên thông ${d}/${t} bản ghi…`); });
    console.log(`\n${unit}: đã gửi ${out.sent} bản ghi mã hoá lên cổng Bộ Y tế, nhận ${out.receipts.size} biên nhận, cổng từ chối ${out.rejected} (${Math.round((Date.now() - t0) / 1000)} giây).`);
    // 4) Đối chiếu: bao nhiêu hồ sơ hành chính đã có biên nhận
    const latest = new Map<string, { id: string }>();
    for (const r of await c.listGroup(unit)) latest.set(r.patientIdx, r);
    const st = await c.bytStatus([...latest.values()].map((r) => r.id));
    const linked = [...latest.keys()].filter((k) => st.has(latest.get(k)!.id)).length;
    console.log(`${unit}: ĐỐI CHIẾU → Đã liên thông ${linked} | Chưa liên thông ${latest.size - linked} (tổng ${latest.size} hồ sơ).`);
  }
} finally { await cleanupDevices(); }
