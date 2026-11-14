// KIỂM TRA GIAO DIỆN APP TRA CỨU SỨC KHỎE (app/parent) trên hệ thống thật (Edge/Chrome, máy chủ tạm, dữ liệu GIẢ):
//  1) Đăng nhập tài khoản, tra theo HỌ TÊN và theo CCCD, thấy hồ sơ theo đúng quyền (bác sĩ Mắt thấy Mắt, bác sĩ Nhi thấy cảnh báo "còn mục không được xem").
//  2) CẬP NHẬT NGAY: mở hồ sơ CHƯA có dữ liệu -> "chờ"; máy khác (tiếp đón + người nhập) nhập xong -> app TỰ hiện ra, KHÔNG tải lại trang; đo độ trễ.
//  3) Ảnh người nhập vừa lưu tự xuất hiện ở bác sĩ Mắt (chỉ vùng Mắt, nhãn "GIỚI HẠN"); bác sĩ Nhi không thấy vùng Mắt.
//  4) Quản trị / Giám sát: được hướng dẫn dùng app khác, không đọc dữ liệu ở đây.
// Cần: npm run parent:build + jar Spring.     npx tsx app/test-ui/tra-cuu-ui-check.ts
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
import { LAM_SANG, UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';

const dist = resolve('app/parent/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run parent:build');
const shots = resolve('.test-runs/tra-cuu-ui'); mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const CCCD1 = '999000000511', CCCD2 = '999000000522';
const MAT_MUC = LAM_SANG.find((k) => k.khoa === 'Mat')!.muc[0];

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
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

const login = (u: string) => MedClient.signIn(stack.baseUrl, u, pw(u), new MemoryDeviceKeyStore(), { fetch: stack.fetch });
const td = await login('tiepdon01'), nl = await login('nhaplieu01');
const hc = (hoTen: string, cccd: string) => ({ ...blank.hanhchinh(), hoTen, cccd, ngaySinh: '2012-03-15', gioiTinh: 'nu' as const, lop: '6A' });
// bệnh nhân 1 đã có dữ liệu từ trước; bệnh nhân 2 CHƯA có gì (sẽ được nhập khi app đang mở)
await td.saveMany([{ patientCode: CCCD1, type: 'hanhchinh', khoa: 'KSK', group: UNITS[0].ma, data: hc('LE THI TRA CUU', CCCD1) }]);
await nl.saveRecord({ patientCode: CCCD1, type: 'lamsang', khoa: 'Mat', data: { [MAT_MUC]: { kq: 'MAT-CU-OK', loai: '2' } } });

async function app(user: string) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 430, height: 900, isMobile: true });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 160)); });
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string) => page.evaluate((s, l) => { (Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click(); }, sel, label);
  await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[aria-label="Email"]', { timeout: 30_000 });
  await page.type('input[aria-label="Email"]', user); await page.type('input[aria-label="Mật khẩu"]', pw(user));
  await clickText('button', 'Đăng nhập');
  return { ctx, page, text, waitText, clickText };
}
const toSearch = async (a: Awaited<ReturnType<typeof app>>) => { for (let i = 0; i < 4 && !(await a.page.$('input[aria-label="Tra cứu bệnh nhân"]')); i++) { await a.page.click('button[aria-label="Quay lại"]'); await new Promise((r) => setTimeout(r, 400)); } };
const search = async (a: Awaited<ReturnType<typeof app>>, q: string) => { await a.page.waitForSelector('input[aria-label="Tra cứu bệnh nhân"]', { timeout: 30_000 }); await a.page.click('input[aria-label="Tra cứu bệnh nhân"]', { clickCount: 3 }); await a.page.type('input[aria-label="Tra cứu bệnh nhân"]', q); };

try {
  // ---------- 1) bác sĩ Mắt: tra theo họ tên, thấy đúng phần Mắt
  const mat = await app('bsmat01');
  await mat.waitText('Đã kết nối');
  check('đăng nhập bsmat01 vào app tra cứu: màn hình có ô tra cứu và trạng thái "Đã kết nối"', /Tra cứu bệnh nhân|Họ tên hoặc số CCCD/.test(await mat.text()));
  await search(mat, 'tra cuu');                                                        // không dấu, một phần tên
  await mat.waitText('LE THI TRA CUU', 60_000);
  check('tra theo HỌ TÊN không dấu một phần ("tra cuu") ra đúng bệnh nhân + CCCD', (await mat.text()).includes(CCCD1));
  await mat.clickText('button', 'LE THI TRA CUU');
  await mat.waitText('Khám', 30_000);
  await mat.waitText('Hồ sơ hành chính', 30_000);
  await mat.clickText('button', 'lâm sàng');
  await mat.waitText('MAT-CU-OK', 30_000);
  check('bác sĩ Mắt mở "Khám lâm sàng": thấy kết quả khoa Mắt đã nhập từ trước', true);
  await mat.page.screenshot({ path: join(shots, '1-bsmat-lamsang.png') });
  await toSearch(mat);

  // ---------- 2) CẬP NHẬT NGAY: hồ sơ chưa có gì -> máy khác nhập -> tự hiện
  await search(mat, CCCD2);
  await mat.clickText('button', 'Mở hồ sơ');
  await mat.waitText('Chưa có dữ liệu nào bạn được xem', 30_000);
  check('hồ sơ CHƯA có dữ liệu: app báo đang chờ và hứa tự hiện ("không cần làm mới")', /tự hiện ra trong vài giây/.test(await mat.text()));
  await mat.page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });   // nếu trang bị tải lại thì dấu này mất
  const t0 = Date.now();
  await td.saveMany([{ patientCode: CCCD2, type: 'hanhchinh', khoa: 'KSK', group: UNITS[0].ma, data: hc('NGUYEN VAN NHAP MOI', CCCD2) }]);
  await nl.saveRecord({ patientCode: CCCD2, type: 'lamsang', khoa: 'Mat', data: { [MAT_MUC]: { kq: 'CANARY-LIVE-MAT', loai: '3' } } });
  const saved = Date.now() - t0;
  await mat.waitText('NGUYEN VAN NHAP MOI', 20_000);
  const latency = Date.now() - t0 - saved;
  check('máy khác nhập xong: hồ sơ TỰ HIỆN trong app, không tải lại trang', await mat.page.evaluate(() => (window as unknown as { __marker?: number }).__marker === 1));
  check(`độ trễ từ lúc lưu xong tới lúc hiện: ${latency} ms (yêu cầu < 8 giây)`, latency < 8000, `${latency} ms`);
  console.log(`   (nhập liệu mất ${saved} ms; cập nhật hiện sau ${latency} ms)`);
  await mat.page.screenshot({ path: join(shots, '2-live-hien-ra.png') });
  await mat.clickText('button', 'lâm sàng');
  await mat.waitText('CANARY-LIVE-MAT', 30_000);
  check('mục lâm sàng Mắt vừa nhập hiện đúng nội dung', true);

  // ---------- 3) ảnh vừa lưu tự xuất hiện, chỉ vùng Mắt
  await mat.page.click('button[aria-label="Quay lại"]');
  await mat.clickText('button', 'CT / MRI');
  await mat.waitText('Không có ảnh nào thuộc quyền', 30_000);
  const t1 = Date.now();
  await saveImage(nl, { patientCode: CCCD2, original: { mime: 'image/png', bytes: encodePng(makePhantom(0)) }, pixels: makePhantom(0), modality: 'MRI', regions: [{ rect: PHANTOM.mat, khoas: ['Mat'] }, { rect: PHANTOM.nhiTmh, khoas: ['Nhi', 'TMH'] }] });
  await mat.page.waitForSelector('canvas.imgcanvas', { timeout: 20_000 });
  check(`ảnh người nhập vừa lưu tự hiện ở bác sĩ Mắt sau ${Date.now() - t1} ms (không tải lại)`, true);
  const tm = await mat.text();
  check('bác sĩ Mắt thấy nhãn "GIỚI HẠN" và chỉ vùng Mắt (không thấy "Ảnh gốc đầy đủ")', /GIỚI HẠN/.test(tm) && /Mắt/.test(tm) && !/Ảnh gốc đầy đủ/.test(tm));
  await mat.page.screenshot({ path: join(shots, '3-anh-mat.png') });

  // ---------- 4) bác sĩ Nhi: không thấy Mắt, được cảnh báo còn mục không xem được
  const nhi = await app('bsnhi01');
  await nhi.waitText('Đã kết nối');
  await search(nhi, CCCD2);
  await nhi.clickText('button', 'Mở hồ sơ');
  await nhi.waitText('NGUYEN VAN NHAP MOI', 30_000);
  const tn = await nhi.text();
  check('bác sĩ Nhi: có cảnh báo "không được xem" (mục khoa Mắt bị loại ở máy chủ)', /không được xem/.test(tn));
  await nhi.clickText('button', 'lâm sàng');
  await nhi.waitText('Chưa có kết quả khám lâm sàng', 30_000);
  check('bác sĩ Nhi KHÔNG thấy kết quả Mắt (CANARY-LIVE-MAT không xuất hiện)', !(await nhi.text()).includes('CANARY-LIVE-MAT'));
  await nhi.page.screenshot({ path: join(shots, '4-bsnhi.png') });

  // ---------- 5) Quản trị: không đọc dữ liệu ở app này
  const qt = await app('quantri02');
  await qt.waitText('không đọc dữ liệu sức khỏe', 30_000);
  check('Quản trị: app báo không đọc dữ liệu sức khỏe và hướng dẫn dùng app nhân viên', true);

  // ---------- 6) đăng xuất xoá phiên
  await mat.page.evaluate(() => { document.querySelector<HTMLButtonElement>('button[aria-label="Quay lại"]')?.click(); });
} catch (e) {
  console.log('✗ LỖI:', (e as Error).message); failed++;
} finally {
  await browser.close(); web.close(); await stack.stop();
}
console.log(failed ? `\n${failed} kiểm tra KHÔNG đạt.` : '\nTẤT CẢ ĐẠT.');
process.exit(failed ? 1 : 0);
