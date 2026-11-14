// Dựng giao diện app phụ huynh cho bản cài trên điện thoại rồi (tuỳ chọn) đồng bộ vào dự án Android/iOS.
//   set PARENT_URL=https://ten-mien-cua-ban.trycloudflare.com   (địa chỉ cổng công khai; xem HUONG_DAN_APP_DIEN_THOAI.md)
//   npm run mobile:sync          (từ thư mục gốc dự án)
// Địa chỉ được "đóng" sẵn vào app để phụ huynh KHÔNG phải gõ; vẫn đổi được trong Cài đặt.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..', '..');
const url = (process.env.PARENT_URL ?? '').replace(/\/+$/, '');
if (!url) console.warn('Lưu ý: chưa đặt PARENT_URL — app sẽ yêu cầu nhập địa chỉ máy chủ trong Cài đặt ở lần đầu.');
else if (!/^https:\/\//.test(url)) console.warn('Cảnh báo: PARENT_URL không phải https:// — iOS/Android sẽ chặn kết nối HTTP ra Internet.');

const run = (cmd, args, cwd, env = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npx', ['vite', 'build', '--config', 'app/parent/vite.config.ts', '--outDir', 'dist-mobile'], root, { VITE_DEFAULT_BASE: url });
if (process.argv.includes('--sync')) run('npx', ['cap', 'sync'], here);
