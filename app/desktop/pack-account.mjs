// Đóng gói bản NÂNG CẤP có đăng nhập tài khoản vào thư mục RIÊNG (không đè bản đang chạy, không xuất bản cập nhật lên máy chủ đang chạy):
//   npm run desktop:pack:account                 → release/KSK-TaiKhoan-win32-x64 (ADMIN + máy chủ nhúng) và release/KSK-NhanVien-TaiKhoan-win32-x64 (nhân viên)
//   MEDABE_SERVER_URL=http://192.168.1.10:8090 npm run desktop:pack:account   (địa chỉ máy chủ đóng gói sẵn cho bản nhân viên; mặc định http://localhost:8090)
// Bản admin dùng CÙNG thư mục dữ liệu máy chủ như KSK cũ (%APPDATA%\KSK\server-data) và, lần đầu bật tài khoản, sao lưu CSDL sang db-truoc-khi-bat-tai-khoan/.
// Phải ĐÓNG KSK.exe cũ trước khi mở bản admin mới (cùng cổng 8090).
import { execFileSync } from 'node:child_process';
const run = (args, extra) => execFileSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, MEDABE_NO_PUBLISH: '1', ...extra } });
// 1) ADMIN: máy chủ nhúng (jar + jre) + giao diện admin
run(['app/desktop/build-server.mjs']);
run(['app/desktop/build.mjs', 'admin']);
run(['app/desktop/pack.mjs', 'admin'], { MEDABE_APP_NAME: 'KSK-TaiKhoan' });
// 2) NHÂN VIÊN
run(['app/desktop/build.mjs', 'user']);
run(['app/desktop/pack.mjs', 'user'], { MEDABE_APP_NAME: 'KSK-NhanVien-TaiKhoan', MEDABE_SERVER_URL: process.env.MEDABE_SERVER_URL ?? 'http://localhost:8090' });
