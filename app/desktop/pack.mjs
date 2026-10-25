// Đóng gói thành ứng dụng Windows chạy độc lập: release/MedABE-win32-x64/MedABE.exe
// Chỉ đưa vào bản phát hành: tiến trình chính + preload + giao diện đã build (mọi thứ đã được bundle, không cần node_modules).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { packager } from '@electron/packager';

const stage = resolve('release', 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'desktop'), { recursive: true });
cpSync(resolve('app', 'desktop', 'dist'), join(stage, 'desktop', 'dist'), { recursive: true });
cpSync(resolve('app', 'web', 'dist'), join(stage, 'web', 'dist'), { recursive: true });
const edition = process.argv[2] === 'user' ? 'user' : 'admin';
if (edition === 'user') {
  // Địa chỉ máy chủ = máy quản trị (máy đóng gói này). Đổi bằng biến MEDABE_SERVER_URL khi đóng gói cho mạng khác.
  const url = process.env.MEDABE_SERVER_URL ?? 'http://localhost:8090'; // nhân viên tự dò máy chủ trong LAN, không đóng cứng IP Wi-Fi
  writeFileSync(join(stage, 'desktop', 'server-url.txt'), url + '\n');
  console.log('Bản nhân viên sẽ kết nối tới máy chủ:', url);
}
const appName = edition === 'user' ? 'KSK-NhanVien' : 'KSK';   // KSK = máy quản trị (chạy cả máy chủ nhúng); KSK-NhanVien = máy nhân viên khác
const root = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'medabe', productName: appName, version: root.version, description: root.description, main: 'desktop/dist/main.cjs' }, null, 2));

const electronVersion = JSON.parse(readFileSync(resolve('node_modules', 'electron', 'package.json'), 'utf8')).version;
const out = await packager({
  dir: stage, name: appName, platform: 'win32', arch: 'x64', out: resolve('release'), overwrite: true, electronVersion,
  prune: false, asar: true,
  // Bản admin mang theo máy chủ nhúng (Spring + nút cấp khoá + Java rút gọn) trong resources/server.
  ...(edition === 'admin' && existsSync(resolve('release', 'server-stage', 'server')) ? { extraResource: [resolve('release', 'server-stage', 'server')] } : {}),
  // Bản admin dùng icon riêng (launcher/ksk-admin.ico) nếu có, để phân biệt với bản nhân viên (launcher/ksk.ico).
  ...(() => {
    const adminIcon = resolve('launcher', 'ksk-admin.ico');
    const icon = edition === 'admin' && existsSync(adminIcon) ? adminIcon : resolve('launcher', 'ksk.ico');
    return existsSync(icon) ? { icon } : {};
  })(),
  // Bản phát hành KHÔNG bật MEDABE_TEST/MEDABE_DEBUG: không có DevTools, không có móc giả lập phần cứng.
});
rmSync(stage, { recursive: true, force: true });
rmSync(resolve('release', 'server-stage'), { recursive: true, force: true });
console.log('Đã đóng gói:', out.join(', '));
// Xuất bản app.asar để máy khác (đã kết nối) tự thấy có bản mới và tự tải khi mở lại app (UpdateBanner.tsx).
execFileSync(process.execPath, ['app/desktop/publish-update.mjs'], { stdio: 'inherit', windowsHide: true });
