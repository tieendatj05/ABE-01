// Tên bệnh nhân hiển thị: dữ liệu demo cũ có đuôi " (gia)" trong họ tên. Bỏ đuôi đó CHỈ khi hiển thị (bản mã và chữ ký không đổi);
// hồ sơ tạo mới không còn đuôi. Gọi ngay sau khi giải mã để mọi màn hình (danh sách, tìm kiếm, phiếu) đều thấy tên đã gọn.
export const boGia = (s: string): string => s.replace(/\s*\((?:gia|giả)\)\s*$/i, '');

/** Trả về bản sao của kết quả giải mã với `data.hoTen` đã bỏ đuôi "(gia)"; giữ nguyên mọi trường khác (kể cả chữ ký) và giá trị null. */
export function sachTen<T>(o: T): T {
  const d = (o as { data?: unknown } | null)?.data as { hoTen?: unknown } | null | undefined;
  if (!o || !d || typeof d !== 'object' || typeof d.hoTen !== 'string') return o;
  const ten = boGia(d.hoTen);
  return ten === d.hoTen ? o : { ...o, data: { ...d, hoTen: ten } };
}
export const sachTenAll = <T>(list: T[]): T[] => list.map(sachTen);
