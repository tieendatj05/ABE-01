// KIỂM TRA GIAO DIỆN KHÔI PHỤC MẬT KHẨU (app nhân viên thật, trên máy chủ thử): nhân viên bấm "Quên mật khẩu?" → quản trị thấy yêu cầu và cấp mật khẩu tạm
// → nhân viên đăng nhập bằng mật khẩu tạm, bị buộc đặt mật khẩu mới → vào lại được. Cần: npm run web:build, jar Spring đã build.   npx tsx app/test-ui/password-recovery-ui-check.ts
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';

const dist = resolve('app/web/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run web:build');
const shots = resolve('.test-runs/password-recovery');
mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.bin': 'application/octet-stream' };
const web = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const f = join(dist, p === '/' ? 'index.html' : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}).listen(5197, '127.0.0.1');
const spki = createHash('sha256').update(new X509Certificate(readFileSync(join(stack.tlsDir, 'server.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${spki}`] });
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  page.on('dialog', (d) => void d.accept());
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string) => page.evaluate((s, l) => (Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click(), sel, label);
  const typeInto = async (sel: string, value: string) => { await page.focus(sel); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type(sel, value); };
  const loginAs = async (email: string, password: string) => {
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
    await typeInto('input[autocomplete="username"]', email); await typeInto('input[autocomplete="current-password"]', password);
    await clickText('button', 'Đăng nhập');
  };
  await page.goto('http://127.0.0.1:5197/', { waitUntil: 'networkidle0' });

  // 1) Nhân viên quên mật khẩu: màn đăng nhập có liên kết, gửi yêu cầu; email lạ cũng ra CÙNG thông báo
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
  check('màn đăng nhập có liên kết "Quên mật khẩu?"', /Quên mật khẩu\?/.test(await text()));
  await clickText('a', 'Quên mật khẩu?');
  await waitText('Hệ thống không tự gửi mật khẩu qua email');
  await typeInto('input[type=email]', 'tiepdon01');
  await clickText('button', 'Gửi yêu cầu cấp lại mật khẩu');
  await waitText('Đã gửi yêu cầu tới quản trị');
  const t1 = await text();
  check('thông báo nói rõ: quản trị xác minh rồi đưa mật khẩu tạm; yêu cầu hết hạn sau 72 giờ', /liên hệ xác minh bạn/.test(t1) && /72 giờ/.test(t1));
  await page.screenshot({ path: join(shots, '1-da-gui.png') });
  await clickText('a', 'Quay lại đăng nhập');
  await clickText('a', 'Quên mật khẩu?');
  await typeInto('input[type=email]', 'khong.co.nguoi.nay@congty.vn');
  await clickText('button', 'Gửi yêu cầu cấp lại mật khẩu');
  await waitText('Đã gửi yêu cầu tới quản trị');
  check('email KHÔNG tồn tại cũng thấy đúng thông báo đó (không dò được tài khoản)', /Đã gửi yêu cầu tới quản trị/.test(await text()));

  // 2) Quản trị thấy đúng MỘT yêu cầu (người lạ không tạo yêu cầu) và cấp mật khẩu tạm
  await clickText('a', 'Quay lại đăng nhập');
  await loginAs('quantri01', pw('quantri01'));
  await waitText('Yêu cầu cấp lại mật khẩu (1)', 90_000);
  const t2 = await text();
  check('Quản trị thấy mục "Yêu cầu cấp lại mật khẩu (1)" kèm cảnh báo phải xác minh đúng người', /Yêu cầu cấp lại mật khẩu \(1\)/.test(t2) && /xác minh đúng người/.test(t2));
  await page.screenshot({ path: join(shots, '2-quan-tri-thay-yeu-cau.png') });
  await clickText('button', 'Cấp mật khẩu tạm');
  await waitText('Mật khẩu tạm của');
  await page.waitForFunction(() => !document.body.innerText.includes('Yêu cầu cấp lại mật khẩu ('), { timeout: 15_000 }).catch(() => undefined);   // danh sách tải lại sau khi cấp
  const temp = await page.evaluate(() => (document.querySelector('.warnbar code') as HTMLElement | null)?.textContent ?? '');
  check('quản trị nhận mật khẩu tạm (hiện một lần) và yêu cầu biến khỏi danh sách', /^[A-Za-z0-9]{12,}$/.test(temp) && !/Yêu cầu cấp lại mật khẩu \(/.test(await text()), `${temp.length} ký tự`);
  await page.screenshot({ path: join(shots, '3-da-cap.png') });
  await clickText('a', 'đăng xuất');

  // 3) Nhân viên đăng nhập bằng mật khẩu tạm → buộc đặt mật khẩu mới → vào được
  await loginAs('tiepdon01', pw('tiepdon01'));
  await waitText('Sai email hoặc mật khẩu', 30_000);
  check('mật khẩu CŨ không còn đăng nhập được', true);
  await typeInto('input[autocomplete="current-password"]', temp);
  await clickText('button', 'Đăng nhập');
  await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 60_000 });
  check('mật khẩu tạm: bị buộc đặt mật khẩu mới trước khi vào', /mật khẩu TẠM do quản trị cấp/.test(await text()));
  const news = await page.$$('input[autocomplete="new-password"]');
  await news[0].type('MatKhauMoi-Cua-Toi-2026'); await news[1].type('MatKhauMoi-Cua-Toi-2026');
  await clickText('button', 'Đặt mật khẩu mới và đăng nhập');
  await waitText('Đã kết nối', 90_000);
  check('đặt mật khẩu mới xong: vào được app, đúng menu nhân viên Tiếp đón', /Import Excel/.test(await text()));
  await page.screenshot({ path: join(shots, '4-vao-lai.png') });

  // 4) Quản trị thấy danh sách máy đã đăng ký và thu hồi được máy của nhân viên (tránh nhân viên bị kẹt "đã đủ số máy")
  await clickText('a', 'đăng xuất');
  await loginAs('quantri01', pw('quantri01'));
  await waitText('Máy (thiết bị) đã đăng ký', 90_000);
  const summaries = () => page.evaluate(() => Array.from(document.querySelectorAll('details summary')).map((e) => e.textContent ?? ''));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('details summary')).some((e) => e.textContent?.includes('tiepdon01')), { timeout: 30_000 });   // danh sách máy tải sau tiêu đề
  const before = (await summaries()).filter((x) => x.includes('tiepdon01'));
  check('Quản trị thấy máy đã đăng ký của tiepdon01 (kèm số máy đang dùng)', before.length === 1 && /1 máy đang dùng/.test(before[0]), JSON.stringify(before));
  await page.screenshot({ path: join(shots, '5-danh-sach-may.png') });
  await page.evaluate(() => { const d = Array.from(document.querySelectorAll('details')).find((x) => x.querySelector('summary')?.textContent?.includes('tiepdon01')); (Array.from(d!.querySelectorAll('button')).find((b) => b.textContent === 'Thu hồi') as HTMLElement).click(); });
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('details summary')).some((e) => e.textContent?.includes('tiepdon01')), { timeout: 30_000 });
  check('thu hồi xong: tiepdon01 không còn máy nào đang dùng', (await summaries()).every((x) => !x.includes('tiepdon01')));
} catch (e) {
  console.error('LỖI:', e); failed++;
  try { const pg = (await browser.pages()).at(-1); await pg?.screenshot({ path: join(shots, 'error.png') }); } catch { /* ignore */ }
} finally {
  await browser.close(); web.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nKHÔI PHỤC MẬT KHẨU (giao diện): tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
