// NẠP LẠI CÁC FILE EXCEL CŨ (thư mục E:\NHAP LIEU) vào máy chủ demo đang chạy, bằng tài khoản NHẬP LIỆU — đúng đường đi của nút "Import Excel" trong app:
// đọc Excel → kiểm tra từng dòng như app → mã hoá từng hồ sơ trên máy này (ABE) → lưu. Người nhập (nhaplieu01) là TÁC GIẢ nên đọc lại được những hồ sơ này.
//
// QUYỀN RIÊNG TƯ: đây là dữ liệu học sinh THẬT (trẻ vị thành niên). Script CHỈ IN số lượng/thống kê lỗi theo cột — không in họ tên, CCCD, điện thoại, địa chỉ.
// Dữ liệu đi thẳng vào CSDL của máy chủ demo trên máy này (data-research/), được mã hoá; không gửi đi đâu khác.
//
//   npx tsx app/test-ui/nap-excel-cu.ts --ke-hoach                    (CHỈ đọc file và in kế hoạch; không cần máy chủ, không ghi gì)
//   npx tsx app/test-ui/nap-excel-cu.ts                               (nạp thật; chạy lại sẽ bỏ qua CCCD đã có trong đơn vị)
//   Tuỳ chọn: --thu-muc="E:\NHAP LIEU"  --tai-khoan=nhaplieu01  --chi=PHU-AN (chỉ nạp các file của đơn vị này)
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import readXlsx from 'read-excel-file/node';
import { UNITS } from '../web/src/data/catalog.js';
import { mapHeader, rowsToHanhChinh, type Row } from '../web/src/excel.js';
import { checkMau, validateDetailed, type HanhChinh, type Mau } from '../web/src/model.js';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(n + '='))?.slice(n.length + 1) ?? d;
const planOnly = process.argv.includes('--ke-hoach');
const DIR = resolve(arg('--thu-muc', 'E:/NHAP LIEU'));
const USER = arg('--tai-khoan', 'nhaplieu01');
const ONLY = arg('--chi', '');
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase();

/** Tên file → đơn vị (theo tên trường trong tên file). */
const RULES: [RegExp, string, Mau][] = [
  [/TAN TIEN/, 'THCS-TAN-TIEN', '6-18'],
  [/PHU AN/, 'TH-THCS-PHU-AN', '6-18'],
  [/TIN DUC/, 'TIN-DUC', '18'],          // file người lớn (30-39 tuổi): Mẫu 18
  [/CHU VAN AN/, 'TH-CHU-VAN-AN', '6-18'],
  [/VO TRUONG TOAN/, 'VO-TRUONG-TOAN', '6-18'],
];
const nguon = 'Nhà trường / Doanh nghiệp';

interface Plan { file: string; unit: string; sheet: string; total: number; ok: { data: HanhChinh }[]; errCols: Map<string, number>; dupInFile: number }
const plans: Plan[] = [];
const skipped: string[] = [];

for (const f of readdirSync(DIR).filter((x) => /\.xls[xm]$/i.test(x))) {
  const rule = RULES.find(([re]) => re.test(fold(f)));
  if (!rule) { skipped.push(`${f}: không nhận ra trường trong tên file`); continue; }
  const [, unit, mau] = rule;
  if (ONLY && unit !== ONLY) continue;
  let sheets: { sheet: string; data: Row[] }[];
  try { sheets = (await readXlsx(join(DIR, f))) as { sheet: string; data: Row[] }[]; } catch (e) { skipped.push(`${f}: không đọc được (${(e as Error).message.slice(0, 80)})`); continue; }
  // giống app: chọn sheet có cột họ tên/CCCD và có dòng dữ liệu
  const sheet = sheets.find((s) => mapHeader(s.data) && rowsToHanhChinh(s.data, mapHeader(s.data)!, { nguonChiTra: nguon }).length);
  if (!sheet) { skipped.push(`${f}: không có sheet danh sách học sinh (có thể là file kết quả khám — dùng chế độ "Thêm xét nghiệm")`); continue; }
  const items = rowsToHanhChinh(sheet.data, mapHeader(sheet.data)!, { nguonChiTra: nguon });
  const errCols = new Map<string, number>();
  const seen = new Set<string>();
  let dup = 0;
  const ok: { data: HanhChinh }[] = [];
  for (const it of items) {
    const errs = validateDetailed(it.data);
    const m = checkMau(it.data, mau);
    if (m) errs.push(m);
    if (it.data.cccd && seen.has(it.data.cccd)) { errs.push({ col: 'Số CCCD', value: '', msg: 'trùng trong file' }); dup++; }
    if (it.data.cccd) seen.add(it.data.cccd);
    if (errs.length) for (const e of errs) errCols.set(`${e.col}: ${e.msg.replace(/\d{6,}/g, '…')}`, (errCols.get(`${e.col}: ${e.msg.replace(/\d{6,}/g, '…')}`) ?? 0) + 1);
    else ok.push({ data: it.data });
  }
  plans.push({ file: f, unit, sheet: sheet.sheet, total: items.length, ok, errCols, dupInFile: dup });
}

console.log(`\nKẾ HOẠCH nạp từ ${DIR} (tài khoản ${USER}):`);
for (const p of plans) {
  const u = UNITS.find((x) => x.ma === p.unit);
  console.log(`- ${p.file}\n    → đơn vị ${p.unit}${u ? '' : ' (CHƯA có trong danh sách đơn vị của app: sẽ thêm vào catalog)'} | sheet "${p.sheet}" | ${p.total} dòng | hợp lệ ${p.ok.length} | lỗi ${p.total - p.ok.length} (trùng trong file ${p.dupInFile})`);
  const top = [...p.errCols.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [k, n] of top) console.log(`        · ${n} dòng: ${k}`);
}
for (const s of skipped) console.log(`- BỎ QUA ${s}`);
if (planOnly) { console.log('\n(--ke-hoach: chưa ghi gì.)'); process.exit(0); }

const { cleanupDevices, loginDemo } = await import('./demo-util.js');
try {
  const c = await loginDemo(USER);
  for (const p of plans) {
    const have = new Set<string>();
    const opened = await c.openMany(await c.listGroup(p.unit));
    for (const o of opened) { const k = (o?.data as { cccd?: string } | undefined)?.cccd; if (k) have.add(k); }
    const todo = p.ok.filter((x) => !have.has(x.data.cccd));
    if (!todo.length) { console.log(`${p.unit}: không có hồ sơ mới (đã có ${have.size}).`); continue; }
    const t0 = Date.now();
    await c.saveMany(todo.map((x) => ({ patientCode: x.data.cccd, type: 'hanhchinh' as const, khoa: 'KSK', data: x.data, group: p.unit })));
    console.log(`${p.unit}: đã nạp ${todo.length} hồ sơ (bỏ qua ${p.ok.length - todo.length} đã có) trong ${Math.round((Date.now() - t0) / 1000)} giây.`);
  }
} finally { await cleanupDevices(); }
