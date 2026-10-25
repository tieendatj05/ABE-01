/** Địa chỉ máy chủ có thể đổi khi chuyển Wi-Fi; không đổi danh tính thiết bị. */
export function storageUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/')
    throw new Error('Nhập địa chỉ máy chủ dạng http://IP:8090');
  return u.origin;
}
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export function nodeUrl(raw: string, storage: string): string {
  const base = new URL(storageUrl(storage));
  const u = new URL(raw, base);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Địa chỉ nút cấp khoá không hợp lệ');
  // localhost trong cấu hình máy chủ phải trỏ về máy chủ, không phải máy nhân viên.
  if (loopback(u.hostname)) u.hostname = base.hostname;
  return u.href.replace(/\/$/, '');
}
