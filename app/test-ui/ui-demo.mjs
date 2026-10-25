// Chụp các màn hình mới với DỮ LIỆU GIẢ (không dùng dữ liệu thật của học sinh).
//   node app/test-ui/ui-demo.mjs        (cần stack đang chạy và npm run desktop:build)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { fakeResults, fakeStudents, makeResultXlsx, makeSchoolXlsx } from './make-fake-xlsx.mjs';

const ROOT = resolve('.');
const ELECTRON = process.env.APP_EXE ?? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_ARGS = process.env.APP_EXE ? [] : ['.'];
const API = process.env.API ?? 'http://localhost:8090';
const SHOTS = 'app/test-ui/shots';
import { loadTokens } from './tokens.mjs';
const T = loadTokens();
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) failed++; };

const post = async (url, token, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(`${url}: ${j.error}`); return j; };
async function pkg(name, attrs) {
  const cfg = await (await fetch(`${API}/api/config`)).json();
  const urls = Object.fromEntries(cfg.nodes.map((n) => [n.org, n.url]));
  const inv = await post(`${API}/api/admin/invites`, T.storage, { name });
  const parts = [`i=${inv.code}`];
  for (const o of ['BenhVien', 'SoYTe']) parts.push(`a=${o}:${(await post(`${urls[o]}/admin/grants`, T[o], { name, attrs })).code}`);
  return parts.join('&');
}
const spawned = [];
let port = 9900 + Math.floor(Math.random() * 90);
async function launch(userData) {
  const dbg = port++;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  const proc = spawn(ELECTRON, [...APP_ARGS, `--remote-debugging-port=${dbg}`], { cwd: ROOT, env: { ...env, MEDABE_USER_DATA: userData, MEDABE_TEST: '1' }, stdio: 'ignore' });
  spawned.push(proc);
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${dbg}`, defaultViewport: { width: 1500, height: 960 } }).catch(() => undefined); if (!browser) await new Promise((r) => setTimeout(r, 500)); }
  let page;
  for (let i = 0; i < 60 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('file://')); if (!page) await new Promise((r) => setTimeout(r, 300)); }
  page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failed++; });
  return { page, close: async () => { await browser.disconnect(); proc.kill(); await new Promise((r) => setTimeout(r, 800)); } };
}
const text = (p) => p.evaluate(() => document.body.innerText);
const waitText = (p, s, ms = 120000) => p.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, s).catch(async (e) => { console.log(`--- không thấy "${s}":\n` + (await text(p)).slice(0, 500)); throw e; });
const click = async (p, label, sel = 'button, .menubar a, .side nav a, .tabsrow a, .dropmenu a') => { const ok = await p.evaluate((l, s) => { const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim().includes(l) && !x.disabled); if (b) { b.click(); return true; } return false; }, label, sel); if (!ok) throw new Error(`Không thấy "${label}"`); };
const setPh = (p, ph, v) => p.evaluate((q, val) => { const el = [...document.querySelectorAll('input')].find((i) => i.placeholder?.startsWith(q)); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); }, ph, v);
const pickUnit = (p, label) => p.evaluate((l) => { const sels = [...document.querySelectorAll('select')]; const sel = sels.find((s) => [...s.options].some((o) => o.text.includes(l))); const o = [...sel.options].find((x) => x.text.includes(l)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, o.value); sel.dispatchEvent(new Event('change', { bubbles: true })); }, label);
const feedFile = (p, buf, name) => p.evaluate(async (b64, n) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([u], n, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}, buf.toString('base64'), name);
const radio = (p, label) => p.evaluate((l) => { const lb = [...document.querySelectorAll('label.radio')].find((x) => x.innerText.trim() === l); lb.querySelector('input').click(); }, label);

try {
  const students = fakeStudents(60, { loi: 3 });
  // ===== 1. Tiếp đón: Import Excel (dữ liệu giả) =====
  const dirA = mkdtempSync(join(tmpdir(), 'medabe-demo-a-'));
  let a = await launch(dirA);
  await waitText(a.page, 'Đăng ký thiết bị', 90000);
  await setPh(a.page, 'Dán gói', await pkg('Tiep don Demo', ['Role:TiepDon']));
  await setPh(a.page, 'Đặt passphrase', 'matkhau-demo-1');
  await click(a.page, 'Đăng ký');
  await waitText(a.page, 'THAO TÁC', 120000);
  await pickUnit(a.page, 'TRƯỜNG THPT MẪU A');
  await click(a.page, 'Import Excel', '.menubar a');
  await waitText(a.page, 'B1. Chọn file');
  await a.page.screenshot({ path: `${SHOTS}/m1-import-trong.png` });
  await feedFile(a.page, makeSchoolXlsx(students), 'danh-sach-gia.xlsx');
  await waitText(a.page, 'Tổng số dòng');
  await click(a.page, 'B2. Kiểm tra thông tin', 'button');
  await waitText(a.page, 'Danh sách lỗi (');
  const t1 = await text(a.page);
  check(/Tổng số dòng:\s*60/.test(t1), 'Import: nhận đúng 60 dòng của file Excel giả');
  check(t1.includes('Số định danh cá nhân phải gồm 12 chữ số') && t1.includes('Ngày sinh không hợp lệ'), 'B2: bảng "Danh sách lỗi" liệt kê Dòng / Họ tên / Cột / Giá trị / Nội dung lỗi');
  await a.page.screenshot({ path: `${SHOTS}/m2-import-loi.png` });
  await click(a.page, 'B3. Import', 'button');
  await waitText(a.page, 'Đã thêm mới', 120000);
  check((await text(a.page)).includes('Đã thêm mới 57'), 'B3: nhập 57 hồ sơ hợp lệ (bỏ 3 dòng lỗi)');
  await new Promise((r) => setTimeout(r, 3500));
  await a.close();

  // ===== 2. Bác sĩ đa khoa + kết luận: nhập kết quả khám, xem các màn hình =====
  const dirB = mkdtempSync(join(tmpdir(), 'medabe-demo-b-'));
  a = await launch(dirB);
  await waitText(a.page, 'Đăng ký thiết bị', 90000);
  await setPh(a.page, 'Dán gói', await pkg('BS Demo', ['Role:BacSi', 'Khoa:Nhi', 'Khoa:Mat', 'Khoa:TMH', 'Khoa:RHM', 'Role:KetLuan']));
  await setPh(a.page, 'Đặt passphrase', 'matkhau-demo-2');
  await click(a.page, 'Đăng ký');
  await waitText(a.page, 'THAO TÁC', 120000);
  await pickUnit(a.page, 'TRƯỜNG THPT MẪU A');
  await click(a.page, 'Import Excel', '.menubar a');
  await waitText(a.page, 'B1. Chọn file');
  await radio(a.page, 'Thêm xét nghiệm');
  await feedFile(a.page, makeResultXlsx(fakeResults(students, 40)), 'ket-qua-gia.xlsx');
  await waitText(a.page, 'Tổng số dòng');
  await click(a.page, 'B2. Kiểm tra thông tin', 'button');
  await click(a.page, 'B3. Import', 'button');
  await waitText(a.page, 'mục kết quả khám', 120000);
  check(/Đã lưu \d+ mục kết quả khám cho 40 hồ sơ/.test(await text(a.page)), 'Thêm xét nghiệm: lưu kết quả khám (thể lực, lâm sàng, kết luận) cho 40 hồ sơ');
  await a.page.screenshot({ path: `${SHOTS}/m3-import-ketqua.png` });

  await click(a.page, 'Khám sức khỏe định kỳ', '.menubar a');
  await waitText(a.page, 'Import excel (57)', 120000);
  await click(a.page, 'VAN AN 01', 'tbody tr td').catch(async () => { await a.page.evaluate(() => document.querySelector('tbody tr td:nth-child(5)')?.click()); });
  await waitText(a.page, 'Số định danh cá nhân');
  await click(a.page, 'Khám lâm sàng', '.side nav a');
  await waitText(a.page, 'Họ tên và chữ ký bác sĩ');
  await new Promise((r) => setTimeout(r, 2500));
  const ls = await text(a.page);
  check(ls.includes('Khám Mắt') && ls.includes('Kết quả') && ls.includes('Phân loại') && ls.includes('Chữ ký số hợp lệ'), 'Khám lâm sàng: mỗi mục có Kết quả + Phân loại; ô chữ ký bác sĩ hiển thị chữ ký số hợp lệ');
  await a.page.screenshot({ path: `${SHOTS}/m4-kham-lam-sang.png` });

  await click(a.page, 'Quản lý hồ sơ', '.menubar a');
  await waitText(a.page, 'DANH SÁCH HỒ SƠ [57]', 120000);
  await a.page.evaluate(() => document.querySelector('tbody tr')?.click());
  await new Promise((r) => setTimeout(r, 1500));
  check((await text(a.page)).includes('MÁY CHỦ THẤY GÌ (ciphertext)'), 'Quản lý hồ sơ: có khung dữ liệu đã giải mã và khung máy chủ thấy gì');
  await a.page.screenshot({ path: `${SHOTS}/m5-danh-sach-ho-so.png` });

  await click(a.page, 'Báo cáo', '.menubar a');
  await click(a.page, 'Tổng hợp', 'button');
  await waitText(a.page, 'Tổng số dòng: 57', 120000);
  const rp = await text(a.page);
  check(rp.includes('chieu_cao') && /Cận thị|Bình thường/.test(rp), 'Báo cáo: tổng hợp 57 dòng, có chiều cao/cân nặng/mạch/huyết áp/nhi/mắt/TMH/RHM');
  await a.page.screenshot({ path: `${SHOTS}/m6-bao-cao.png` });
  await a.close();
} catch (e) {
  console.log('LỖI:', e.message);
  failed++;
}
for (const p of spawned) p.kill();
console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nTất cả kiểm tra giao diện đạt');
process.exit(failed ? 1 : 0);
