// Đổi các file danh mục JSON (ICD-10, dân tộc, nghề nghiệp, tỉnh/xã, chỉ số xét nghiệm) sang định dạng gọn của MedABE.
//   node tools/import-danhmuc.mjs "<thư mục chứa ksk_icd.json, ksk_xa.json, ...>"
// Chỉ ĐỌC các file danh mục dữ liệu. Không đọc file cấu hình/tài khoản của phần mềm nguồn, không dùng mã của nó.
// Kết quả ghi vào app/web/src/data/gen/ (được nạp lười, không làm nặng lúc mở ứng dụng).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('Dùng: node tools/import-danhmuc.mjs "<thư mục danh mục>"'); process.exit(1); }
const out = resolve('app/web/src/data/gen');
mkdirSync(out, { recursive: true });
const rd = (f) => JSON.parse(readFileSync(join(src, f), 'utf8').replace(/^﻿/, ''));
const save = (f, v) => { const s = JSON.stringify(v); writeFileSync(join(out, f), s); console.log(f.padEnd(18), (s.length / 1024).toFixed(0).padStart(6), 'KB'); };
const sym = (s) => String(s ?? '').replace(/³/g, '≥').replace(/£/g, '≤');   // ký tự ≥ ≤ bị đổi mã trong file nguồn
const clean = (s) => String(s ?? '').replace(/^[\s\-–]+/, '').replace(/\s+/g, ' ').trim();

// ICD-10: [mã, tên]
save('icd.json', rd('ksk_icd.json').map((x) => [x.ICD_MA.trim(), clean(x.ICD_TEN)]));

// Dân tộc: [mã, tên]
save('dantoc.json', rd('ksk_dantoc.json').map((x) => [String(x.MA).trim(), clean(x.TEN)]));

// Nghề nghiệp (nhóm cấp 1-2): [mã, tên]
save('nghenghiep.json', rd('ksk_nghenghiep.json').map((x) => [String(x.NGHENGHIEP_MA).trim(), clean(x.NGHE_NGHIEP)]));

// Tỉnh + xã/phường: tinh = [[mã tỉnh, tên]], xa = { mã tỉnh: [tên xã, ...] } (liên kết qua TINH_ID của danh mục tỉnh)
const tinh = rd('ksk_tinh.json').sort((a, b) => a.TENTINH.localeCompare(b.TENTINH, 'vi'));
const byId = new Map(tinh.map((t) => [String(t.TINH_ID), t.MATINH]));
const xa = {};
for (const x of rd('ksk_xa.json')) {
  const ma = byId.get(String(x.MATINH).trim());
  if (ma) (xa[ma] ??= []).push(clean(x.TENXA));
}
for (const k of Object.keys(xa)) xa[k] = [...new Set(xa[k])].sort((a, b) => a.localeCompare(b, 'vi'));   // tên xã/phường có thể trùng trong một tỉnh: giữ một
save('diachi.json', { tinh: tinh.map((t) => [t.MATINH, clean(t.TENTINH)]), xa });

// Chỉ số xét nghiệm: khoảng tham chiếu "a-b" (dấu phẩy thập phân) -> số; dạng khác ("<5", "âm tính"...) giữ nguyên văn, không đánh cờ cao/thấp.
const range = (s) => {
  const up = /^\s*[<≤£]\s*=?\s*([\d.,]+)\s*$/.exec(String(s ?? ''));      // "< 40" -> [0, 40] (chỉ có giới hạn trên)
  if (up) { const b = Number(up[1].replace(',', '.')); return Number.isFinite(b) ? [0, b] : null; }
  const m =/^\s*([\d.,]+)\s*[-–]\s*([\d.,]+)\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const a = Number(m[1].replace(',', '.')), b = Number(m[2].replace(',', '.'));
  return Number.isFinite(a) && Number.isFinite(b) && a <= b ? [a, b] : null;
};
// Khoảng tham chiếu bị hỏng trong file nguồn (Excel đổi "4-10" thành số ngày 46152): sửa tay theo giá trị phổ biến.
const FIX = { H17: { nam: [4, 10], nu: [4, 10], tc: "4 - 10" } };
const seen = new Set();
const xn = [];
for (const x of rd('ksk_xetnghiem.json')) {
  const ma = String(x.MA).trim();
  if (!ma || seen.has(ma)) continue;
  seen.add(ma);
  const fix = FIX[ma];
  xn.push({ ma, ten: clean(x.TEN), dv: clean(x.DONVIDO), nam: fix?.nam ?? range(x.BT_NAM), nu: fix?.nu ?? range(x.BT_NU), tcNam: fix ? fix.tc : clean(sym(x.BT_NAM)), tcNu: fix ? fix.tc : clean(sym(x.BT_NU)) });
}
save('xetnghiem.json', xn);

// Mẫu xét nghiệm có sẵn (danh sách mã chỉ số): người lớn và 6-18 tuổi.
const mau = (f) => rd(f).filter((m) => m.TenMau && m.TenMau !== '...').map((m) => ({ ten: clean(m.TenMau), ma: m.MaChiSo.map((c) => String(c).trim()).filter((c) => seen.has(c)) }));
save('mauxn.json', { adult: mau('ksk_macdinh_mauxn.json'), child: mau('ksk_macdinh_mauxn_6-18.json') });
console.log('Xong. Dữ liệu đã ghi vào', out);
