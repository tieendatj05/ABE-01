// Tạo file .xlsx GIẢ (dữ liệu tự bịa) có đúng cấu trúc cột như file nhập của trường - để thử giao diện mà không dùng dữ liệu thật.
import { strToU8, zipSync } from 'fflate';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function makeXlsx(sheets) {
  const shared = []; const idx = new Map();
  const si = (t) => { if (!idx.has(t)) { idx.set(t, shared.length); shared.push(t); } return idx.get(t); };
  const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) =>
    `<row r="${ri + 1}">${r.map((v, ci) => (v == null || v === '' ? '' : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(String(v))}</v></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = {};
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows)); });
  files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`);
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  files['_rels/.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  return Buffer.from(zipSync(files));
}

const HEAD = ['STT', 'LỚP', 'Họ tên', 'Giới tính', '', 'Ngày sinh', 'Dân tộc', '', 'Số CMND/CCCD/Mã định danh', '', 'Ngày cấp Số CCCD', 'Nơi cấp Số CCCD', 'Họ và tên bố, mẹ hoặc người giám hộ', 'Mã định danh (CCCD) của bố, mẹ hoặc người giám hộ', 'Tỉnh/Thành phố nơi ở hiện tại*', '', 'Xã/Phường nơi ở hiện tại*', '', 'Nơi ở hiện tại', 'Nhóm máu', 'Đối tượng khám định kỳ', '', 'Điện thoại'];
const HEAD_RESULT = [...HEAD, 'CHIỀU CAO (CM)', 'CÂN NẶNG (KG)', 'BMI', 'KẾT LUẬN BMI', 'MẠCH', 'HUYẾT ÁP', 'NHI', 'MẮT PHẢI KHÔNG KÍNH', 'MẮT TRÁI KHÔNG KÍNH', 'MẮT PHẢI CÓ KÍNH', 'MẮT TRÁI CÓ KÍNH', 'BỆNH LÝ MẮT', 'TAI MŨI HỌNG', 'RĂNG HÀM MẶT', 'PHÂN LOẠI'];
const HO = ['NGUYEN', 'TRAN', 'LE', 'PHAM', 'HOANG', 'VU'];
const TEN = ['AN', 'BINH', 'CHI', 'DUNG', 'EM', 'GIANG', 'HOA', 'KHANH', 'LINH', 'MINH'];

/** n học sinh giả; `loi` dòng cuối cố ý sai (CCCD thiếu số, ngày sinh vô nghĩa, tuổi ngoài mẫu). */
export function fakeStudents(n, { loi = 3 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const nu = i % 2;
    const bad = i >= n - loi ? i - (n - loi) : -1;
    const cccd = bad === 0 ? '0790001234' : `079${String(1000000 + i).padStart(9, '0')}`;
    const ns = bad === 1 ? '31/02/2012' : bad === 2 ? '05/05/1990' : `${String(1 + (i % 27)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/${2010 + (i % 3)}`;
    return [i + 1, i % 2 ? '6A2' : '6A1', `${HO[i % 6]} ${nu ? 'THI' : 'VAN'} ${TEN[i % 10]} ${String(i + 1).padStart(2, '0')}`, nu ? 'Nữ' : 'Nam', null, ns, i % 9 === 0 ? 'Hoa' : 'Kinh', null, cccd, null,
      i % 3 ? '12/05/2023' : null, i % 3 ? 'Cục Cảnh sát QLHC về TTXH' : '', `${HO[(i + 2) % 6]} VAN CHA ${i + 1}`, i % 4 ? `079${String(2000000 + i).padStart(9, '0')}` : null,
      'TP. Đồng Nai', null, 'Phường Mẫu', null, `${i + 1} đường Giả`, null, 'Học sinh', null, `09010${String(10000 + i).padStart(5, '0')}`];
  });
}

export function fakeResults(students, m) {
  return students.slice(0, m).map((r, i) => [...r, 150 + (i % 20), 40 + (i % 15), '', '', 70 + (i % 20), `${100 + (i % 20)}/${60 + (i % 10)}`, 'Bình thường', i % 5 === 0 ? '7/10' : '10/10', '10/10', '', '', i % 5 === 0 ? 'Cận thị' : 'Bình thường', 'Bình thường', i % 4 === 0 ? 'Sâu răng' : 'Bình thường', i % 4 === 0 ? 3 : 1]);
}

export const makeSchoolXlsx = (students) => makeXlsx([{ name: 'Danh sách HS KSK', rows: [HEAD, ...students] }, { name: 'CSDL', rows: [] }]);
export const makeResultXlsx = (results) => makeXlsx([{ name: 'NHẬP', rows: [HEAD_RESULT, ...results] }]);
