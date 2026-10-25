// Cập nhật code của hai bản EXE có sẵn; giữ nguyên JRE, DB và khoá. Sao lưu ASAR trước khi thay.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackage } from '@electron/asar';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(root);
mkdirSync('.test-runs', { recursive: true });
const stage = mkdtempSync(resolve('.test-runs/package-'));
for (const [edition, name] of [['user', 'KSK-NhanVien'], ['admin', 'KSK']]) {
  const target = resolve('release', name + '-win32-x64', 'resources', 'app.asar');
  if (!target.startsWith(root + '\\') && !target.startsWith(root + '/')) throw new Error('Package path outside project');
  if (!existsSync(target)) throw new Error('Missing existing package: ' + target);
  execFileSync(process.execPath, ['app/desktop/build.mjs', edition], { cwd: root, stdio: 'inherit', windowsHide: true });
  const content = join(stage, edition, 'content'); mkdirSync(content, { recursive: true });
  cpSync('app/desktop/dist', join(content, 'desktop', 'dist'), { recursive: true });
  cpSync('app/web/dist', join(content, 'web', 'dist'), { recursive: true });
  if (edition === 'user') writeFileSync(join(content, 'desktop', 'server-url.txt'), 'http://localhost:8090\n');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  writeFileSync(join(content, 'package.json'), JSON.stringify({ name: 'medabe', productName: name, version: pkg.version, main: 'desktop/dist/main.cjs' }));
  const output = join(stage, edition, 'app.asar'); await createPackage(content, output);
  cpSync(target, join(stage, edition, 'previous.asar'));
  cpSync(output, target);
  console.log('Updated ' + name);
}
const server = resolve('release/KSK-win32-x64/resources/server');
const serverOutput = join(stage, 'server.mjs');
await build({ entryPoints: ['security/src/deploy/demo.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: serverOutput,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, logLevel: 'warning' });
cpSync(join(server, 'server.mjs'), join(stage, 'previous-server.mjs'));
cpSync(serverOutput, join(server, 'server.mjs'));
cpSync('security/storage/target/medabe-storage-0.1.0.jar', join(server, 'medabe-storage.jar'));
console.log('Updated embedded server; backups: ' + stage);

// Xuất bản app.asar vừa cập nhật để máy khác (đã kết nối) tự thấy có bản mới và tự tải khi mở lại app (UpdateBanner.tsx).
execFileSync(process.execPath, ['app/desktop/publish-update.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
