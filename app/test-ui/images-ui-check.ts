// KIỂM TRA GIAO DIỆN ẢNH THEO VÙNG trong APP NHÂN VIÊN THẬT (Edge/Chrome, hệ thống thật): người nhập tải ảnh giả, khoanh 2 vùng bằng chuột, gán khoa, lưu;
// rồi bác sĩ Mắt / bác sĩ Nhi đăng nhập (mỗi người một phiên trình duyệt riêng) và CHỈ thấy vùng của khoa mình — kiểm bằng điểm ảnh THẬT trên canvas.
// Cần: npm run web:build + jar Spring.     npx tsx app/test-ui/images-ui-check.ts
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';
import { PHANTOM, encodePng, makePhantom } from '../../security/src/research/fake-image.js';

const dist = resolve('app/web/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run web:build');
const shots = resolve('.test-runs/images-ui');
mkdirSync(shots, { recursive: true });
const png = join(shots, 'anh-gia.png');
writeFileSync(png, encodePng(makePhantom(0)));
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const CCCD = '999000000321';

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const web = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const f = join(dist, p === '/' ? 'index.html' : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}).listen(5198, '127.0.0.1');
const spki = createHash('sha256').update(new X509Certificate(readFileSync(join(stack.tlsDir, 'server.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${spki}`] });
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

async function session(user: string) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 1000 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 300)); });
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string) => page.evaluate((s, l) => (Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click(), sel, label);
  await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
  await page.type('input[autocomplete="username"]', user); await page.type('input[autocomplete="current-password"]', pw(user));
  await clickText('button', 'Đăng nhập');
  await waitText('Ảnh CT/MRI');
  // App bỏ qua điều hướng khi chưa 'đã kết nối': nhấp lại tới khi trang ảnh mở (tránh chạy đua với bước kết nối ban đầu).
  for (let i = 0; ; i++) {
    await clickText('a', 'Ảnh CT/MRI');
    try { await waitText('Ảnh CT/MRI theo vùng', 8_000); break; }
    catch (e) { if (i >= 6) { console.log('--- nội dung trang khi lỗi:', (await page.evaluate(() => document.body.innerText)).slice(0, 700)); throw e; } }
  }
  return { ctx, page, waitText, clickText };
}
/** Đọc điểm ảnh THẬT từ canvas kết quả đầu tiên (class imgcanvas). */
const readCanvas = (page: import('puppeteer-core').Page) => page.evaluate(() => {
  const cv = document.querySelector('canvas.imgcanvas') as HTMLCanvasElement | null;
  if (!cv) return null;
  const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
  let blue = 0, red = 0, green = 0, other = 0;
  for (let i = 0; i < d.data.length; i += 4) {
    const [r, g, b, a] = [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]];
    if (!a) continue;
    if (r === 0 && g === 0 && b === 255) blue++; else if (r === 255 && g === 0 && b === 0) red++; else if (r === 0 && g === 200 && b === 0) green++; else other++;
  }
  return { w: cv.width, h: cv.height, blue, red, green, other };
});

try {
  // 1) Người nhập tải ảnh, khoanh 2 vùng bằng CHUỘT, gán khoa, lưu
  const nl = await session('nhaplieu01');
  await nl.page.type('input[placeholder^="Họ tên hoặc số CCCD"]', CCCD);
  const fileInput = await nl.page.$('input[type=file]');
  await fileInput!.uploadFile(png);
  await nl.page.waitForFunction(() => document.querySelectorAll('canvas').length > 0 && /Kéo chuột/.test(document.body.innerText), { timeout: 30_000 });
  const box = (await (await nl.page.$('section canvas:not(.imgcanvas)'))!.boundingBox())!;
  const scale = box.width / PHANTOM.w;
  const drag = async (r: { x: number; y: number; w: number; h: number }) => {
    await nl.page.mouse.move(box.x + r.x * scale, box.y + r.y * scale); await nl.page.mouse.down();
    await nl.page.mouse.move(box.x + (r.x + r.w / 2) * scale, box.y + (r.y + r.h / 2) * scale); await nl.page.mouse.move(box.x + (r.x + r.w) * scale, box.y + (r.y + r.h) * scale); await nl.page.mouse.up();
  };
  await drag(PHANTOM.mat); await drag(PHANTOM.nhiTmh);
  await nl.page.waitForFunction(() => /Vùng 2/.test(document.body.innerText), { timeout: 10_000 });
  console.log('   các vùng đã khoanh:', await nl.page.evaluate(() => (document.body.innerText.match(/Vùng \d \(\d+x\d+\)/g) ?? []).join(' · ')), '— mong đợi 32x24 mỗi vùng');
  const tick = (vung: number, label: string) => nl.page.evaluate((v, l) => {
    const row = Array.from(document.querySelectorAll('.row')).filter((r) => /^Vùng \d/.test(r.textContent ?? ''))[v];
    (Array.from(row.querySelectorAll('label')).find((x) => x.textContent?.trim() === l)!.querySelector('input') as HTMLInputElement).click();
  }, vung, label);
  await tick(0, 'Mắt'); await tick(1, 'Nhi'); await tick(1, 'Tai - Mũi - Họng');
  await nl.page.screenshot({ path: join(shots, '1-nguoi-nhap-khoanh-vung.png') });
  await nl.clickText('button', 'Mã hoá và lưu');
  await nl.waitText('Đã lưu ảnh với 2 vùng');
  check('người nhập khoanh 2 vùng bằng chuột, gán khoa (Mắt / Nhi+TMH) và lưu', true);
  await nl.waitText('Ảnh bạn được phép xem (1)');
  const own = await readCanvas(nl.page);
  check('người nhập thấy ảnh ghép của CẢ HAI vùng + nhãn ảnh gốc đầy đủ', !!own && own.blue > 0 && own.red > 0 && /Ảnh gốc đầy đủ/.test(await nl.page.evaluate(() => document.body.innerText)), JSON.stringify(own));
  await nl.page.screenshot({ path: join(shots, '2-nguoi-nhap-xem.png') });

  // 2) Bác sĩ Mắt: CHỈ vùng xanh dương
  const mat = await session('bsmat01');
  await mat.page.type('input[placeholder^="Họ tên hoặc số CCCD"]', CCCD); await mat.clickText('button', 'Tra cứu ảnh');
  await mat.waitText('Ảnh bạn được phép xem (1)');
  const m = await readCanvas(mat.page);
  const mt = await mat.page.evaluate(() => document.body.innerText);
  check('bác sĩ Mắt: canvas chỉ có điểm ảnh vùng Mắt (xanh dương), KHÔNG có đỏ/xanh lá/ảnh nền', !!m && m.blue === PHANTOM.mat.w * PHANTOM.mat.h && m.red === 0 && m.green === 0 && m.other === 0, JSON.stringify(m));
  check('bác sĩ Mắt thấy nhãn "bản hiển thị đã GIỚI HẠN" và không có nút/ảnh gốc', /GIỚI HẠN/.test(mt) && !/Ảnh gốc đầy đủ/.test(mt));
  check('bác sĩ Mắt không có mục tải ảnh mới', !/Tải ảnh mới từ hồ sơ giấy/.test(mt));
  await mat.page.screenshot({ path: join(shots, '3-bac-si-mat.png') });

  // 3) Bác sĩ Nhi: CHỈ vùng đỏ
  const nhi = await session('bsnhi01');
  await nhi.page.type('input[placeholder^="Họ tên hoặc số CCCD"]', CCCD); await nhi.clickText('button', 'Tra cứu ảnh');
  await nhi.waitText('Ảnh bạn được phép xem (1)');
  const n = await readCanvas(nhi.page);
  check('bác sĩ Nhi: canvas chỉ có điểm ảnh vùng Nhi/TMH (đỏ), không có xanh dương', !!n && n.red === PHANTOM.nhiTmh.w * PHANTOM.nhiTmh.h && n.blue === 0 && n.green === 0 && n.other === 0, JSON.stringify(n));
  await nhi.page.screenshot({ path: join(shots, '4-bac-si-nhi.png') });

  // 4) Bác sĩ TMH khác cũng thấy vùng nhiều khoa; bác sĩ khám chung không thấy ảnh nào
  const tmh = await session('bstmh01');
  await tmh.page.type('input[placeholder^="Họ tên hoặc số CCCD"]', CCCD); await tmh.clickText('button', 'Tra cứu ảnh');
  await tmh.waitText('Ảnh bạn được phép xem (1)');
  const t = await readCanvas(tmh.page);
  check('bác sĩ TMH thấy cùng vùng nhiều khoa (đỏ)', !!t && t.red === PHANTOM.nhiTmh.w * PHANTOM.nhiTmh.h && t.blue === 0, JSON.stringify(t));
  const ksk = await session('bsksk01');
  await ksk.page.type('input[placeholder^="Họ tên hoặc số CCCD"]', CCCD); await ksk.clickText('button', 'Tra cứu ảnh');
  await ksk.waitText('Ảnh bạn được phép xem (0)');
  check('bác sĩ khám chung (không có khoa Mắt/Nhi/TMH) không thấy ảnh nào', (await readCanvas(ksk.page)) === null);
  for (const s of [nl, mat, nhi, tmh, ksk]) await s.ctx.close();
} catch (e) { console.error('LỖI:', e); failed++; }
finally {
  await browser.close(); web.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nẢNH THEO VÙNG (giao diện): tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
