// KIỂM TRA GIAO DIỆN XÁC THỰC HAI LỚP CHO QUẢN TRỊ (app nhân viên thật, máy chủ thử có MEDABE_RESEARCH_ADMIN_MFA=true): quản trị đăng nhập → bị chặn bởi màn MFA →
// đăng ký (nhập lại mật khẩu, mã QR + bí mật) → nhập mã → vào được trang quản trị; đăng nhập lại phải nhập mã lần nữa; mã sai bị từ chối; nhân viên thường không bị hỏi MFA.
// Cần: npm run web:build, jar Spring đã build.   npx tsx app/test-ui/admin-mfa-ui-check.ts
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';
import { totpCode } from '../../security/src/research/totp.js';

const dist = resolve('app/web/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run web:build');
const shots = resolve('.test-runs/admin-mfa');
mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true, env: { MEDABE_RESEARCH_ADMIN_MFA: 'true' } });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.bin': 'application/octet-stream' };
const web = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const f = join(dist, p === '/' ? 'index.html' : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}).listen(5196, '127.0.0.1');
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
  await page.goto('http://127.0.0.1:5196/', { waitUntil: 'networkidle0' });

  // 1) Quản trị đăng nhập: bị chặn bởi màn MFA, chưa thấy trang quản trị
  await loginAs('quantri01', pw('quantri01'));
  await waitText('Xác thực hai lớp cho Quản trị', 90_000);
  let t = await text();
  check('quản trị đăng nhập xong thấy MÀN XÁC THỰC HAI LỚP, chưa thấy trang quản trị tài khoản', /bắt buộc/.test(t) && !/Cấp tài khoản cho nhân viên mới/.test(t));
  await page.screenshot({ path: join(shots, '1-chan-mfa.png') });

  // 2) Đăng ký: nhập lại mật khẩu → mã QR + bí mật → nhập mã → vào được
  await typeInto('input[aria-label="Mật khẩu để đăng ký MFA"]', pw('quantri01'));
  await clickText('button', 'Tạo mã QR');
  await page.waitForSelector('img[alt="Mã QR đăng ký MFA"]', { timeout: 30_000 });
  const secret = await page.evaluate(() => (document.querySelector('code[aria-label="Bí mật MFA"]') as HTMLElement).textContent ?? '');
  check('hiện mã QR và bí mật để nhập vào ứng dụng xác thực', /^[A-Z2-7]{16,}$/.test(secret), `${secret.length} ký tự`);
  await page.screenshot({ path: join(shots, '2-ma-qr.png') });
  await typeInto('input[aria-label="Mã MFA 6 số"]', '000000');
  await clickText('button', 'Xác nhận');
  await waitText('MFA_CODE_INVALID', 15_000).catch(() => undefined);
  check('mã SAI bị từ chối và vẫn chưa vào được trang quản trị', /Lỗi/.test(await text()) && !/Cấp tài khoản cho nhân viên mới/.test(await text()));
  await typeInto('input[aria-label="Mã MFA 6 số"]', totpCode(secret, Math.floor(Date.now() / 1000), 0));
  await clickText('button', 'Xác nhận');
  await waitText('Cấp tài khoản cho nhân viên mới', 60_000);
  check('nhập đúng mã: mở trang quản trị tài khoản', true);
  const hasReset = (who: string) => page.evaluate((w) => Array.from(document.querySelectorAll('tbody tr')).some((r) => r.textContent?.includes(w) && Array.from(r.querySelectorAll('button')).some((b) => b.textContent === 'Đặt lại MFA')), who);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('tbody tr')).some((r) => r.textContent?.includes('quantri02') && Array.from(r.querySelectorAll('button')).some((b) => b.textContent === 'Đặt lại MFA')), { timeout: 30_000 }).catch(() => undefined);   // danh sách tải sau tiêu đề
  check('trang quản trị có nút "Đặt lại MFA" cho quản trị khác (mất điện thoại) nhưng không cho chính mình', (await hasReset('quantri02')) && !(await hasReset('quantri01')));
  await page.screenshot({ path: join(shots, '3-vao-quan-tri.png') });

  // 3) Đăng nhập lại (phiên mới): lại phải nhập mã, lần này KHÔNG có bước đăng ký
  await clickText('a', 'đăng xuất');
  await loginAs('quantri01', pw('quantri01'));
  await waitText('Nhập mã 6 số trong ứng dụng xác thực', 90_000);
  t = await text();
  check('đăng nhập lại: hỏi mã (đã đăng ký, không hiện lại mã QR) và chưa vào trang quản trị', !(await page.$('img[alt="Mã QR đăng ký MFA"]')) && !/Cấp tài khoản cho nhân viên mới/.test(t));
  await typeInto('input[aria-label="Mã MFA 6 số"]', totpCode(secret, Math.floor(Date.now() / 1000), 1));    // mỗi mã dùng một lần: dùng mã bước kế
  await clickText('button', 'Xác nhận');
  await waitText('Cấp tài khoản cho nhân viên mới', 60_000);
  check('nhập đúng mã ở phiên mới: vào lại được trang quản trị', true);

  // 4) Nhân viên thường không bị hỏi MFA
  await clickText('a', 'đăng xuất');
  await loginAs('tiepdon01', pw('tiepdon01'));
  await waitText('Đã kết nối', 90_000);
  t = await text();
  check('nhân viên thường (Tiếp đón) vào thẳng app, không bị hỏi MFA', /Import Excel/.test(t) && !/Xác thực hai lớp/.test(t));
} catch (e) {
  console.error('LỖI:', e); failed++;
  try { const pg = (await browser.pages()).at(-1); await pg?.screenshot({ path: join(shots, 'error.png') }); } catch { /* ignore */ }
} finally {
  await browser.close(); web.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nMFA QUẢN TRỊ (giao diện): tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
