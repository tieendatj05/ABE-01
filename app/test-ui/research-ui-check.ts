// Kiểm tra giao diện nghiên cứu TRONG TRÌNH DUYỆT THẬT trên hệ thống thật (HTTPS + 3 nút): đăng nhập, khoá mục theo khoa, banner khoá ngoài giờ,
// giữ nguyên bản nháp, KHÔNG tự lưu khi mở cửa lại. Cần: npm run research:ui:build, jar Spring đã build.
//   npx tsx app/test-ui/research-ui-check.ts          (ảnh chụp vào .test-runs/research-ui/)
// Trình duyệt chạy với --ignore-certificate-errors-spki-list=<SPKI của chứng chỉ máy chủ> (CHỈ cho kiểm thử: ghim đúng khoá công khai thay vì tắt kiểm tra).
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';
import { ResearchClient } from '../../security/src/research/client.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';

const dist = resolve('app/research/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build UI: npm run research:ui:build');
const shots = resolve('.test-runs/research-ui');
mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');

const stack = await startResearchStack({ passwordIterations: 20000 });
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = createServer((req, res) => {
  const f = join(dist, req.url === '/' || !req.url ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}).listen(5175, '127.0.0.1');

const spki = createHash('sha256').update(new X509Certificate(readFileSync(join(stack.tlsDir, 'server.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${spki}`] });
const pw = (u: string) => DEMO_USERS.find((x) => x.username === u)!.password;
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

try {
  // quản trị (qua thư viện) để đóng/mở lịch giữa chừng
  const admin = new ResearchClient({ baseUrl: stack.baseUrl, fetch: stack.fetch, store: new MemoryDeviceKeyStore() });
  await admin.signIn('quantri01', pw('quantri01'));
  const setSched = async (days: object, reason: string) => { const cur = await admin.call<{ version: number }>('GET', '/api/v2/admin/schedule'); await admin.call('PUT', '/api/v2/admin/schedule', { expectedVersion: cur.version, days, reason }); };
  const OPEN = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, { open: '00:00', close: '23:59' }]));
  const CLOSED = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, { closed: true }]));

  // dữ liệu giả: tiếp đón nhập hành chính, bác sĩ Nhi/Mắt ghi lâm sàng (cả hai chế độ qua UI-lib)
  const mk = () => new ResearchClient({ baseUrl: stack.baseUrl, fetch: stack.fetch, store: new MemoryDeviceKeyStore() });
  const td = mk(), nhi = mk(), mat = mk();
  await td.signIn('tiepdon01', pw('tiepdon01')); await nhi.signIn('bsnhi01', pw('bsnhi01')); await mat.signIn('bsmat01', pw('bsmat01'));
  const { fakePatients } = await import('../../security/src/research/fake-data.js');
  const ps = fakePatients(8);
  for (const mode of ['abe', 'baseline'] as const) {
    await td.importMany(mode, ps.map((p) => ({ patientCode: p.code, section: 'hanhchinh' as const, data: p.hanhchinh })));
    await nhi.saveSection(mode, { patientCode: ps[0].code, section: 'lamsang.Nhi', data: ps[0].lamsangNhi });
    await mat.saveSection(mode, { patientCode: ps[0].code, section: 'lamsang.Mat', data: ps[0].lamsangMat });
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('research.server', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  page.on('requestfailed', (r) => console.log('REQ FAILED', r.method(), new URL(r.url()).host + new URL(r.url()).pathname, r.failure()?.errorText));
  page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.request().method(), new URL(r.url()).host + new URL(r.url()).pathname); });
  await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle0' });

  const login = async (user: string) => {
    await page.type('input[autocomplete="username"]', user);
    await page.type('input[autocomplete="current-password"]', pw(user));
    await page.click('button[type=submit]');
    await page.waitForSelector('nav', { timeout: 60_000 });
  };
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);

  await login('bsnhi01');
  await waitText('Lâm sàng Nhi');
  await waitText('Chữ ký của', 90_000);
  let t = await text();
  check('đăng nhập: hiển thị vai trò/khoa từ backend', /Bác sĩ Nhi/.test(t));
  check('mục Lâm sàng Mắt bị khóa với bác sĩ Nhi (backend từ chối)', /Backend từ chối/.test(t));
  check('mục của khoa mình mở được và hiện chữ ký hợp lệ', /✔ Chữ ký của Bac si Nhi 01/.test(t));
  await page.screenshot({ path: join(shots, '1-bs-nhi-abe.png') });

  // nhập dở một bản nháp ở Lâm sàng Nhi
  const nhiInputs = await page.$$('section.sec:nth-of-type(2) input');
  const kl = nhiInputs[nhiInputs.length - 1];
  await kl.click({ clickCount: 3 });
  await kl.type('DANG NHAP DO - CHUA LUU');
  await waitText('bản nháp chưa lưu');

  // đóng cửa
  await setSched(CLOSED, 'kiem thu UI: dong cua');
  await waitText('Đã khóa nghiệp vụ', 40_000);
  t = await text();
  check('banner khóa nghiệp vụ rõ ràng + giờ mở lại', /Đã khóa nghiệp vụ ngoài giờ làm việc/.test(t));
  check('thanh trạng thái báo NGOÀI GIỜ', /NGOÀI GIỜ LÀM VIỆC/.test(t));
  check('nút Lưu bị vô hiệu khi đóng cửa', await page.$$eval('button', (bs) => bs.filter((b) => b.textContent?.includes('Lưu (ký và gửi)')).every((b) => (b as HTMLButtonElement).disabled)));
  check('bản nháp KHÔNG bị xóa khi bị khóa', (await page.$$eval('input', (is) => is.map((i) => (i as HTMLInputElement).value))).some((v) => v.includes('DANG NHAP DO - CHUA LUU')));
  await page.screenshot({ path: join(shots, '2-ngoai-gio.png') });

  // mở cửa lại: hiện thông báo, giữ nháp, KHÔNG tự lưu
  await setSched(OPEN, 'kiem thu UI: mo cua lai');
  await waitText('mở cửa trở lại', 40_000);
  t = await text();
  check('mở cửa lại: thông báo "KHÔNG tự gửi" và còn bản nháp', /KHÔNG tự gửi/.test(t) && /bản nháp chưa lưu/.test(t));
  check('bản nháp vẫn còn nguyên giá trị', (await page.$$eval('input', (is) => is.map((i) => (i as HTMLInputElement).value))).some((v) => v.includes('DANG NHAP DO - CHUA LUU')));
  const verify = await nhi.readPatient('abe', ps[0].code);
  const nhiNow = verify.find((v) => v.section === 'lamsang.Nhi')!;
  check('máy chủ KHÔNG nhận bản nháp nào khi mở cửa lại (vẫn 1 phiên bản)', nhiNow.versions === 1 && !JSON.stringify(nhiNow.data).includes('DANG NHAP DO'));
  await page.screenshot({ path: join(shots, '3-mo-cua-lai.png') });

  // người dùng chủ động lưu → backend nhận
  await page.evaluate(() => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Lưu (ký và gửi)')) as HTMLButtonElement).click());
  await waitText('Đã lưu Lâm sàng Nhi', 60_000);
  const after = (await nhi.readPatient('abe', ps[0].code)).find((v) => v.section === 'lamsang.Nhi')!;
  check('bấm Lưu thủ công: backend nhận phiên bản 2 có chữ ký hợp lệ', after.versions === 2 && JSON.stringify(after.data).includes('DANG NHAP DO') && after.signature?.ok === true);

  // quản trị: không có hồ sơ, thấy tab Quản trị
  await page.click('header button');                       // Đăng xuất
  await page.waitForSelector('input[autocomplete="username"]');
  await login('quantri01');
  t = await text();
  check('Quản trị thấy tab Quản trị', /Quản trị/.test(t));
  await page.evaluate(() => (Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent === 'Quản trị') as HTMLButtonElement).click());
  await waitText('Lịch giờ làm việc', 30_000);
  await page.screenshot({ path: join(shots, '4-quan-tri.png') });

  // ---- quy trình cấp tài khoản: nhân viên đưa SĐT → admin tạo → nhân viên đăng nhập bằng mật khẩu tạm, bị buộc đổi, rồi dùng ----
  const typeIn = async (label: string, value: string) => {
    const h = await page.evaluateHandle((l) => Array.from(document.querySelectorAll('label')).find((x) => x.textContent?.startsWith(l))?.querySelector('input') ?? null, label);
    const el = h.asElement(); if (!el) throw new Error('không thấy ô: ' + label);
    await (el as import('puppeteer-core').ElementHandle<HTMLInputElement>).click({ clickCount: 3 }); await (el as import('puppeteer-core').ElementHandle<HTMLInputElement>).type(value);
  };
  await typeIn('Số điện thoại', '0988 777 666'); await typeIn('Họ tên hiển thị', 'Nguyen Thi Tiep Don (moi)');
  await page.evaluate(() => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Tạo tài khoản') as HTMLButtonElement).click());
  await page.waitForSelector('.temppw', { timeout: 30_000 });
  const tempPw = await page.$eval('.temppw', (e) => e.textContent ?? '');
  check('admin tạo tài khoản bằng SĐT: hiện mật khẩu tạm một lần', /^[A-Za-z0-9]{12}$/.test(tempPw) && /0988777666/.test(await text()));
  await page.screenshot({ path: join(shots, '5-tao-tai-khoan.png') });
  await page.click('header button');                                            // Đăng xuất admin
  await page.waitForSelector('input[autocomplete="username"]');
  await page.type('input[autocomplete="username"]', '0988777666');
  await page.type('input[autocomplete="current-password"]', tempPw);
  await page.click('button[type=submit]');
  await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 60_000 });
  check('mật khẩu tạm: giao diện buộc đặt mật khẩu mới (chưa vào được hệ thống)', /mật khẩu TẠM do quản trị cấp/.test(await text()) && !(await page.$('nav')));
  const news = await page.$$('input[autocomplete="new-password"]');
  await news[0].type('MatKhau-Cua-Toi-1'); await news[1].type('MatKhau-Cua-Toi-1');
  await page.click('button[type=submit]');
  await page.waitForSelector('nav', { timeout: 90_000 });
  await waitText('Chữ ký của', 90_000);                         // đợi dữ liệu thật tải xong (ABE: xin khóa + giải mã)
  await waitText('Backend từ chối', 30_000);
  t = await text();
  check('nhân viên mới vào được sau khi đổi mật khẩu, đúng vai trò Tiếp đón do admin chọn', /Tiếp đón/.test(t) && /Chữ ký của Tiep don 01/.test(t));
  check('nhân viên mới không thấy mục lâm sàng (backend từ chối)', (t.match(/Backend từ chối/g) ?? []).length === 2);
  await page.screenshot({ path: join(shots, '6-nhan-vien-moi.png') });
} catch (e) {
  console.error('LỖI:', e); failed++;
  try { const pg = (await browser.pages()).at(-1); await pg?.screenshot({ path: join(shots, 'error.png') }); } catch { /* ignore */ }
} finally {
  await browser.close(); web.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nGIAO DIỆN: tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
