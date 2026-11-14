// KIỂM TRA GIAO DIỆN "ẢNH BẤT KỲ -> TỰ NHẬN DIỆN VÀ CHIA VÙNG THEO KHOA" trong APP NHÂN VIÊN THẬT (Edge/Chrome, máy chủ tạm, dữ liệu giả):
//   người nhập chọn MỘT ẢNH MẶT NGƯỜI (bộ Face Research Lab London Set, CC BY 4.0) -> app tự nhận ra khuôn mặt và tự chia 5 vùng (mắt / mũi / hai tai / miệng+hàm) gán đúng khoa;
//   lưu xong, bác sĩ Mắt chỉ thấy đôi mắt, bác sĩ TMH chỉ mũi+tai, bác sĩ RHM chỉ miệng+hàm — đo bằng điểm ảnh THẬT trên canvas. Ảnh không có mặt người -> không tự chia vùng.
// Cần: npm run web:build (MEDABE_EDITION=user) và thư mục ảnh E:/TLCN/du-lieu-anh/_ANH_MAT_THAT/png800.     npx tsx app/test-ui/anh-mat-ui-check.ts
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';
import { encodePng, makePhantom } from '../../security/src/research/fake-image.js';

const dist = resolve('app/web/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run web:build');
const FACE = resolve(process.env.ANH_MAT ?? 'E:/TLCN/du-lieu-anh/_ANH_MAT_THAT/png800/016.png');
if (!existsSync(FACE)) throw new Error('Thiếu ảnh mặt ' + FACE);
const shots = resolve('.test-runs/anh-mat-ui'); mkdirSync(shots, { recursive: true });
const phantom = join(shots, 'khong-co-mat.png'); writeFileSync(phantom, encodePng(makePhantom(0)));
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const CCCD = '999000000555';

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.bin': 'application/octet-stream' };
const web = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const f = join(dist, p === '/' ? 'index.html' : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}).listen(5199, '127.0.0.1');
const spki = createHash('sha256').update(new X509Certificate(readFileSync(join(stack.tlsDir, 'server.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${spki}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

async function session(user: string) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 1000 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 300)); });
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string) => page.evaluate((s, l) => (Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click(), sel, label);
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
  await page.type('input[autocomplete="username"]', user); await page.type('input[autocomplete="current-password"]', pw(user));
  await clickText('button', 'Đăng nhập');
  await waitText('Ảnh CT/MRI');
  for (let i = 0; ; i++) {
    await clickText('a', 'Ảnh CT/MRI');
    try { await waitText('Ảnh CT/MRI theo vùng', 8_000); break; }
    catch (e) { if (i >= 6) { console.log('--- nội dung trang khi lỗi:', (await page.evaluate(() => document.body.innerText)).slice(0, 700)); throw e; } }
  }
  return { ctx, page, waitText, clickText };
}
/** Phần trăm điểm ảnh KHÔNG trong suốt trên canvas kết quả đầu tiên. */
const coverage = (page: import('puppeteer-core').Page) => page.evaluate(() => {
  const cv = document.querySelector('canvas.imgcanvas') as HTMLCanvasElement | null;
  if (!cv) return null;
  const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  return { w: cv.width, h: cv.height, pct: (100 * n) / (cv.width * cv.height) };
});

try {
  // 1) Ảnh KHÔNG có mặt người: không tự chia vùng
  const nl = await session('nhaplieu01');
  await nl.page.type('input[placeholder^="Họ tên hoặc số CCCD"]', CCCD);
  await (await nl.page.$('input[type=file]'))!.uploadFile(phantom);
  await nl.waitText('Không thấy khuôn mặt người', 120_000);
  const rows0 = await nl.page.evaluate(() => Array.from(document.querySelectorAll('.row')).filter((r) => /^Vùng \d/.test(r.textContent ?? '')).length);
  check('ảnh không có mặt người: app báo "không thấy khuôn mặt" và KHÔNG tự chia vùng', rows0 === 0);

  // 2) Ảnh mặt người: tự nhận diện, tự chia 5 vùng
  const t0 = Date.now();
  await (await nl.page.$('input[type=file]'))!.uploadFile(FACE);
  await nl.waitText('Đã nhận diện khuôn mặt', 120_000);
  const ms = Date.now() - t0;
  const info = await nl.page.evaluate(() => Array.from(document.querySelectorAll('.row')).filter((r) => /^Vùng \d/.test(r.textContent ?? '')).map((r) => ({
    khoas: Array.from(r.querySelectorAll('label')).filter((l) => (l.querySelector('input') as HTMLInputElement).checked).map((l) => l.textContent?.trim()),
  })));
  const flat = info.map((i) => i.khoas.join('+'));
  check('ảnh mặt người: app tự nhận ra khuôn mặt và tự chia 5 vùng', info.length === 5, `${ms} ms; ${JSON.stringify(flat)}`);
  check('đúng khoa: 1 vùng Mắt, 3 vùng Tai - Mũi - Họng, 1 vùng Răng - Hàm - Mặt',
    flat.filter((x) => x === 'Mắt').length === 1 && flat.filter((x) => x === 'Tai - Mũi - Họng').length === 3 && flat.filter((x) => x === 'Răng - Hàm - Mặt').length === 1);
  const text = await nl.page.evaluate(() => document.body.innerText);
  check('có cảnh báo dữ liệu cá nhân và bắt người nhập xác nhận trước khi lưu', /dữ liệu sinh trắc học/.test(text) && await nl.page.evaluate(() => (Array.from(document.querySelectorAll('button')).find((b) => /Mã hoá và lưu/.test(b.textContent ?? '')) as HTMLButtonElement).disabled));
  await nl.page.screenshot({ path: join(shots, '1-tu-chia-vung.png') });
  await nl.clickText('label', 'Tôi đã xem các cảnh báo');
  await nl.clickText('button', 'Mã hoá và lưu');
  await nl.waitText('Đã lưu ảnh với 5 vùng');
  check('lưu 5 vùng (mỗi vùng một khoá riêng)', true);
  await nl.waitText('Ảnh bạn được phép xem (1)');
  check('người nhập thấy ảnh gốc đầy đủ', /Ảnh gốc đầy đủ/.test(await nl.page.evaluate(() => document.body.innerText)));
  await new Promise((r) => setTimeout(r, 1500));
  const full = await coverage(nl.page);
  check('người nhập thấy ẢNH GỐC LIỀN LẶN (không bị khuyết từng khúc như ảnh ghép vùng)', !!full && full.pct > 99, JSON.stringify(full));
  await nl.page.screenshot({ path: join(shots, '1b-nguoi-nhap-anh-goc.png') });

  // 3) Từng bác sĩ chỉ thấy phần của mình
  const doc = async (user: string) => {
    const s = await session(user);
    await s.page.type('input[placeholder^="Họ tên hoặc số CCCD"]', CCCD); await s.clickText('button', 'Tra cứu ảnh');
    await s.waitText('Ảnh bạn được phép xem (');
    const c = await coverage(s.page); await s.page.screenshot({ path: join(shots, `2-${user}.png`) }); await s.ctx.close(); return c;
  };
  const mat = await doc('bsmat01'), tmh = await doc('bstmh01'), rhm = await doc('bsrhm01'), nhi = await doc('bsnhi01');
  check('bác sĩ Mắt chỉ thấy dải mắt (vài % điểm ảnh)', !!mat && mat.pct > 1 && mat.pct < 8, JSON.stringify(mat));
  check('bác sĩ TMH chỉ thấy mũi + tai', !!tmh && tmh.pct > 1 && tmh.pct < 8, JSON.stringify(tmh));
  check('bác sĩ Răng-Hàm-Mặt chỉ thấy miệng + hàm', !!rhm && rhm.pct > 1 && rhm.pct < 10, JSON.stringify(rhm));
  check('bác sĩ Nhi không thấy ảnh nào', nhi === null);
  await nl.ctx.close();
} catch (e) { console.error('LỖI:', e); failed++; }
finally {
  await browser.close(); web.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nẢNH MẶT TỰ CHIA VÙNG (giao diện): tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
