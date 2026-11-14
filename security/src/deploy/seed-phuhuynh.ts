// Tạo học sinh MẪU (dữ liệu giả) trong hệ thống đang chạy rồi liên thông lên cổng, để thử app phụ huynh.
//   npm run demo          (cửa sổ khác)
//   npm run seed:phuhuynh  -> in ra họ tên + CCCD để đăng nhập trên điện thoại
// Dùng đúng đường của máy nhân viên: đăng ký tự do → mã hoá ABE trên máy này → lưu → tự liên thông (bản mã hoá + khoá bọc cho phụ huynh).
import { MedClient } from '../client/medclient.js';
import { loadOrCreateDeviceKeys, MemoryKeyStore } from '../client/device.js';
import type { RecordRow } from '../client/medclient.js';

const BASE = (process.env.MEDABE_BASE ?? 'http://localhost:8090').replace(/\/+$/, '');
const NAME = 'Nguyễn Minh Khang', CCCD = '079213004512', GROUP = 'TRUONG-MAU';

const ls = (kq: string, loai = '1') => ({ kq, loai });
const SAMPLE: { type: 'hanhchinh' | 'lankham' | 'tiensu' | 'thecuc' | 'lamsang' | 'canlamsang' | 'ketluan'; khoa: string; data: unknown }[] = [
  { type: 'hanhchinh', khoa: 'KSK', data: { hoTen: NAME, lop: '6A1', gioiTinh: 'nam', ngaySinh: '2013-05-12', cccd: CCCD, tinh: 'TP. Hồ Chí Minh', phuongXa: 'Phường Linh Xuân', diaChi: '12 Đường số 5', giamHo: { hoTen: 'Nguyễn Văn Hùng', quanHe: 'Cha', cccd: '', dienThoai: '' }, trangThai: 'da' } },
  { type: 'lankham', khoa: 'KSK', data: { ngayKham: new Date().toISOString().slice(0, 10), lyDo: 'Khám sức khỏe định kỳ', ghiChu: 'Dữ liệu mẫu để thử ứng dụng.' } },
  { type: 'tiensu', khoa: 'KSK', data: { co: ['Dị ứng', 'Cận thị / tật khúc xạ'], ghiChu: 'Dị ứng hải sản.' } },
  { type: 'thecuc', khoa: 'KSK', data: { chieuCao: '152', canNang: '41.5', mach: '82', huyetApTT: '105', huyetApTTr: '68', nhipTho: '20', nhietDo: '36.7', loai: 2 } },
  { type: 'lamsang', khoa: 'Nhi', data: { 'Tuần hoàn': ls('Bình thường'), 'Hô hấp': ls('Bình thường'), 'Tiêu hoá': ls('Bình thường'), 'Thần kinh': ls('Bình thường') } },
  { type: 'lamsang', khoa: 'Mat', data: { 'Mắt phải không kính': ls('7/10', '3'), 'Mắt trái không kính': ls('8/10', '2'), 'Bệnh lý mắt': ls('Cận thị nhẹ', '3') } },
  { type: 'lamsang', khoa: 'TMH', data: { 'Tai trái (nói thường)': ls('5'), 'Tai phải (nói thường)': ls('5'), 'Các bệnh TMH': ls('Viêm họng nhẹ', '2') } },
  { type: 'lamsang', khoa: 'RHM', data: { 'Hàm trên': ls('Sâu răng 2 chiếc', '3'), 'Hàm dưới': ls('Sức nhai 100%') } },
  { type: 'canlamsang', khoa: 'XetNghiem', data: { gioiTinh: 'nam', kq: { H01: '5.0', H02: '122', H04: '88', H13: '275', H17: '7', S01: '7.6' } } },
  { type: 'ketluan', khoa: 'KSK', data: { loai: 2, ngay: new Date().toISOString().slice(0, 10), chanDoan: [['H52.1', 'Cận thị'], ['K02.1', 'Sâu răng ngà']], ketLuan: 'Sức khỏe tốt. Cận thị nhẹ, sâu răng cần điều trị.\nĐề nghị khám mắt định kỳ 6 tháng và đưa em đi điều trị răng.' } },
];

const dk = await loadOrCreateDeviceKeys(new MemoryKeyStore());
console.log(`Đăng ký máy mẫu với ${BASE} (đăng ký tự do)…`);
const c = await MedClient.registerOpen(BASE, 'May mau phu huynh', dk);
for (const s of SAMPLE) await c.saveRecord({ patientCode: CCCD, type: s.type, khoa: s.khoa, data: s.data, group: s.type === 'hanhchinh' ? GROUP : undefined, name: NAME });
const latest = new Map<string, RecordRow>();
for (const r of await c.listRecords(CCCD)) { const k = `${r.type}|${r.khoa}`; const p = latest.get(k); if (!p || r.createdAt >= p.createdAt) latest.set(k, r); }
const { facilities } = await c.bytInfo();
const sent = await c.bytSubmit([...latest.values()], facilities[0].ma);
console.log(`Đã lưu ${SAMPLE.length} mục và liên thông ${sent.receipts.size} bản ghi (rejected: ${sent.rejected.length}).`);
console.log(`\nĐăng nhập thử trong app:\n  Họ tên : ${NAME}\n  CCCD   : ${CCCD}\n`);
process.exit(sent.rejected.length ? 1 : 0);
