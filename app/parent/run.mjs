// Mở ỨNG DỤNG PHỤ HUYNH như một cửa sổ riêng (kích thước điện thoại), độc lập với app nhập liệu.
//   npm run parent        (cần máy chủ đang chạy: npm run demo ; tự dựng giao diện nếu chưa có)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const PORT = Number(process.env.PARENT_PORT ?? 5174);
const DIST = resolve('app', 'parent', 'dist');
const up = async (u) => !!(await fetch(u, { signal: AbortSignal.timeout(1500) }).catch(() => null))?.ok;

if (!existsSync(join(DIST, 'index.html'))) execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'parent:build'], { stdio: 'inherit', shell: true });
if (!(await up('http://127.0.0.1:8090/api/epochs'))) console.log('Lưu ý: chưa thấy máy chủ ở cổng 8090. Hãy chạy "npm run demo" ở một cửa sổ khác để tra cứu được.');

if (!(await up(`http://127.0.0.1:${PORT}/`))) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  createServer((req, res) => {
    let p = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(DIST) || !existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    createReadStream(p).pipe(res);
  }).listen(PORT, '0.0.0.0');
}

const url = `http://localhost:${PORT}/`;
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe = browsers.find((b) => existsSync(b));
if (exe) spawn(exe, [`--app=${url}`, '--window-size=430,880'], { detached: true, stdio: 'ignore' }).unref();
else spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' }).unref();
console.log('Ứng dụng phụ huynh:', url, '(Ctrl+C để dừng nếu máy chủ giao diện do lệnh này bật)');
