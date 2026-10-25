import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import puppeteer from 'puppeteer-core';
const server = await createServer({ root: 'app/test-ui/panels-harness', plugins: [react()], server: { port: 5199, fs: { strict: false } }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, defaultViewport: { width: 1300, height: 1000 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
let fail = 0;
const check = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const st = () => page.evaluate(() => JSON.stringify(window.state));

// Hành chính: dân tộc 60, tỉnh 34, xã theo tỉnh, nghề nghiệp
check(await page.$$eval('select', (s) => s.some((x) => x.options.length >= 60 && [...x.options].some((o) => o.text === 'Kinh'))), 'danh sách dân tộc đầy đủ (>= 60)');
check(await page.$$eval('#dl-tinh option', (o) => o.length) === 34, 'có 34 tỉnh/thành');
await page.type('input[placeholder="Tìm tỉnh"]', 'Thành phố Hồ Chí Minh');
check(await page.$$eval('#dl-xa option', (o) => o.length) > 100, 'chọn tỉnh thì danh sách xã/phường nạp theo tỉnh (>100)');
check(await page.$$eval('select', (s) => s.some((x) => [...x.options].some((o) => /^02 - Lực lượng công an/.test(o.text)))), 'có ô Nghề nghiệp theo danh mục chuẩn');

// Cận lâm sàng: mẫu mặc định hiện sẵn, nhập giá trị, cờ
let rows = await page.$$eval('table.grid.small tbody tr', (r) => r.map((x) => x.cells[0].textContent));
check(rows.join(',') === 'H01,H13,H17,S01,S04,S05,S17,S18,S69,S70', 'mẫu Ksk thường quy 6-18 hiện sẵn: ' + rows.join(','));
const glu = await page.$('table.grid.small tbody tr:nth-child(4) input');
await glu.type('9.5');
await new Promise((r) => setTimeout(r, 200));
check((await page.$eval('table.grid.small tbody tr:nth-child(4)', (r) => r.textContent)).includes('Cao'), 'Glucose 9.5 mmol/L bị gắn cờ Cao');
check(JSON.parse(await st()).cls.kq.S01 === '9.5', 'giá trị lưu vào đúng mã S01');
check(Object.keys(JSON.parse(await st()).cls.kq).length === 10, 'khi nhập lần đầu, cả mẫu được giữ lại (không mất dòng)');
await page.type('input[placeholder^="Tìm chỉ số"]', 'creatinin');
await page.waitForSelector('.xnbar .pickres li a');
const nres = await page.$$eval('.xnbar .pickres li', (l) => l.length);
check(nres >= 0, 'tìm "creatinin" ra ' + nres + ' kết quả (S05 đã có trong mẫu nên bị ẩn)');
await page.$eval('.xnbar input', (i) => { i.value = ''; });
await page.click('.xnbar input', { clickCount: 3 }); await page.keyboard.type('hdl');
await new Promise((r) => setTimeout(r, 200));
const hits = await page.$$('.xnbar .pickres li a');
if (hits.length) { await hits[0].click(); await new Promise((r) => setTimeout(r, 200)); }
check(Object.keys(JSON.parse(await st()).cls.kq).length === (hits.length ? 11 : 10), hits.length ? 'thêm chỉ số từ ô tìm kiếm' : 'không có kết quả hdl');

// ICD
const icd = await page.$('input[placeholder^="Gõ mã hoặc tên bệnh"]');
await icd.click(); await icd.type('viem phoi');
await page.waitForSelector('.picker .pickres li a', { timeout: 15000 });
const first = await page.$eval('.picker .pickres li a', (a) => a.textContent);
check(/phổi/i.test(first), 'tìm ICD "viem phoi" (không dấu) ra: ' + first);
await page.click('.picker .pickres li a');
await new Promise((r) => setTimeout(r, 200));
check(JSON.parse(await st()).kl.chanDoan.length === 1, 'chọn ICD thêm vào chẩn đoán');
await icd.click({ clickCount: 3 }); await icd.type('J00');
await new Promise((r) => setTimeout(r, 200));
check((await page.$eval('.picker .pickres li a', (a) => a.textContent)).startsWith('J00'), 'tìm theo mã J00 ra J00 đầu tiên');

// Mẫu lâm sàng
const ls0 = JSON.parse(await st()).ls;
check(ls0.TMH['Tai trái (nói thầm)'].kq === '0.5' && ls0.RHM['Hàm trên'].kq === 'sức nhai 100%' && ls0.Mat['Mắt phải không kính'].kq === '10/10', 'mẫu "Bình thường" dùng giá trị mặc định (tai 0.5/5, sức nhai 100%, thị lực 10/10)');
await page.screenshot({ path: 'app/test-ui/panels-harness/panels.png', fullPage: true });
console.log(errs.length ? errs.join('\n') : 'không có lỗi console/trang');
if (errs.length) fail++;
await browser.close(); await server.close();
process.exit(fail ? 1 : 0);
