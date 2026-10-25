// Liên thông Bộ Y tế (cổng mô phỏng): phần dùng chung cho các màn hình. Trạng thái "Đã liên thông" lấy từ BIÊN NHẬN có chữ ký của cổng,
// không còn là cờ tự đặt trong hồ sơ: bản ghi mới (hoặc sửa sau khi gửi) chưa có biên nhận nên tự động quay về "Chưa liên thông".
import { SECTION_TYPES, type MedClient, type Receipt, type RecordRow } from '../../../security/src/index.js';

export type ReceiptMap = Map<string, Receipt>;

/** Hỏi cổng bản ghi nào đã có biên nhận hợp lệ. Cổng tắt/không kết nối: trả về lỗi để giao diện báo, không làm hỏng màn hình. */
export async function fetchReceipts(c: MedClient, ids: string[]): Promise<{ map: ReceiptMap; error: string }> {
  if (!ids.length) return { map: new Map(), error: '' };
  try { return { map: await c.bytStatus(ids), error: '' }; }
  catch (e) { return { map: new Map(), error: (e as Error).message }; }
}

/**
 * Gửi toàn bộ phiếu khám (mọi mục, bản mới nhất của mỗi bệnh nhân) của các bệnh nhân đã chọn trong một đơn vị.
 * Nội dung gửi đi là bản ĐÃ MÃ HOÁ; cổng chỉ nhận ciphertext + header ABE.
 */
export async function submitPatients(c: MedClient, unit: string, patients: Set<string>, onProgress?: (done: number, total: number) => void): Promise<{ sent: number; rejected: number; receipts: ReceiptMap; ma: string; firstError?: string }> {
  const { facilities } = await c.bytInfo();
  if (!facilities.length) throw new Error('Cổng chưa có mã cơ sở khám (facilities.json)');
  const ma = facilities[0].ma;
  const rows: RecordRow[] = [];
  for (const type of SECTION_TYPES) rows.push(...(await c.listGroup(unit, type)).filter((r) => patients.has(r.patientIdx)));
  const { receipts, rejected } = await c.bytSubmit(rows, ma, onProgress);
  return { sent: rows.length, rejected: rejected.length, receipts, ma, firstError: rejected[0]?.error };
}

/**
 * Liên thông NGAY một bệnh nhân (gọi sau khi Lưu một mục khám, không chờ thao tác riêng ở Quản lý hồ sơ): lấy TOÀN BỘ bản ghi hiện có
 * của người đó rồi gửi lên cổng - không chỉ mục vừa sửa, vì cổng cần đủ bộ hồ sơ để Bộ Y tế đọc được trọn vẹn.
 */
export async function submitPatient(c: MedClient, patientCode: string, maHint?: string): Promise<{ receipts: ReceiptMap; rejected: number; ma: string }> {
  let ma = maHint;
  if (!ma) {
    const { facilities } = await c.bytInfo();
    if (!facilities.length) throw new Error('Cổng chưa có mã cơ sở khám (facilities.json)');
    ma = facilities[0].ma;
  }
  // listRecords trả về MỌI phiên bản đã từng lưu (mỗi lần Lưu tạo bản ghi mới); chỉ gửi bản MỚI NHẤT của mỗi (loại mục, khoa).
  const all = await c.listRecords(patientCode);
  const latest = new Map<string, RecordRow>();
  for (const r of all) { const k = `${r.type}|${r.khoa}`; const p = latest.get(k); if (!p || r.createdAt >= p.createdAt) latest.set(k, r); }
  const { receipts, rejected } = await c.bytSubmit([...latest.values()], ma);
  return { receipts, rejected: rejected.length, ma };
}

/**
 * Dò toàn bộ đơn vị tìm những học sinh ĐÃ CÓ ít nhất một mục khám (không chỉ hành chính, ví dụ Khám thể lực) nhưng CHƯA liên thông -
 * việc này xảy ra khi mục khám được lưu từ trước lúc có tính năng tự động liên thông. Liên thông từng người MỘT (không dồn thành một
 * lệnh lớn) để số đếm "Chưa liên thông"/"Đã liên thông" nhảy liên tục trong lúc chạy, không phải đợi xong hết mới cập nhật.
 */
export async function backfillLienThong(
  c: MedClient, unit: string, rows: { rec: RecordRow; cccd: string }[], already: ReceiptMap,
  onProgress?: (done: number, total: number, receipts: ReceiptMap) => void,
): Promise<{ total: number; ok: number }> {
  const types = SECTION_TYPES.filter((t) => t !== 'hanhchinh');
  const groups = await Promise.all(types.map((t) => c.listGroup(unit, t).catch(() => [] as RecordRow[])));
  const withExam = new Set(groups.flat().map((r) => r.patientIdx));
  const candidates = rows.filter((r) => withExam.has(r.rec.patientIdx) && !already.has(r.rec.id));
  if (!candidates.length) return { total: 0, ok: 0 };
  const { facilities } = await c.bytInfo();
  if (!facilities.length) throw new Error('Cổng chưa có mã cơ sở khám (facilities.json)');
  const ma = facilities[0].ma;
  let ok = 0;
  for (let i = 0; i < candidates.length; i++) {
    try {
      const out = await submitPatient(c, candidates[i].cccd, ma);
      already = new Map([...already, ...out.receipts]);
      ok++;
    } catch { /* bỏ qua người này, tiếp tục các người còn lại */ }
    onProgress?.(i + 1, candidates.length, already);
  }
  return { total: candidates.length, ok };
}

export const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('vi-VN'); };
export const receiptText = (r?: Receipt) => (r ? `Đã liên thông · ${r.receiptId} · cơ sở ${r.maCskcb} · ${when(r.receivedAt)}` : 'Chưa liên thông');
