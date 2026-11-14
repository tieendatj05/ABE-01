// KIỂM TRA màn "Khám sức khỏe định kỳ" của nhân viên nhập liệu (nhaplieu01) trên bản tạm: chọn bệnh nhân → Sửa → Lưu.
// Phải thấy: (1) phiếu KHÔNG bị xoá trắng sau khi bấm Lưu, (2) số "Chưa liên thông" giảm khi lưu thông tin hành chính.
//   npx tsx app/test-ui/exam-save-check.ts      (cần npm run web:build)
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';
import { createServer as createNet } from 'node:net';
import { tmpdir } from 'node:os';
import { startGateway, bytPublicKey } from '../../security/src/deploy/byt.js';
import { MedClient } from '../../security/src/client/medclient.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';

const dist = resolve('app/web/dist');
const shots = resolve('.test-runs/exam-save');
mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync)!;
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const dataDir = join(tmpdir(), 'medabe-examsave-' + Date.now()); mkdirSync(dataDir, { recursive: true });
const bytPort = await new Promise<number>((res) => { const sv = createNet().listen(0, () => { const pt = (sv.address() as { port: number }).port; sv.close(() => res(pt)); }); });
const stack = await startResearchStack({ dataDir, passwordIterations: 20000, legacyBridge: true, env: { MEDABE_BYT_URL: 'http://127.0.0.1:' + bytPort, MEDABE_BYT_PK: bytPublicKey(dataDir) } });
const gw = startGateway({ dataDir, port: bytPort, registryPk: stack.registryPk });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.bin': 'application/octet-stream' };
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

try {
  const td = await MedClient.signIn(stack.baseUrl, 'nhaplieu01', pw('nhaplieu01'), new MemoryDeviceKeyStore(), { fetch: stack.fetch });
  const unit = UNITS[0].ma;
  const people = Array.from({ length: 6 }, (_, i) => ({ ...blank.hanhchinh(), hoTen: `NGUYEN VAN TEST ${i + 1}`, cccd: `9990000009${String(i + 1).padStart(2, '0')}`, ngaySinh: '1980-05-1' + (i + 1), nguonChiTra: 'BHYT', gioiTinh: 'nam' as const, dienThoai: '0900000000' }));
  const tdc = await MedClient.signIn(stack.baseUrl, 'tiepdon01', pw('tiepdon01'), new MemoryDeviceKeyStore(), { fetch: stack.fetch });
  await tdc.saveMany([{ patientCode: '999000000990', type: 'hanhchinh' as const, khoa: 'KSK', data: { ...blank.hanhchinh(), hoTen: 'NGUOI DO TIEP DON NHAP', cccd: '999000000990', ngaySinh: '2012-01-01', nguonChichi: '', nguonChiTra: 'BHYT' }, group: unit }]);
  await td.saveMany(people.map((p) => ({ patientCode: p.cccd, type: 'hanhchinh' as const, khoa: 'KSK', data: p, group: unit })));

  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  page.on('dialog', (d) => { console.log('dialog:', d.type(), d.message().slice(0, 120)); void (d.type() === 'prompt' ? d.accept('Mau thu nghiem') : d.accept()); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon') && !r.url().includes('/api/enrollment')) console.log('HTTP', r.status(), r.request().method(), new URL(r.url()).pathname); });
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string) => page.evaluate((s, l) => (Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click(), sel, label);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const nameValue = () => page.evaluate(() => (document.querySelector('#sec-hanhchinh input') as HTMLInputElement | null)?.value ?? '');
  const tabCount = (label: string) => page.evaluate((l) => { const a = Array.from(document.querySelectorAll('.tabsrow a')).find((e) => e.textContent?.startsWith(l)); return Number(/\((\d+)\)/.exec(a?.textContent ?? '')?.[1] ?? -1); }, label);

  await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
  await page.type('input[autocomplete="username"]', 'nhaplieu01');
  await page.type('input[autocomplete="current-password"]', pw('nhaplieu01'));
  await clickText('button', 'Đăng nhập');
  await waitText('NGUYEN VAN TEST 1', 90_000);
  const before = await tabCount('Chưa liên thông');
  console.log('Chưa liên thông trước:', before, '| Đã liên thông:', await tabCount('Đã liên thông'));

  // chọn bệnh nhân
  await page.evaluate(() => (Array.from(document.querySelectorAll('.grid tbody tr')).find((r) => r.textContent?.includes('NGUYEN VAN TEST 2')) as HTMLElement).click());
  await sleep(2500);
  check('bấm một dòng: phiếu hiện đúng họ tên', (await nameValue()).includes('NGUYEN VAN TEST 2'), await nameValue());
  await page.screenshot({ path: join(shots, '1-chon.png') });

  // sửa + lưu
  await clickText('.op', 'Sửa');
  await page.evaluate(() => { const i = Array.from(document.querySelectorAll('#sec-hanhchinh input')).find((e) => (e as HTMLInputElement).placeholder.includes('điện thoại')) as HTMLInputElement; i.focus(); });
  const ph = await page.$('#sec-hanhchinh input[placeholder*="điện thoại"]');
  await ph!.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.type('0911222333'); await sleep(300);
  console.log('  ô điện thoại sau khi gõ:', await page.evaluate(() => { const i = document.querySelector('#sec-hanhchinh input[placeholder*="điện thoại"]') as HTMLInputElement; return i.value + ' disabled=' + i.disabled + ' readOnly=' + i.readOnly; }), '| nav:', await page.evaluate(() => document.querySelector('.side nav')?.textContent));
  await clickText('.op', 'Lưu');
  for (let i = 0; i < 12; i++) { await sleep(1000); const v = await nameValue(); if (i === 1 || i === 4 || i === 10) console.log(`  +${i + 1}s ô họ tên: "${v}" | chưa LT=${await tabCount('Chưa liên thông')} | đã LT=${await tabCount('Đã liên thông')}`); }
  console.log('  nhật ký:', (await page.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '')).slice(0, 400));
  const after = await tabCount('Chưa liên thông');
  const t = await text();
  check('sau Lưu: phiếu KHÔNG bị trắng (vẫn hiện họ tên đã chọn)', (await nameValue()).includes('NGUYEN VAN TEST 2'), JSON.stringify(await nameValue()));
  check('sau Lưu: không bị văng "Chưa kết nối máy chủ"', !/Chưa kết nối máy chủ KSK/.test(t));
  check('sau Lưu: số "Chưa liên thông" giảm', after === before - 1, `${before} → ${after}`);
  await page.screenshot({ path: join(shots, '2-sau-luu.png') });

  // rời sang Quản lý hồ sơ (chọn người khác ở đó) rồi quay lại: phiếu phải mở đúng người đã chọn, không trắng
  await clickText('.menubar a', 'Quản lý hồ sơ');
  await waitText('NGUYEN VAN TEST 4');
  await page.evaluate(() => (Array.from(document.querySelectorAll('.grid tbody tr')).find((r) => r.textContent?.includes('NGUYEN VAN TEST 4')) as HTMLElement).click());
  await sleep(1500);
  await clickText('.menubar a', 'Khám sức khỏe định kỳ');
  await sleep(4000);
  check('chọn người ở Quản lý hồ sơ rồi sang Khám sức khỏe: phiếu mở đúng người đó (không trắng)', (await nameValue()).includes('NGUYEN VAN TEST 4'), JSON.stringify(await nameValue()));
  await page.screenshot({ path: join(shots, '3-quay-lai.png') });

  // hồ sơ do tài khoản khác nhập (tiếp đón) KHÔNG xuất hiện với nhập liệu (máy chủ chỉ trả về hồ sơ người này đọc được)
  await clickText('.menubar a', 'Khám sức khỏe định kỳ');
  await sleep(3000);
  check('nhập liệu không thấy hồ sơ do tiếp đón nhập (chỉ thấy hồ sơ mình nhập)', !/NGUOI DO TIEP DON NHAP/.test(await text()) && /NGUYEN VAN TEST 1/.test(await text()));

  // kiểm tra trùng CCCD khi nhập người mới
  await clickText('.op', 'Mới');
  await sleep(500);
  const cc = await page.$('#sec-hanhchinh input[placeholder*="CCCD"]');
  await cc!.focus(); await page.keyboard.type(people[2].cccd); await sleep(400);
  check('nhập người mới trùng CCCD: có cảnh báo trùng', /đã có trong đơn vị/.test(await text()));

  // lưu / xoá mẫu mặc định (khám lâm sàng)
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button.act')).find((e) => e.textContent?.includes('Lưu mẫu')) as HTMLElement; b.click(); });
  await sleep(500);
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll('.stripactions select option')).map((o) => o.textContent));
  check('Lưu mẫu: mẫu mới xuất hiện trong danh sách Load', opts.some((o) => o?.includes('Mau thu nghiem')), JSON.stringify(opts.slice(-2)));
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button.act')).find((e) => e.textContent?.includes('Xóa mẫu')) as HTMLElement; b.click(); });
  await sleep(500);
  const opts2 = await page.evaluate(() => Array.from(document.querySelectorAll('.stripactions select option')).map((o) => o.textContent));
  check('Xóa mẫu: mẫu đã bị xóa', !opts2.some((o) => o?.includes('Mau thu nghiem')));
  const units = await page.evaluate(() => Array.from(document.querySelectorAll('select option')).map((o) => o.textContent ?? ''));
  check('danh sách "Công ty" có sẵn các trường cũ (không phụ thuộc trình duyệt)', ['PHÚ AN', 'TÍN ĐỨC', 'CHU VĂN AN', 'VÕ TRƯỜNG TOẢN', 'Xuân Hòa'].every((n) => units.some((u) => u.includes(n))));
} catch (e) {
  console.error('LỖI:', e); failed++;
  try { const pg = (await browser.pages()).at(-1); await pg?.screenshot({ path: join(shots, 'error.png') }); } catch { /* ignore */ }
} finally {
  await browser.close(); web.close(); gw.server.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nNHẬP LIỆU: tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
