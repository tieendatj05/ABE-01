// KIỂM TRA GIAO DIỆN VAI TRÒ GIÁM SÁT trong APP NHÂN VIÊN THẬT (Edge/Chrome, hệ thống thật, dữ liệu giả):
//  1) Giám sát chỉ có trang "Giám sát hồ sơ"; ô tra cứu bị khoá cho tới khi nhập lý do; tra theo họ tên/CCCD; thấy mọi mục + ảnh gốc đầy đủ.
//  2) Quản trị 1 tạo tài khoản Giám sát -> "chờ duyệt", nút Duyệt bị khoá cho chính người yêu cầu; Quản trị 2 duyệt -> hoạt động.
// Cần: npm run web:build + jar Spring.     npx tsx app/test-ui/giamsat-ui-check.ts
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { MedClient } from '../../security/src/client/medclient.js';
import { saveImage } from '../../security/src/client/imaging.js';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';
import { PHANTOM, encodePng, makePhantom } from '../../security/src/research/fake-image.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';
import { totpCode } from '../../security/src/research/totp.js';
import { UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';

const dist = resolve('app/web/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run web:build');
const shots = resolve('.test-runs/giamsat-ui'); mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const CCCD = '999000000444';

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
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

// ---- dữ liệu giả: tiếp đón nhập hành chính (cho tra theo tên), người nhập nhập lâm sàng + ảnh nhiều vùng
const login = (u: string) => MedClient.signIn(stack.baseUrl, u, pw(u), new MemoryDeviceKeyStore(), { fetch: stack.fetch });
const td = await login('tiepdon01'), nl = await login('nhaplieu01');
await td.saveMany([{ patientCode: CCCD, type: 'hanhchinh', khoa: 'KSK', group: UNITS[0].ma, data: { ...blank.hanhchinh(), hoTen: 'TRAN THI GIAM SAT', cccd: CCCD, ngaySinh: '2012-03-15', gioiTinh: 'nu', lop: '6A', nguonChiTra: 'BHYT' } }]);
await nl.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Mat', data: { ghiChu: 'canary-mat' } });
await nl.saveRecord({ patientCode: CCCD, type: 'lamsang', khoa: 'Nhi', data: { ghiChu: 'canary-nhi' } });
await saveImage(nl, { patientCode: CCCD, original: { mime: 'image/png', bytes: encodePng(makePhantom(0)) }, pixels: makePhantom(0), modality: 'MRI', regions: [{ rect: PHANTOM.mat, khoas: ['Mat'] }, { rect: PHANTOM.nhiTmh, khoas: ['Nhi'] }] });

async function session(user: string, password = pw(user), landing = 'Giám sát hồ sơ') {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 1000 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  page.on('dialog', (d) => void d.accept());
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string, within?: string) => page.evaluate((s, l, w) => {
    const root = w ? Array.from(document.querySelectorAll('tr')).find((r) => r.textContent?.includes(w)) ?? document : document;
    (Array.from(root.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click();
  }, sel, label, within);
  await page.goto('http://127.0.0.1:5197/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
  await page.type('input[autocomplete="username"]', user); await page.type('input[autocomplete="current-password"]', password);
  await clickText('button', 'Đăng nhập');
  await waitText(landing);
  return { ctx, page, text, waitText, clickText };
}

try {
  // ---------- 1) Giám sát
  const gs = await session('giamsat01');
  let t = await gs.text();
  check('Giám sát chỉ thấy menu "Giám sát hồ sơ"; không có Khám sức khỏe / Import / Quản trị tài khoản', /Giám sát hồ sơ/.test(t) && !/Khám sức khỏe định kỳ|Import Excel|Quản trị tài khoản/.test(t));
  // MFA (thuộc tính ABE): chưa xác thực thì ô lý do/tra cứu bị khoá; đăng ký bằng mã QR rồi nhập mã 6 số
  await gs.waitText('Xác thực hai lớp');
  check('chưa xác thực MFA: ô lý do BỊ KHOÁ', await gs.page.$eval('input[aria-label="Lý do truy cập"]', (e) => (e as HTMLInputElement).disabled));
  await gs.page.type('input[aria-label="Mật khẩu để đăng ký MFA"]', pw('giamsat01'));
  await gs.clickText('button', 'Tạo mã QR');
  await gs.page.waitForSelector('code[aria-label="Bí mật MFA"]', { timeout: 30_000 });
  const secret = (await gs.page.$eval('code[aria-label="Bí mật MFA"]', (e) => e.textContent ?? '')).trim();
  check('hiện mã QR và bí mật MFA để đăng ký vào ứng dụng xác thực', /^[A-Z2-7]{32}$/.test(secret) && !!(await gs.page.$('img[alt="Mã QR đăng ký MFA"]')));
  await gs.page.screenshot({ path: join(shots, '0-dang-ky-mfa.png') });
  await gs.page.type('input[aria-label="Mã MFA 6 số"]', totpCode(secret));
  await gs.clickText('button', 'Xác nhận');
  await gs.waitText('Đã xác thực');
  check('nhập đúng mã: phiên nhận thuộc tính MFA, ô lý do được mở', !(await gs.page.$eval('input[aria-label="Lý do truy cập"]', (e) => (e as HTMLInputElement).disabled)));
  const search = 'input[aria-label="Tra cứu bệnh nhân"]';
  await gs.page.waitForSelector(search, { timeout: 30_000 });
  check('ô tra cứu bị KHOÁ khi chưa nhập lý do', await gs.page.$eval(search, (e) => (e as HTMLInputElement).disabled));
  await gs.page.type('input[aria-label="Lý do truy cập"]', 'Kiểm tra tuân thủ quý 4 theo yêu cầu thanh tra');
  check('nhập lý do (>= 8 ký tự) thì mở khoá ô tra cứu', !(await gs.page.$eval(search, (e) => (e as HTMLInputElement).disabled)));
  await gs.page.type(search, 'tran thi giam');                                   // tra theo họ tên, không dấu, một phần
  await gs.waitText(`TRAN THI GIAM SAT · ${CCCD}`);
  check('gõ một phần họ tên (không dấu) -> gợi ý đúng bệnh nhân', true);
  await gs.clickText('li button', 'TRAN THI GIAM SAT');
  await gs.waitText('1 ảnh');
  t = await gs.text();
  check('thấy cả lâm sàng Mắt VÀ Nhi (canary) đã giải mã trên máy này', /canary-mat/.test(t) || /Mắt/.test(t) && /Nhi/.test(t));
  await gs.page.evaluate(() => document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
  t = await gs.text();
  check('nội dung cả hai khoa hiện ra (canary-mat và canary-nhi)', /canary-mat/.test(t) && /canary-nhi/.test(t));
  check('ảnh: nhãn "Ảnh gốc đầy đủ" (không phải bản giới hạn)', /✔ Ảnh gốc đầy đủ/.test(t) && !/chỉ các vùng được cấp/.test(t));
  check('không có cảnh báo "còn N mục không xem được" (đọc được tất cả dữ liệu mới)', !/Còn \d+ mục/.test(t));
  await gs.page.screenshot({ path: join(shots, '1-giam-sat.png') });
  await gs.ctx.close();

  // ---------- 2) Hai quản trị viên duyệt
  const NEW = 'gs.ui@congty.vn';
  const a1 = await session('quantri01', pw('quantri01'), 'Cấp tài khoản cho nhân viên mới');
  await a1.page.type('input[placeholder^="Email"]', NEW);
  await a1.page.type('input[placeholder="Họ tên hiển thị"]', 'Giam sat giao dien');
  await a1.page.select('select', 'GIAM_SAT');
  await a1.waitText('Giám sát đọc được TẤT CẢ hồ sơ mới');
  check('chọn vai trò Giám sát hiện cảnh báo siết chặt', /14 ký tự/.test(await a1.text()));
  await a1.clickText('button', 'Tạo tài khoản');
  await a1.waitText('Mật khẩu tạm của');
  await a1.waitText('Chờ quản trị KHÁC duyệt');
  const disabled = await a1.page.evaluate((w) => {
    const row = Array.from(document.querySelectorAll('tr')).find((r) => r.textContent?.includes(w))!;
    return (Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Duyệt') as HTMLButtonElement).disabled;
  }, NEW);
  check('tài khoản mới ở trạng thái "Chờ quản trị KHÁC duyệt"; nút Duyệt BỊ KHOÁ với người yêu cầu', disabled);
  await a1.page.screenshot({ path: join(shots, '2-cho-duyet.png') });
  await a1.ctx.close();

  const a2 = await session('quantri02', pw('quantri02'), 'Cấp tài khoản cho nhân viên mới');
  await a2.waitText('Chờ quản trị KHÁC duyệt');
  await a2.clickText('button', 'Duyệt', NEW);
  await a2.page.waitForFunction((w) => { const row = Array.from(document.querySelectorAll('tr')).find((r) => r.textContent?.includes(w)); return !!row && /Đang hoạt động/.test(row.textContent ?? ''); }, { timeout: 30_000 }, NEW);
  check('quản trị KHÁC bấm Duyệt -> tài khoản "Đang hoạt động"', true);
  await a2.page.screenshot({ path: join(shots, '3-da-duyet.png') });
  await a2.ctx.close();
} catch (e) { console.log('LỖI:', (e as Error).message); failed++; }

await browser.close(); web.close(); await stack.stop();
console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nGIÁM SÁT (giao diện): tất cả kiểm tra đạt');
process.exit(failed ? 1 : 0);
