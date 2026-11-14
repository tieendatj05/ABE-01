// Nhớ "đang làm việc với bệnh nhân nào" giữa các màn hình (Quản lý hồ sơ ↔ Khám sức khỏe định kỳ) và qua những lần màn hình bị dựng lại
// (đổi trang, mất kết nối thoáng qua). Chỉ lưu SỐ ĐỊNH DANH trong bộ nhớ của tab (không ghi ra đĩa, mất khi tải lại trang hoặc đổi tài khoản/thiết bị);
// nội dung hồ sơ vẫn phải giải mã lại từ máy chủ, nên không làm lộ thêm gì.
let current: { who: string; cccd: string } | null = null;

export const focusPatient = {
  set(who: string, cccd?: string) { current = cccd ? { who, cccd } : null; },
  get(who: string): string { return current && current.who === who ? current.cccd : ''; },
  clear() { current = null; },
};
