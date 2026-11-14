// Tự sinh Access Policy từ hồ sơ (profile) bản ghi - người dùng KHÔNG viết policy tay và không quản lý khoá.
// Mỗi MỤC của phiếu khám là một bản ghi mã hoá riêng có policy riêng: tiếp đón đọc được "Hành chính" nhưng KHÔNG đọc được
// "Khám lâm sàng"; bác sĩ chuyên khoa chỉ đọc phần của khoa mình; bác sĩ kết luận đọc tất cả để tổng hợp.
// Bản đồ này là nơi DUY NHẤT quyết định "ai được đọc loại dữ liệu nào".
import { versioned, type EpochDirectory } from '../common/epoch.js';

export const SECTION_TYPES = ['hanhchinh', 'lankham', 'tiensu', 'thecuc', 'lamsang', 'canlamsang', 'ketluan'] as const;
/** 'anh' (ảnh gốc, chỉ tác giả đọc) và 'vung' (một vùng ảnh có khoá riêng) chỉ dùng ở chế độ tài khoản; không thuộc SECTION_TYPES (không có nhóm/đơn vị). */
export type RecordType = (typeof SECTION_TYPES)[number] | 'anh' | 'vung';

export interface RecordProfile {
  type: RecordType;
  khoa: string;           // chuyên khoa của mục (lâm sàng/cận lâm sàng), vd "Nhi", "Mat", "TMH", "RHM"; mục chung dùng "KSK"
  patientIdx: string;     // chỉ mục mù của bệnh nhân
  authorDevice: string;   // deviceId của máy tạo bản ghi
  /** Bản ghi nhập LÔ dùng header chung: không có nhánh phá-vỡ-kính theo bệnh nhân (header chung không thể gắn thuộc tính của một bệnh nhân). */
  bulk?: boolean;
  /** Chế độ tài khoản: userId của TÁC GIẢ (backend gán). Thiếu = bản ghi cũ không biết tác giả theo tài khoản. */
  authorUserId?: string;
}

/** Mỗi phần tử là một nhánh OR gồm các thuộc tính AND (thuộc tính GỐC, chưa gắn epoch). */
export function policyBranches(p: RecordProfile): string[][] {
  return branches(p).filter((b) => b.length);
}

function branches(p: RecordProfile): string[][] {
  const author = ['MED:Device:' + p.authorDevice];           // người tạo luôn đọc lại được bản của mình trên máy của mình
  const bg = p.bulk ? [] : ['MED:BG:' + p.patientIdx];        // phá vỡ kính: chỉ có hiệu lực khi được kích hoạt
  const ketLuan = ['MED:Role:KetLuan'];                       // bác sĩ kết luận cần xem toàn bộ để tổng hợp
  const doctor = ['MED:Role:BacSi'];
  // Sở Y tế (cơ quan quản lý) đọc được mọi mục qua thuộc tính Org:SoYTe (admin cấp cho cán bộ Sở). Không phụ thuộc bệnh nhân nên lô nhập
  // vẫn dùng chung header. Phụ huynh KHÔNG dùng ABE (xem parent.ts).
  const all = (b: string[][]) => [...b, ['MED:Org:SoYTe']];
  switch (p.type) {
    case 'hanhchinh':
      // KHÔNG có nhánh phá-vỡ-kính theo bệnh nhân: mọi bác sĩ vốn đọc được mục hành chính, và nhờ vậy cả lô cùng chính sách dùng chung
      // một header ABE (nhập hàng nghìn hồ sơ chỉ tốn 1 phép ABE) - xem KeyHeader.
      return all([author, ['MED:Role:TiepDon'], doctor, ketLuan]);
    case 'lankham':
    case 'tiensu':
    case 'thecuc':
      return all([author, doctor, ketLuan, bg]);
    case 'lamsang':
      return all([author, ['MED:Role:BacSi', 'MED:Khoa:' + p.khoa], ketLuan, bg]);
    case 'canlamsang':
      return all([author, ['MED:Role:KTV', 'MED:Khoa:XetNghiem'], doctor, ketLuan, bg]);
    case 'ketluan':
      return all([author, ketLuan, doctor, bg]);
    default:
      throw new Error('Loại bản ghi không có chính sách ở chế độ thiết bị: ' + p.type);
  }
}

export function policyFor(p: RecordProfile, dir: EpochDirectory): string {
  return policyBranches(p)
    .map((and) => and.map((a) => versioned(a, dir)).join(' AND '))
    .map((b) => (b.includes(' AND ') ? `(${b})` : b))
    .join(' OR ');
}

/** Policy hiện có đã lỗi thời so với epoch hiện hành chưa (cần bọc lại)? */
export function isStale(currentPolicy: string, p: RecordProfile, dir: EpochDirectory): boolean {
  return currentPolicy !== policyFor(p, dir);
}
