// Sao chép app.asar vừa đóng gói vào thư mục "app-updates" của máy chủ đang chạy, để máy khác (đã kết nối) thấy có bản mới và
// tự tải về khi mở lại app (xem UpdateBanner.tsx + AppUpdateController.java). Không báo lỗi nếu chưa có máy chủ nào ở các vị trí quen thuộc -
// tính năng tự cập nhật chỉ là tiện ích thêm, không bắt buộc để các lệnh đóng gói khác chạy được.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const asarOf = (name) => resolve('release', name, 'resources', 'app.asar');
const sources = { admin: asarOf('KSK-win32-x64'), user: asarOf('KSK-NhanVien-win32-x64') };

// Các nơi dữ liệu máy chủ có thể đang nằm trên MÁY NÀY (đóng gói nhúng, hoặc chạy thử từ mã nguồn).
const candidates = [
  process.env.APPDATA ? join(process.env.APPDATA, 'KSK', 'server-data') : null,
  resolve(process.env.DATA_DIR ?? 'data-demo'),
].filter(Boolean);

let published = 0;
for (const dataDir of candidates) {
  if (!existsSync(dataDir)) continue;
  const out = join(dataDir, 'app-updates');
  mkdirSync(out, { recursive: true });
  for (const [edition, src] of Object.entries(sources)) {
    if (!existsSync(src)) continue;
    copyFileSync(src, join(out, edition + '.asar'));
    published++;
  }
  console.log(`Đã xuất bản cập nhật vào ${out}`);
}
if (!published) console.log('Chưa thấy thư mục dữ liệu máy chủ nào trên máy này - bỏ qua xuất bản cập nhật (không ảnh hưởng các bước khác).');
