// Bản "user" KHÔNG chứa mã quản trị: kiểm tra cả trong file đã build lẫn khi chạy thật.
//   node app/test-ui/user-edition-check.mjs        (tự build bản user, thử, rồi build lại bản admin)
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve('.');
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
let failed = 0;
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) failed++; };
const build = (ed) => execFileSync(process.execPath, ['app/desktop/build.mjs', ed], { cwd: ROOT, stdio: 'pipe' });

const scan = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scan(join(dir, e.name)) : [join(dir, e.name)]));
const bundles = () => [...scan('app/desktop/dist'), ...scan('app/web/dist').filter((f) => f.endsWith('.js'))].map((f) => readFileSync(f, 'utf8')).join('\n');
// Những chuỗi chỉ tồn tại trong mã quản trị
const MARKERS = ['admin:call', 'admin:unlock', 'admin:enroll', 'MEDABE-ADMIN1', 'Cấp nhanh nhân sự', 'Nhập mật khẩu quản trị', 'Gỡ kích hoạt trạm quản trị'];

let proc;
try {
  build('admin');
  const adminCode = bundles();
  check(MARKERS.every((m) => adminCode.includes(m)), 'Bản admin chứa mã quản trị (đối chứng)');

  build('user');
  const userCode = bundles();
  const found = MARKERS.filter((m) => userCode.includes(m));
  check(found.length === 0, `Bản USER: không còn dấu vết mã quản trị trong file đã build${found.length ? ' (còn: ' + found.join(', ') + ')' : ''}`);

  const dbg = 15000 + Math.floor(Math.random() * 20000);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${dbg}`, '--admin-setup'], { cwd: ROOT, env: { ...env, MEDABE_USER_DATA: mkdtempSync(join(tmpdir(), 'medabe-user-')), MEDABE_TEST: '1' }, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${dbg}`, defaultViewport: null }).catch(() => undefined); if (!browser) await new Promise((r) => setTimeout(r, 500)); }
  let page;
  for (let i = 0; i < 60 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('file://')); if (!page) await new Promise((r) => setTimeout(r, 300)); }
  await new Promise((r) => setTimeout(r, 6000));
  const r = await page.evaluate(() => ({ hasAdminBridge: typeof medabe.admin !== 'undefined', menu: document.querySelector('.menubar').innerText, desktop: medabe.desktop }));
  check(r.desktop === true && r.hasAdminBridge === false, 'Bản USER chạy thật: cầu nối quản trị KHÔNG tồn tại (kể cả khi cố mở bằng --admin-setup)');
  check(!r.menu.includes('Quản trị bảo mật') && r.menu.includes('Khoá của tôi'), 'Bản USER chạy thật: menu quản trị không hiện; chức năng của người dùng vẫn có');
  const keys = await page.evaluate(() => Object.keys(window.medabe));
  check(!keys.some((k) => /admin|invoke|ipc/i.test(k)), `Bản USER: cầu nối chỉ lộ các hàm của người dùng (${keys.join(', ')}) - không có đường gọi IPC quản trị`);
  await browser.disconnect();
} catch (e) {
  console.log('LỖI:', e.message);
  failed++;
}
proc?.kill();
try { build('admin'); console.log('(đã build lại bản admin)'); } catch { /* bỏ qua */ }
console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nTất cả kiểm tra bản user đạt');
process.exit(failed ? 1 : 0);
