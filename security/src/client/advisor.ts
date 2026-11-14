// TRỢ LÝ GỢI Ý VÙNG + KHOA CHO ẢNH (chạy TRÊN MÁY NGƯỜI NHẬP, TRƯỚC khi mã hoá).
//
// NGUYÊN TẮC (quan trọng):
//  1) Trợ lý CHỈ ĐỀ XUẤT. Người nhập duyệt/sửa trước khi lưu; chính sách ABE vẫn sinh từ DANH MỤC KHOA cố định (khoa lạ bị backend từ chối).
//     Trợ lý không bao giờ tự cấp quyền cho ai và không tự quyết định lưu.
//  2) Chạy cục bộ: ảnh chưa mã hoá không rời máy người nhập (không gọi máy chủ, không gọi dịch vụ AI bên ngoài).
//  3) KHÔNG phải mô hình học máy. Đây là BỘ LUẬT CỐ ĐỊNH cho các nguồn đã biết. Ảnh từ nguồn KHÔNG nhận ra => không đề xuất vùng nào,
//     mặc định CHỈ NGƯỜI NHẬP xem được (an toàn theo mặc định). Không có độ "tin cậy" giả: mỗi đề xuất ghi rõ căn cứ.
//  4) Luật hiện có: nguồn UPENN-GBM (MRI não, DICOM). Bộ này không kèm nhãn khoa => một đề xuất duy nhất: vùng có tín hiệu -> khoa Thần kinh.
//     Việc chia thêm vùng (mắt, xoang, hàm…) do người nhập khoanh tay; trợ lý không đoán giải phẫu.
import type { Rect, Rgba } from './imaging.js';
import type { DicomMeta } from './dicom.js';

export type AdvisorDecision = 'DE_XUAT' | 'CHI_TAC_GIA' | 'BO_QUA_LAT';
export interface ProposedRegion { rect: Rect; khoas: string[]; label: string; basis: string }
export interface Advice {
  decision: AdvisorDecision;
  /** Mã nguồn đã nhận ra (ví dụ 'UPENN-GBM') hoặc null. */
  source: string | null;
  regions: ProposedRegion[];
  /** Cảnh báo bảo mật/riêng tư người nhập phải xem. */
  warnings: string[];
  /** true = có dấu hiệu định danh THẬT trong tệp/ảnh: giao diện phải bắt người nhập xác nhận đã xem trước khi lưu. */
  needsAck: boolean;
  /** Giải thích ngắn vì sao có/không có đề xuất. */
  notes: string[];
  /** Tỉ lệ điểm ảnh có tín hiệu (0..1) — dùng để bỏ lát rỗng. */
  contentRatio: number;
}

/** Điểm ảnh "có tín hiệu": sáng hơn 8% thang xám (ảnh đã quy về xám 8 bit). */
const SIGNAL = 20;
const MIN_CONTENT = 0.02;

export function contentStats(px: Rgba): { ratio: number; bbox: Rect | null } {
  let minX = px.w, minY = px.h, maxX = -1, maxY = -1, cnt = 0;
  for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
    if (px.data[(y * px.w + x) * 4] > SIGNAL) { cnt++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (!cnt) return { ratio: 0, bbox: null };
  return { ratio: cnt / (px.w * px.h), bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

function pad(r: Rect, m: number, w: number, h: number): Rect {
  const x = Math.max(0, r.x - m), y = Math.max(0, r.y - m);
  return { x, y, w: Math.min(w, r.x + r.w + m) - x, h: Math.min(h, r.y + r.h + m) - y };
}

export function adviseImage(px: Rgba, dicom?: DicomMeta): Advice {
  const warnings: string[] = []; const notes: string[] = [];
  const { ratio, bbox } = contentStats(px);
  const needsAck = !!dicom && (dicom.hasIdentityTags || dicom.burnedInAnnotation);

  if (dicom) {
    if (dicom.hasIdentityTags) warnings.push('Tiêu đề DICOM của tệp này có vẻ chứa thông tin định danh (tên hoặc ngày sinh). Hệ thống CHỈ lưu điểm ảnh, không lưu tiêu đề; nhưng bạn nên dùng dữ liệu đã ẩn danh.');
    if (dicom.burnedInAnnotation) warnings.push('DICOM khai báo có chữ in trực tiếp lên ảnh (BurnedInAnnotation = YES). Chữ đó nằm trong điểm ảnh và sẽ được mã hoá cùng ảnh; hãy kiểm tra bằng mắt có tên/ngày sinh trên ảnh không.');
  } else {
    warnings.push('Ảnh PNG/JPEG không có tiêu đề để kiểm tra. Hãy tự xem ảnh có in tên, mã bệnh nhân hay ngày sinh không trước khi lưu.');
  }

  if (ratio < MIN_CONTENT) {
    notes.push(`Lát gần như rỗng (chỉ ${(ratio * 100).toFixed(1)}% điểm ảnh có tín hiệu): nên bỏ qua.`);
    return { decision: 'BO_QUA_LAT', source: null, regions: [], warnings, needsAck, notes, contentRatio: ratio };
  }

  const isUpenn = !!dicom && dicom.sourceId !== null && /^MR$/i.test(dicom.modality) && /BRAIN/i.test(dicom.bodyPart);
  if (!isUpenn || !bbox) {
    notes.push(dicom?.sourceId === null || !dicom
      ? 'Không nhận ra nguồn ảnh (không thuộc nguồn đã biết có luật gợi ý). Mặc định CHỈ NGƯỜI NHẬP xem được; bạn có thể tự khoanh vùng và gán khoa nếu cần.'
      : 'Nguồn nhận ra nhưng không phải MRI não: chưa có luật gợi ý. Mặc định CHỈ NGƯỜI NHẬP xem được.');
    return { decision: 'CHI_TAC_GIA', source: null, regions: [], warnings, needsAck, notes, contentRatio: ratio };
  }

  notes.push('Nguồn UPENN-GBM (MRI não, DICOM): luật cố định gán vùng có tín hiệu cho khoa Thần kinh. Bộ này không kèm nhãn mắt/xoang/hàm nên trợ lý không tự chia thêm vùng.');
  return {
    decision: 'DE_XUAT', source: 'UPENN-GBM',
    regions: [{
      rect: pad(bbox, 2, px.w, px.h), khoas: ['ThanKinh'], label: 'vung-co-tin-hieu (de xuat tu dong)',
      basis: 'Nguồn UPENN-GBM + MRI + BodyPart=BRAIN => khoa Thần kinh; khung = vùng có tín hiệu của lát này',
    }],
    warnings, needsAck, notes, contentRatio: ratio,
  };
}
