// GẮN ẢNH GIẢ vào một số bệnh nhân (theo CCCD) trên MÁY CHỦ DEMO đang chạy (biểu tượng "KSK Demo (ban moi)"), để bạn demo chức năng ảnh theo vùng + mã hoá ABE.
//   npx tsx app/test-ui/anh-demo.ts                       -> 3 bệnh nhân giả (999000000101..103)
//   npx tsx app/test-ui/anh-demo.ts 079012345678 "tran thi binh"  -> gắn vào bệnh nhân bạn chỉ định: CCCD 12 số hoặc (một phần) họ tên; tên được tra trong hồ sơ hành chính đã có
// Ảnh là ảnh "đầu" GIẢ sinh bằng công thức (không phải ảnh y tế thật). Người nhập: nhaplieu01. Mỗi ảnh 4 vùng: Mắt / TMH / RHM / Nhi (nhu mô não);
// bệnh nhân thứ 2 có thêm một vùng thuộc HAI khoa (Mắt + TMH) và bệnh nhân thứ 3 là bộ 2 lát cắt.
import { cleanupDevices, loginDemo, resolvePatients } from './demo-util.js';
import { saveImage, type Rect } from '../../security/src/client/imaging.js';
import { HEAD, encodePng, makeHeadPhantom } from '../../security/src/research/fake-image.js';
import { LAM_SANG, MAU_NHANH, UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';

const given = process.argv.slice(2);                       // mỗi tham số: CCCD 12 số HOẶC (một phần) họ tên, không phân biệt hoa/thường/dấu
const args = given.length ? await resolvePatients(given) : [];
if (given.length && !args.length) { await cleanupDevices(); throw new Error('Không tìm được bệnh nhân nào theo tham số đã nhập'); }
const cccds = args.length ? args : ['999000000101', '999000000102', '999000000103'];

const c = await loginDemo('nhaplieu01');
// Bệnh nhân GIẢ (chỉ khi không chỉ định CCCD): thêm hồ sơ hành chính + lâm sàng từng khoa để demo Khám sức khỏe / hạn chế theo khoa.
if (!args.length) {
  const td = await loginDemo('tiepdon01');
  const names = ['Nguyen Van An (gia)', 'Tran Thi Binh (gia)', 'Le Minh Chau (gia)'];
  await td.saveMany(cccds.map((cccd, i) => ({ patientCode: cccd, type: 'hanhchinh' as const, khoa: 'KSK', group: UNITS[0].ma,
    data: { ...blank.hanhchinh(), hoTen: names[i], cccd, ngaySinh: `201${i}-0${i + 3}-1${i + 2}`, gioiTinh: i % 2 ? 'nu' : 'nam', lop: '9A', nguonChiTra: 'BHYT' } })));
  const mau: Record<string, string> = { Mat: 'Bình thường + cận thị', RHM: 'Bình thường + sâu răng' };
  for (const cccd of cccds) for (const k of LAM_SANG) await c.saveRecord({ patientCode: cccd, type: 'lamsang', khoa: k.khoa, data: MAU_NHANH[mau[k.khoa] ?? 'Bình thường'](k.muc) });
  console.log('✓ đã thêm hồ sơ hành chính + lâm sàng GIẢ (Nhi/Mắt/TMH/RHM) cho', cccds.length, 'bệnh nhân');
}
const R = (rect: Rect, khoas: string[], label: string) => ({ rect, khoas, label });
const base4 = [R(HEAD.mat, ['Mat'], 'hoc mat'), R(HEAD.tmh, ['TMH'], 'mui-xoang'), R(HEAD.rhm, ['RHM'], 'ham-rang'), R(HEAD.nao, ['Nhi'], 'nhu mo nao')];
for (const [i, cccd] of cccds.entries()) {
  const slices = i % 3 === 2 ? 2 : 1;
  const series = slices > 1 ? { id: crypto.randomUUID(), count: slices } : undefined;
  for (let s = 0; s < slices; s++) {
    const px = makeHeadPhantom(s + i);
    const regions = i % 3 === 1 ? [R(HEAD.mat, ['Mat', 'TMH'], 'vung 2 khoa (mat + tmh)'), R(HEAD.rhm, ['RHM'], 'ham-rang'), R(HEAD.nao, ['Nhi'], 'nhu mo nao')] : base4;
    const out = await saveImage(c, { patientCode: cccd, original: { mime: 'image/png', bytes: encodePng(px) }, pixels: px, modality: i % 2 ? 'MRI' : 'CT', regions, ...(series ? { series: { ...series, index: s } } : {}) });
    console.log(`✓ CCCD ${cccd}: ảnh ${out.imageId.slice(0, 8)}… ${slices > 1 ? `(lát ${s + 1}/${slices}) ` : ''}— ${regions.length} vùng, mỗi vùng một khoá ABE riêng`);
  }
}
await cleanupDevices();
console.log('\nXong. Mở app (http://localhost:5180) → đăng nhập bác sĩ → "Ảnh CT/MRI" → nhập CCCD ở trên → xem. Chạy "npx tsx app/test-ui/anh-ma-hoa.ts <CCCD>" để xem ảnh được mã hoá ABE thế nào.');
