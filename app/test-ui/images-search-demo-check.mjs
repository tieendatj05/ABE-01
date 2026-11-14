// KIỂM TRA tra cứu ảnh theo HỌ TÊN / CCCD trên app DEMO đang chạy (http://localhost:5180, máy chủ https://localhost:8443). Cần đã chạy anh-demo.ts.
//   node app/test-ui/images-search-demo-check.mjs
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--ignore-certificate-errors'] });
let failed = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failed++; };

async function login(user, pass) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 1000 });
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  const waitText = (s, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel, label) => page.evaluate((s, l) => Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)).click(), sel, label);
  await page.goto('http://localhost:5180/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
  await page.type('input[autocomplete="username"]', user); await page.type('input[autocomplete="current-password"]', pass);
  await clickText('button', 'Đăng nhập');
  await waitText('Ảnh CT/MRI');
  await clickText('a', 'Ảnh CT/MRI');
  await waitText('Ảnh CT/MRI theo vùng');
  return { ctx, page, waitText, clickText };
}

try {
  const s = await login('bsmat01', 'Passw0rd-BM01');
  const box = 'input[placeholder^="Họ tên hoặc số CCCD"]';
  // 1) gõ một phần họ tên, KHÔNG dấu, chữ thường
  await s.page.type(box, 'tran thi');
  await s.waitText('999000000102');
  let t = await s.page.evaluate(() => document.body.innerText);
  check('gõ "tran thi" -> gợi ý "Tran Thi Binh · 999000000102"', /Tran Thi Binh · 999000000102/.test(t));
  check('gợi ý không lẫn bệnh nhân khác tên', !/Nguyen Van An/.test(t));
  // 2) chọn gợi ý -> tự tra cứu ảnh
  await s.clickText('li button', 'Tran Thi Binh');
  await s.waitText('Ảnh bạn được phép xem (1)');
  t = await s.page.evaluate(() => document.body.innerText);
  check('chọn gợi ý -> thấy ảnh bác sĩ Mắt được phép (vùng Mắt+TMH)', /Mat\s*\+|Mắt \+ Tai/.test(t) || /GIỚI HẠN/.test(t));
  check('vẫn có cảnh báo "mục bị loại" cho bác sĩ bị giới hạn', /loại \d+ mục/.test(t));
  // 3) CCCD đầy đủ vẫn dùng được
  await s.page.click(box, { clickCount: 3 }); await s.page.keyboard.press('Backspace');
  await s.page.type(box, '999000000101');
  await s.clickText('button', 'Tra cứu ảnh');
  await s.page.waitForFunction(() => /Ảnh bạn được phép xem \(1\)/.test(document.body.innerText));
  check('gõ đủ 12 số CCCD vẫn tra được', true);
  // 4) tên không tồn tại -> thông báo, không treo
  await s.page.click(box, { clickCount: 3 }); await s.page.keyboard.press('Backspace');
  await s.page.type(box, 'khong co nguoi nay');
  await s.waitText('Không thấy hồ sơ phù hợp');
  check('tên không có -> báo "không thấy hồ sơ phù hợp"', true);
  await s.page.screenshot({ path: '.test-runs/images-ui/5-tra-theo-ten.png' });
  await s.ctx.close();
} catch (e) { console.log('LỖI:', e.message); failed++; }
await browser.close();
// dọn thiết bị mà phiên trình duyệt này đã đăng ký
console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nTẤT CẢ ĐẠT');
process.exit(failed ? 1 : 0);
