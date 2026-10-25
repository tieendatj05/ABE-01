// Build giao diện + tiến trình chính + preload cho một "bản phát hành":
//   node app/desktop/build.mjs admin   -> có phần quản trị bảo mật (chỉ hiện trên máy đã kích hoạt làm trạm quản trị)
//   node app/desktop/build.mjs user    -> KHÔNG chứa mã quản trị (menu, cầu nối, xử lý IPC đều bị loại khỏi bản build)
import { existsSync, copyFileSync } from 'node:fs';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

const edition = process.argv[2] === 'user' ? 'user' : 'admin';
process.env.MEDABE_EDITION = edition;                       // vite.config.ts đọc biến này để định nghĩa __EDITION__ cho giao diện
await vite({ configFile: 'app/web/vite.config.ts', logLevel: 'warn' });
// Bản admin dùng logo riêng (màn chờ + thanh menu) nếu có, khác bản nhân viên.
if (edition === 'admin' && existsSync('app/web/public/ksk-logo-admin.png')) {
  copyFileSync('app/web/public/ksk-logo-admin.png', 'app/web/dist/ksk-logo.png');
}
for (const [entry, out] of [['app/desktop/main.ts', 'app/desktop/dist/main.cjs'], ['app/desktop/preload.ts', 'app/desktop/dist/preload.cjs']]) {
  await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: out, define: { __EDITION__: JSON.stringify(edition) }, minifySyntax: true, logLevel: 'warning' });
}
console.log(`Đã build bản "${edition}"`);
