// Smoke test bản nhân viên trên Spring + nút cấp khoá riêng, chỉ dùng học sinh giả.
// node --import tsx app/test-ui/employee-recovery-check.mjs
// APP_EXE có thể trỏ tới release/KSK-NhanVien-win32-x64/KSK-NhanVien.exe.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { initDealer, ORGS } from '../../security/src/deploy/init.ts';
import { startDiscovery } from '../../security/src/network/discovery.ts';
import { startNodes, ALL_OPERATIONAL_ATTRS } from '../../security/src/deploy/nodes.ts';
import { fakeStudents, makeSchoolXlsx } from './make-fake-xlsx.mjs';
const ROOT = resolve('.');
mkdirSync('.test-runs', { recursive: true });
const dir = mkdtempSync(resolve('.test-runs/employee-'));
const free = () => new Promise((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const port = await free(), dbg = await free();
const ports = Object.fromEntries(await Promise.all(ORGS.map(async (o) => [o, await free()])));
const api = `http://127.0.0.1:${port}`;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
let spring, app, browser, discovery, nodes = [];
const checks = [];
function check(ok, name) { if (!ok) throw new Error(name); checks.push(name); console.log('OK ' + name); }
try {
  const exe = process.env.APP_EXE ?? resolve('node_modules/electron/dist/electron.exe');
  app = spawn(exe, [...(process.env.APP_EXE ? [] : ['.']), `--remote-debugging-port=${dbg}`], {
    cwd: ROOT, windowsHide: true, stdio: 'ignore',
    env: { ...cleanEnv, MEDABE_USER_DATA: join(dir, 'employee'), MEDABE_TEST: '1', MEDABE_ALLOW_CAPTURE: '1' },
  });
  for (let i = 0; i < 90 && !browser; i++) { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${dbg}`, defaultViewport: { width: 1480, height: 940 } }).catch(() => undefined); if (!browser) await wait(300); }
  if (!browser) throw new Error('Electron did not start');
  let page;
  for (let i = 0; i < 90 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('file://')); if (!page) await wait(300); }
  await page.waitForFunction(() => !!globalThis.medabe, { polling: 100 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss());
  await page.evaluate((base) => medabe.setSetting('storage', base), api);
  await page.reload({ waitUntil: 'domcontentloaded' });
  console.log('Employee UI opened on the isolated endpoint.');
  const text = () => page.evaluate(() => document.body.innerText);
  const has = (t, timeout = 120000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout, polling: 100 }, t);
  const click = async (t, sel = 'button,.menubar a') => { const ok = await page.evaluate((label, selector) => { const e = [...document.querySelectorAll(selector)].find((x) => x.innerText.includes(label) && !x.disabled); e?.click(); return !!e; }, t, sel); if (!ok) throw new Error('Missing control: ' + t); };
  await has('Không kết nối được máy chủ');
  check(true, 'Missing server is reported explicitly');
  check(await page.evaluate(() => !medabe.admin), 'Employee has no admin bridge');
  initDealer(dir);
  const jar = readdirSync('security/storage/target').find((f) => /^medabe-storage-.*\.jar$/.test(f));
  if (!jar) throw new Error('Build storage JAR first');
  spring = spawn('java', ['-XX:TieredStopAtLevel=1', '-jar', resolve('security/storage/target', jar)], {
    windowsHide: true, stdio: 'ignore', env: { ...cleanEnv, PORT: String(port), DB_URL: 'jdbc:h2:mem:employee;DB_CLOSE_DELAY=-1',
      MEDABE_PK_JSON: readFileSync(join(dir, 'dealer/pk.json'), 'utf8'), MEDABE_NODES: ORGS.map((o) => `${o}=http://127.0.0.1:${ports[o]}`).join(','),
      MEDABE_ADMIN_TOKEN: 'test-admin', MEDABE_SERVICE_TOKEN: 'test-service', MEDABE_OPEN_ENROLLMENT: 'true', MEDABE_SIEM_FILE: join(dir, 'siem/events.jsonl') },
  });
  let cfg;
  for (let i = 0; i < 180 && !cfg; i++) { cfg = await fetch(api + '/api/config').then(async (r) => r.ok ? r.json() : null).catch(() => null); if (!cfg) await wait(300); }
  if (!cfg) throw new Error('Isolated storage did not start');
  nodes = startNodes({ ports, dataDir: dir, storageBase: api, registryPk: cfg.registryPk, serviceToken: 'test-service', open: { enabled: true, attrs: ALL_OPERATIONAL_ATTRS } }).servers;
  discovery = startDiscovery({ port, registryPk: cfg.registryPk });
  await click('Kết nối');
  await has('THAO TÁC'); await has('Đã kết nối:');
  check(true, 'Employee recovers when the server starts and registers successfully');
  const fake = fakeStudents(5, { loi: 0 });
  fake[0][22] = 901000001; // numeric Excel phone was previously padded to twelve digits
  await click('Import Excel', '.menubar a'); await has('B1. Chọn file');
  await page.evaluate((b64) => {
    const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([u], 'students-fake.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, makeSchoolXlsx(fake).toString('base64'));
  await has('Tổng số dòng'); await click('B2. Kiểm tra thông tin'); await has('Không có lỗi.');
  await click('B3. Import'); await has('Đã thêm mới 5');
  check(true, 'Excel imports five fake students including a numeric phone');
  await click('Khám sức khỏe định kỳ', '.menubar a'); await has('Import excel (5)');
  check((await text()).includes(fake[0][2]), 'Imported students are visible in the examination list');
  check(await page.evaluate(() => document.querySelector('.listbox .grid tbody').innerText.includes('0901000001')), 'Numeric phone keeps its leading zero');
  await page.evaluate((name) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(name)).click(), fake[0][2]);
  await page.waitForFunction((cccd) => [...document.querySelectorAll('input')].some((e) => e.value === cccd), {}, fake[0][8]);
  await page.evaluate(() => {
    const lb = [...document.querySelectorAll('label.lbl')].find((x) => x.innerText.trim().startsWith('Chiều cao'));
    const input = lb.nextElementSibling.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '156'); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Lưu', '.op'); await has('Đã lưu 1 mục'); await has('Đã liên thông (1)');
  check(true, 'Employee saves an examination section and the list status updates');
  await click('Quản lý hồ sơ', '.menubar a'); await has('DANH SÁCH HỒ SƠ [5]');
  check(true, 'Record manager reads back the five students');
  await page.screenshot({ path: join(dir, 'employee-fake-records.png'), fullPage: true });
  await page.reload(); await has('Đã kết nối:'); await has('Import excel (5)');
  check(true, 'Saved identity auto-unlocks and loads students after restarting the page');
  await page.setOfflineMode(true);
  await has('Chưa kết nối máy chủ KSK', 30000);
  check(await page.evaluate(() => !document.querySelector('.listbox') && !document.querySelector('.lpanels')), 'Disconnect removes student plaintext and the examination UI');
  await click('Import Excel', '.menubar a');
  check(await page.evaluate(() => !document.querySelector('input[type=file]')), 'Employee cannot import or work while offline');
  await page.setOfflineMode(false);
  await has('Đã kết nối:', 30000); await has('Import excel (5)', 30000);
  check(true, 'Employee automatically rediscovers the same server and restores records after reconnect');
  await page.screenshot({ path: join(dir, 'employee-lan-recovered.png'), fullPage: true });
  check(errors.length === 0, 'No renderer errors');
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ passed: checks, api, fakeStudents: 5 }, null, 2));
  console.log('Evidence: ' + dir);
} finally {
  await browser?.disconnect(); app?.kill();
  for (const s of nodes) { s.close(); s.closeAllConnections?.(); }
  discovery?.close(); spring?.kill();
}
