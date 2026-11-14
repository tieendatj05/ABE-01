// Đưa app phụ huynh ra Internet bằng HTTPS và tạo TỜ QR + tin nhắn Zalo để phát cho phụ huynh (iPhone và Android đều dùng được).
//   npm run public:tunnel          (cần hệ thống đang chạy: npm run demo)
// Chỉ lộ ra: giao diện app + /api/public/* (chỉ đọc, dữ liệu đã mã hoá). KHÔNG lộ máy chủ nhân viên, /byt/* hay các nút cấp khoá.
//
// ĐỊA CHỈ CỐ ĐỊNH: ghi cấu hình vào launcher/public.config.json (xem public.config.example.json); từ đó mỗi lần chạy ra đúng link cũ.
//   { "mode": "external",         "url": "https://may-cua-ban.tailnet.ts.net" }   <- Tailscale Funnel / VPS / dịch vụ khác tự lo HTTPS
//   { "mode": "cloudflare-named", "tunnelName": "ksk", "url": "https://phuhuynh.ten-mien.vn" }   <- Cloudflare tunnel có tên + tên miền riêng
//   (không có file)                                                        <- tunnel tạm trycloudflare.com: link ĐỔI mỗi lần chạy
// Biến môi trường PARENT_URL / TUNNEL_NAME / EXTERNAL=1 vẫn dùng được và ưu tiên hơn file.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFlyer } from './qr-flyer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.MEDABE_PUBLIC_PORT ?? '8096';
const local = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(4000), cache: 'no-store' }); return r.ok ? r : null; } catch { return null; } };
const die = (m) => { console.error('\n' + m); process.exit(1); };

// 0) Cấu hình (tuỳ chọn).
const cfgFile = resolve(root, 'launcher', 'public.config.json');
let cfg = {};
if (existsSync(cfgFile)) { try { cfg = JSON.parse(readFileSync(cfgFile, 'utf8')); } catch (e) { die(`Không đọc được ${cfgFile}: ${e.message}`); } }
const external = process.env.EXTERNAL === '1' || cfg.mode === 'external';
const named = process.env.TUNNEL_NAME ?? (cfg.mode === 'cloudflare-named' ? cfg.tunnelName : undefined);
let url = String(process.env.PARENT_URL ?? cfg.url ?? '').replace(/\/+$/, '');
if (url && !/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) die('Địa chỉ phải bắt đầu bằng https:// (iOS/Android chặn HTTP ra Internet).');
if ((external || named) && !url) die('Chế độ này cần "url" (địa chỉ https cố định) trong launcher/public.config.json hoặc biến PARENT_URL.');

// 1) Cổng công khai phải đang chạy.
if (!(await get(`${local}/api/public/ping`))) die(`Chưa thấy cổng công khai ở ${local}.\nHãy chạy "npm run demo" (hoặc mở KSK) ở một cửa sổ khác rồi chạy lại.`);
if (!(await get(`${local}/`))?.headers.get('content-type')?.includes('text/html')) {
  console.warn('\nCảnh báo: cổng chưa phục vụ giao diện app. Hãy chạy "npm run parent:build" rồi khởi động lại "npm run demo".');
}

// 2) Mở đường hầm (trừ chế độ external: đã có dịch vụ khác lo HTTPS).
let child;
if (!external) {
  // winget cài cloudflared vào Program Files (x86), có thể chưa nằm trong PATH của cửa sổ này.
  const known = ['C:/Program Files (x86)/cloudflared/cloudflared.exe', 'C:/Program Files/cloudflared/cloudflared.exe'].find(existsSync);
  const args = named ? ['tunnel', 'run', named] : ['tunnel', '--no-autoupdate', '--url', local];
  child = spawn(known ?? 'cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', () => die('Chưa cài cloudflared. Cài bằng lệnh:  winget install --id Cloudflare.cloudflared'));
  child.on('exit', (c) => { console.error(`\ncloudflared đã dừng (mã ${c}).`); process.exit(c ?? 1); });
  if (!url) {
    url = await new Promise((resolveUrl) => {
      const on = (b) => { const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(b)); if (m) resolveUrl(m[0]); };
      child.stdout.on('data', on); child.stderr.on('data', on);
      setTimeout(() => resolveUrl(''), 45000);
    });
    if (!url) { child.kill(); die('Không lấy được địa chỉ từ cloudflared (kiểm tra kết nối Internet).'); }
  }
}
const stop = () => { child?.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

// 3) Kiểm tra TỪ NGOÀI VÀO: gọi chính địa chỉ công khai (đợi DNS lan truyền).
process.stdout.write(`\nĐang kiểm tra ${url} `);
let ok = false;
for (let i = 0; i < 40 && !ok; i++) { ok = !!(await get(`${url}/api/public/ping`)); if (!ok) { process.stdout.write('.'); await sleep(1500); } }
console.log(ok ? ' OK' : ' chưa thông (có thể DNS còn chậm — thử mở địa chỉ trên điện thoại sau ít phút)');

// 4) Tờ QR + tin nhắn Zalo + file ghi nhớ link (để sau này tìm lại).
const out = await writeFlyer(url);
mkdirSync(resolve(root, 'release'), { recursive: true });
writeFileSync(resolve(root, 'release', 'LINK-PhuHuynh.txt'), `${url}\n`);
const fixed = external || named;
console.log(`\nĐịa chỉ cho phụ huynh : ${url}`);
console.log(`Tờ QR (in hoặc chiếu)  : ${out}`);
console.log(`Tin nhắn mẫu cho Zalo  : ${resolve(root, 'release', 'TinNhan-Zalo.txt')}`);
console.log(fixed ? 'Địa chỉ CỐ ĐỊNH: lần sau chạy lại vẫn ra đúng link này.' : 'Lưu ý: địa chỉ này ĐỔI mỗi lần chạy (bản tạm miễn phí). Muốn cố định: xem "Link cố định" trong HUONG_DAN_APP_DIEN_THOAI.md');
console.log(external ? 'Giữ cửa sổ này mở hoặc đóng tuỳ ý; đường hầm do dịch vụ bên ngoài quản lý.' : 'Nhấn Ctrl+C để đóng đường hầm.');
if (!process.env.NO_OPEN) spawn('cmd', ['/c', 'start', '', out], { detached: true, stdio: 'ignore' }).unref();
if (!external) await new Promise(() => {});          // giữ tiến trình để đường hầm tiếp tục chạy (chế độ external: kết thúc tự nhiên)
