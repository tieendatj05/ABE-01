// Đóng gói ứng dụng PHỤ HUYNH cho máy tính: release/KSK-PhuHuynh-win32-x64/KSK-PhuHuynh.exe
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { packager } from '@electron/packager';

await vite({ configFile: 'app/parent/vite.config.ts', logLevel: 'warn' });
const stage = resolve('release', 'stage-parent');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'desktop', 'dist'), { recursive: true });
await esbuild({ entryPoints: ['app/desktop/parent-main.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(stage, 'desktop', 'dist', 'main.cjs'), logLevel: 'warning' });
cpSync(resolve('app', 'parent', 'dist'), join(stage, 'parent', 'dist'), { recursive: true });
const root = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'ksk-phuhuynh', productName: 'KSK-PhuHuynh', version: root.version, main: 'desktop/dist/main.cjs' }, null, 2));
const electronVersion = JSON.parse(readFileSync(resolve('node_modules', 'electron', 'package.json'), 'utf8')).version;
const ico = resolve('launcher', 'phuhuynh.ico');
const out = await packager({ dir: stage, name: 'KSK-PhuHuynh', platform: 'win32', arch: 'x64', out: resolve('release'), overwrite: true, electronVersion, prune: false, asar: true, ...(existsSync(ico) ? { icon: ico } : {}) });
rmSync(stage, { recursive: true, force: true });
console.log('Đã đóng gói:', out.join(', '));
