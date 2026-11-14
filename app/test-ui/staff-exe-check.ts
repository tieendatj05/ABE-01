// CHẠY THẬT file .exe nhân viên đã đóng gói (release/KSK-NhanVien-TaiKhoan-win32-x64) và điều khiển qua DevTools Protocol:
// màn đầu tiên phải là ĐĂNG NHẬP; đăng nhập bằng tài khoản → vào app, kết nối máy chủ HTTPS, thấy đúng menu. Cần máy chủ cổng 8443 (địa chỉ đóng gói sẵn).
//   npx tsx app/test-ui/staff-exe-check.ts       (hiện cửa sổ app vài chục giây)
import { X509Certificate, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';

const exe = resolve('release/KSK-NhanVien-TaiKhoan-win32-x64/KSK-NhanVien-TaiKhoan.exe');
if (!existsSync(exe)) throw new Error('Chưa đóng gói: xem NGHIEN_CUU_CPABE/02 mục 9');
const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true, ports: { spring: 8443 } });
const spki = createHash('sha256').update(new X509Certificate(readFileSync(join(stack.tlsDir, 'server.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
// MEDABE_TEST bật cổng gỡ lỗi (như app/test-ui/desktop-check.mjs với APP_EXE); MEDABE_USER_DATA = thư mục dữ liệu TẠM để không đụng dữ liệu thật của app.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
const app = spawn(exe, ['--remote-debugging-port=9333', `--ignore-certificate-errors-spki-list=${spki}`], { stdio: 'ignore', env: { ...env, MEDABE_TEST: '1', MEDABE_USER_DATA: mkdtempSync(join(tmpdir(), 'ksk-exe-')) } });
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };
try {
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333' }); } catch { await new Promise((r) => setTimeout(r, 1000)); } }
  if (!browser) throw new Error('Không kết nối được DevTools của app (app có thể đã chặn cổng gỡ lỗi)');
  const page = (await browser.pages()).find((p) => p.url().startsWith('file://')) ?? (await browser.pages())[0];
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  await waitText('Đăng nhập MedABE', 60_000);
  check('app .exe đóng gói: màn đầu tiên là ĐĂNG NHẬP email + mật khẩu', !/Chào mừng đến MedABE/.test(await text()));
  check('app chạy trong Electron (có cầu nối desktop)', await page.evaluate(() => !!(globalThis as unknown as { medabe?: unknown }).medabe));
  const u = DEMO_USERS.find((x) => x.username === 'tiepdon01')!;
  await page.type('input[autocomplete="username"]', u.username);
  await page.type('input[autocomplete="current-password"]', u.password);
  await page.evaluate(() => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Đăng nhập')) as HTMLElement).click());
  await waitText('Đã kết nối', 90_000);
  const t = await text();
  check('đăng nhập thành công trong app đóng gói, kết nối máy chủ HTTPS', /Đã kết nối: https:\/\/(localhost|127\.0\.0\.1):8443/.test(t) && /Tiep don 01/.test(t));
  check('Tiếp đón thấy menu Import Excel và Khám sức khỏe', /Import Excel/.test(t) && /Khám sức khỏe định kỳ/.test(t));
  await browser.disconnect();
} catch (e) { console.error('LỖI:', e); failed++; }
finally {
  try { process.kill(app.pid!); } catch { /* đã thoát */ }
  await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nAPP .EXE ĐÓNG GÓI: tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
