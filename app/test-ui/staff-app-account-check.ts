// KIỂM TRA APP NHÂN VIÊN THẬT (app/web, không phải app nghiên cứu) đăng nhập bằng TÀI KHOẢN trên hệ thống thật, trong Edge/Chrome:
// quản trị tạo email + mật khẩu tạm → nhân viên đăng nhập, bị buộc đặt mật khẩu mới → vào đúng menu/quyền, xem danh sách hồ sơ đã giải mã → đóng cửa ngoài giờ
// (banner khoá, màn hình KHÔNG bị gỡ) → mở lại. Cần: npm run web:build, jar Spring đã build.   npx tsx app/test-ui/staff-app-account-check.ts
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';
import { MedClient } from '../../security/src/client/medclient.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';

const dist = resolve('app/web/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run web:build');
const shots = resolve('.test-runs/staff-app');
mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const web = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const f = join(dist, p === '/' ? 'index.html' : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}).listen(5199, '127.0.0.1');
const spki = createHash('sha256').update(new X509Certificate(readFileSync(join(stack.tlsDir, 'server.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${spki}`] });
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

try {
  const mk = (u: string) => MedClient.signIn(stack.baseUrl, u, pw(u), new MemoryDeviceKeyStore(), { fetch: stack.fetch });
  const [td, qt] = await Promise.all([mk('tiepdon01'), mk('quantri01')]);
  const unit = UNITS[0].ma;
  const people = Array.from({ length: 3 }, (_, i) => ({ ...blank.hanhchinh(), lop: '9A', hoTen: `Nguyen Van Gia ${i + 1} (gia)`, cccd: `99900000000${i + 1}`, ngaySinh: '2012-05-1' + (i + 1), nguonChiTra: 'BHYT', gioiTinh: 'nam' as const }));
  await td.saveMany(people.map((p) => ({ patientCode: p.cccd, type: 'hanhchinh' as const, khoa: 'KSK', data: p, group: unit })));
  const setSchedule = async (open: boolean) => {
    const cur = await qt.api<{ version: number }>('GET', '/api/v2/admin/schedule');
    const days = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, open ? { open: '00:00', close: '23:59' } : { closed: true }]));
    await qt.api('PUT', '/api/v2/admin/schedule', { expectedVersion: cur.version, days, reason: 'kiem thu app nhan vien (giao dien)' });
  };

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon') && !r.url().includes('/api/enrollment')) console.log('HTTP', r.status(), r.request().method(), new URL(r.url()).pathname); });
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string) => page.evaluate((s, l) => (Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click(), sel, label);
  const loginAs = async (email: string, password: string) => {
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
    await page.click('input[autocomplete="username"]', { clickCount: 3 }); await page.type('input[autocomplete="username"]', email);
    await page.click('input[autocomplete="current-password"]', { clickCount: 3 }); await page.type('input[autocomplete="current-password"]', password);
    await clickText('button', 'Đăng nhập');
  };
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle0' });

  // 1) Quản trị đăng nhập → tạo tài khoản bác sĩ Nhi bằng EMAIL
  check('màn đầu tiên là ĐĂNG NHẬP email + mật khẩu (không còn "đăng ký thiết bị")', /Đăng nhập MedABE/.test(await text()) && !/Chào mừng đến MedABE/.test(await text()));
  await loginAs('quantri01', pw('quantri01'));
  await waitText('Cấp tài khoản cho nhân viên mới');
  let t = await text();
  check('tài khoản Quản trị vào thẳng trang quản trị tài khoản, không có menu nhập liệu', /Quản trị tài khoản/.test(t) && !/Khám sức khỏe định kỳ/.test(t) && !/Import Excel/.test(t));
  await page.type('input[type=email]', 'Bac.Si.Nhi.Moi@CongTy.vn');
  await page.type('input[placeholder="Họ tên hiển thị"]', 'BS Nhi moi vao lam');
  await page.select('select', 'BAC_SI');
  await clickText('button', 'Tạo tài khoản');
  await page.waitForFunction(() => document.body.innerText.includes('Mật khẩu tạm của'), { timeout: 30_000 });
  const tempPw = await page.evaluate(() => (document.querySelector('.warnbar code') as HTMLElement).textContent ?? '');
  check('admin cấp email + mật khẩu tạm (hiện một lần), email được chuẩn hóa chữ thường', /^[A-Za-z0-9]{12}$/.test(tempPw) && /bac\.si\.nhi\.moi@congty\.vn/.test(await text()));
  await page.screenshot({ path: join(shots, '1-admin-tao-tai-khoan.png') });
  await clickText('a', 'đăng xuất');

  // 2) Nhân viên đăng nhập bằng mật khẩu tạm → bắt buộc đặt mật khẩu mới
  await loginAs('bac.si.nhi.moi@congty.vn', tempPw);
  await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 60_000 });
  check('mật khẩu tạm: bị buộc đặt mật khẩu mới trước khi vào', /mật khẩu TẠM do quản trị cấp/.test(await text()));
  const news = await page.$$('input[autocomplete="new-password"]');
  await news[0].type('MatKhau-Cua-Toi-1'); await news[1].type('MatKhau-Cua-Toi-1');
  await clickText('button', 'Đặt mật khẩu mới và đăng nhập');
  await waitText('Đã kết nối', 90_000);
  t = await text();
  check('vào được app: đúng tên + email, menu nghiệp vụ, KHÔNG có menu quản trị tài khoản', /BS Nhi moi vao lam/.test(t) && /Khám sức khỏe định kỳ/.test(t) && !/Quản trị tài khoản/.test(t));
  check('không còn mục "Phá vỡ kính" trong menu khóa của tôi (đã bỏ nhánh vượt chính sách)', !/Phá vỡ kính/.test(t));
  await page.screenshot({ path: join(shots, '2-nhan-vien-vao-app.png') });

  // 3) Xem danh sách hồ sơ (được giải mã tại máy)
  await clickText('.menubar a', 'Quản lý hồ sơ');
  await waitText('Nguyen Van Gia 1', 90_000);   // app bỏ đuôi "(gia)" khi hiển thị
  t = await text();
  check('Quản lý hồ sơ: danh sách Hành chính của đơn vị hiện tên đã giải mã', /Nguyen Van Gia 1 \(gia\)/.test(t) && /Nguyen Van Gia 3 \(gia\)/.test(t));
  await page.screenshot({ path: join(shots, '3-danh-sach.png') });

  // 4) Ngoài giờ: banner khoá, màn hình và dữ liệu KHÔNG bị gỡ
  await setSchedule(false);
  await waitText('Đã khóa nghiệp vụ ngoài giờ làm việc', 30_000);
  t = await text();
  check('đóng cửa: banner đỏ rõ ràng, danh sách đã tải VẪN CÒN trên màn hình (không bị gỡ như mất kết nối)', /Dữ liệu đang nhập vẫn được giữ/.test(t) && /Nguyen Van Gia 1 \(gia\)/.test(t) && !/Chưa kết nối máy chủ KSK/.test(t));
  await page.screenshot({ path: join(shots, '4-ngoai-gio.png') });
  await setSchedule(true);
  await page.waitForFunction(() => !document.body.innerText.includes('Đã khóa nghiệp vụ ngoài giờ làm việc'), { timeout: 30_000 });
  check('mở cửa lại: banner biến mất, vẫn dùng tiếp', /Nguyen Van Gia 1 \(gia\)/.test(await text()));

  // 5) Nhân viên khác (Tiếp đón) vào bằng tài khoản mẫu: thấy menu Import
  await clickText('a', 'đăng xuất');
  await loginAs('tiepdon01', pw('tiepdon01'));
  await waitText('Đã kết nối', 90_000);
  check('Tiếp đón đăng nhập: có menu Import Excel', /Import Excel/.test(await text()));
  await page.screenshot({ path: join(shots, '5-tiep-don.png') });
} catch (e) {
  console.error('LỖI:', e); failed++;
  try { const pg = (await browser.pages()).at(-1); await pg?.screenshot({ path: join(shots, 'error.png') }); } catch { /* ignore */ }
} finally {
  await browser.close(); web.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nAPP NHÂN VIÊN: tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
