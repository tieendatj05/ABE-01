import { describe, expect, it } from 'vitest';
import { mapHeader, mapResultHeader, norm, parseDate, rowsToHanhChinh, rowsToResults, type Row } from './excel.js';

// Tiêu đề giống file nhập thực tế (có cột trống xen kẽ), dữ liệu hoàn toàn GIẢ.
const HEAD: Row = ['STT', 'LỚP', 'Họ tên', 'Giới tính', '', 'Ngày sinh', 'Dân tộc', '', 'Số CMND/CCCD/Mã định danh', '', 'Ngày cấp Số CCCD', 'Nơi cấp Số CCCD',
  'Họ và tên bố, mẹ hoặc người giám hộ', 'Mã định danh (CCCD) của bố, mẹ hoặc người giám hộ', 'Tỉnh/Thành phố nơi ở hiện tại*', '', 'Xã/Phường nơi ở hiện tại*', '', 'Nơi ở hiện tại',
  'Nhóm máu', 'Đối tượng khám định kỳ', '', 'Điện thoại'];
const ROW: Row = [1, '6A1', 'Nguyễn Văn Giả', 'Nam', null, '15/03/2012', 'Kinh', null, '079012000001', null, '01/02/2022', 'Cục Cảnh sát', 'Nguyễn Văn Cha', '079080000002', 'TP. Đồng Nai', null, 'Phường X', null, '12 đường Y', null, 'Học sinh', null, '0901000001'];

describe('nhập Excel', () => {
  it('nhận đúng cột theo tên tiêu đề dù có cột trống xen kẽ; phân biệt CCCD của học sinh và của người giám hộ', () => {
    const m = mapHeader([['Danh sách'], HEAD, ROW])!;
    expect(m.headerRow).toBe(1);
    expect(m.missing).toEqual([]);
    expect(m.cols.cccd).toBe(8);          // "Số CMND/CCCD/Mã định danh"
    expect(m.cols['gh.cccd']).toBe(13);   // "Mã định danh (CCCD) của bố, mẹ ..."
    expect(m.cols['gh.hoTen']).toBe(12);
    expect(m.cols.ngayCap).toBe(10);
    expect(m.cols.noiCap).toBe(11);
  });

  it('đổi dòng dữ liệu sang mục Hành chính: ngày dd/mm/yyyy -> ISO, giới tính, họ tên in hoa, bỏ dòng trống', () => {
    const m = mapHeader([HEAD, ROW])!;
    const out = rowsToHanhChinh([HEAD, ROW, [], [null, null]], m, { nguonChiTra: 'Nhà trường / Doanh nghiệp' });
    expect(out).toHaveLength(1);
    expect(out[0].lop).toBe('6A1');
    expect(out[0].data).toMatchObject({
      hoTen: 'NGUYỄN VĂN GIẢ', gioiTinh: 'nam', ngaySinh: '2012-03-15', cccd: '079012000001', ngayCap: '2022-02-01',
      dienThoai: '0901000001', tinh: 'TP. Đồng Nai', nguonChiTra: 'Nhà trường / Doanh nghiệp',
    });
    expect(out[0].data.giamHo).toMatchObject({ hoTen: 'Nguyễn Văn Cha', cccd: '079080000002' });
  });

  it('chịu được ô kiểu số/ngày của Excel và ngày không hợp lệ', () => {
    expect(parseDate('31/02/2012')).toBe('');                          // không có ngày 31/2
    expect(parseDate('5/3/2012')).toBe('2012-03-05');
    expect(parseDate(new Date(Date.UTC(2012, 2, 15)))).toBe('2012-03-15');
    expect(parseDate(40983)).toBe('2012-03-15');                       // số serial Excel
    expect(parseDate('abc')).toBe('');
    const m = mapHeader([HEAD, ROW])!;
    const r2: Row = [...ROW]; r2[22] = 901000001; r2[8] = 79012000001; r2[3] = 'Nữ';       // CCCD bị Excel đổi thành số
    const d = rowsToHanhChinh([HEAD, r2], m, { nguonChiTra: 'x' })[0].data;
    expect(d.dienThoai).toBe('0901000001');
    expect(d.cccd).toBe('079012000001');
    expect(d.gioiTinh).toBe('nu');
  });

  it('không tìm thấy tiêu đề thì trả null', () => {
    expect(mapHeader([['a', 'b'], [1, 2]])).toBeNull();
    expect(norm('Họ và tên bố, mẹ')).toBe('ho va ten bo, me');
  });
});

describe('nhập kết quả khám (Thêm xét nghiệm)', () => {
  const RH: Row = [...HEAD, 'CHIỀU CAO (CM)', 'CÂN NẶNG (KG)', 'BMI', 'KẾT LUẬN BMI', 'MẠCH', 'HUYẾT ÁP', 'NHI', 'MẮT PHẢI KHÔNG KÍNH', 'MẮT TRÁI KHÔNG KÍNH', 'MẮT PHẢI CÓ KÍNH', 'MẮT TRÁI CÓ KÍNH', 'BỆNH LÝ MẮT', 'TAI MŨI HỌNG', 'RĂNG HÀM MẶT', 'PHÂN LOẠI'];
  const RR: Row = [...ROW, 160, 50, '', '', 80, '110/70', 'Bình thường', '7/10', '10/10', null, null, 'Cận thị', 'Bình thường', 'Sâu răng', 3];

  it('nhận các cột kết quả và đổi sang thể lực / lâm sàng từng khoa / kết luận', () => {
    const m = mapResultHeader([RH, RR])!;
    expect(m.cols.cccd).toBe(8);
    const [r] = rowsToResults([RH, RR], m);
    expect(r.cccd).toBe('079012000001');
    expect(r.thecuc).toMatchObject({ chieuCao: '160', canNang: '50', mach: '80', huyetApTT: '110', huyetApTTr: '70' });
    expect(r.lamsang.Mat?.['Bệnh lý mắt']).toEqual({ kq: 'Cận thị', loai: '3' });      // mục bất thường mang phân loại tổng
    expect(r.lamsang.Mat?.['Mắt trái không kính']).toEqual({ kq: '10/10', loai: '1' }); // mục bình thường luôn loại 1
    expect(r.lamsang.RHM?.['Các bệnh RHM']).toEqual({ kq: 'Sâu răng', loai: '3' });
    expect(r.lamsang.Nhi?.['Tuần hoàn']).toEqual({ kq: 'Bình thường', loai: '1' });
    expect(r.ketluan?.loai).toBe(3);
  });

  it('sheet chỉ có tiêu đề (không có dòng dữ liệu) cho ra 0 dòng', () => {
    expect(rowsToResults([RH], mapResultHeader([RH])!)).toHaveLength(0);
  });

  it('file chỉ có CCCD + Chiều cao + Cân nặng (3 cột) vẫn nhận được; dấu phẩy thập phân được đổi thành dấu chấm', () => {
    const head: Row = ['STT', 'Số CCCD', 'Chiều cao (cm)', 'Cân nặng (kg)'];
    const m = mapResultHeader([head, [1, '079012000001', '150,5', 42]])!;
    expect(m).not.toBeNull();
    const [r] = rowsToResults([head, [1, '079012000001', '150,5', 42]], m);
    expect(r.cccd).toBe('079012000001');
    expect(r.thecuc).toMatchObject({ chieuCao: '150.5', canNang: '42' });
  });
});
