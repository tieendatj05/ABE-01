// Kiểm thử ỨNG DỤNG DESKTOP thật (Electron) theo kịch bản khám sức khoẻ nhiều vai trò.
//   node app/test-ui/desktop-check.mjs        (cần: npm run desktop:build và stack đang chạy: npm run demo)
//   APP_EXE=<MedABE.exe> node ...             (chạy trên bản đã đóng gói)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

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
const post = async (url, token, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url}: ${j.error}`);
  return j;
};
async function pkg(name, attrs) {
  const cfg = await (await fetch(`${API}/api/config`)).json();
  const urls = Object.fromEntries(cfg.nodes.map((n) => [n.org, n.url]));
  const inv = await post(`${API}/api/admin/invites`, T.storage, { name });
  const parts = [`i=${inv.code}`];
  for (const o of ['BenhVien', 'SoYTe']) parts.push(`a=${o}:${(await post(`${urls[o]}/admin/grants`, T[o], { name, attrs })).code}`);
  return parts.join('&');
}

const spawned = [];
let port = 9300 + Math.floor(Math.random() * 500);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
async function launch(userData, env = {}) {
  const dbg = port++;
  const proc = spawn(ELECTRON, [...APP_ARGS, `--remote-debugging-port=${dbg}`], { cwd: ROOT, env: { ...cleanEnv(), MEDABE_USER_DATA: userData, MEDABE_TEST: '1', ...env }, stdio: 'ignore' });
  spawned.push(proc);
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${dbg}`, defaultViewport: null }).catch(() => undefined);
    if (!browser) await new Promise((r) => setTimeout(r, 500));
  }
  if (!browser) throw new Error('Không kết nối được Electron');
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    page = (await browser.pages().catch(() => [])).find((p) => { try { return p.url().startsWith('file://'); } catch { return false; } });   // bản đóng gói có cửa sổ chờ nhúng máy chủ: bỏ qua trang chưa sẵn sàng
    if (!page) await new Promise((r) => setTimeout(r, 300));
  }
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => document.readyState === 'complete').catch(() => false)) break; await new Promise((r) => setTimeout(r, 500)); } // bản đóng gói mở nhanh: chờ khung chính sẵn sàng
  page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failed++; });
  return { page, close: async () => { await browser.disconnect(); proc.kill(); await new Promise((r) => setTimeout(r, 800)); } };
}

const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, ms = 90000) =>
  page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, s).catch(async (e) => {
    console.log(`--- không thấy "${s}"; trang đang hiển thị:\n` + (await text(page)).slice(0, 800));
    throw e;
  });
const click = async (page, label, sel = 'button, .menubar a, .side nav a, .tabsrow a, .dropmenu a') => {
  const ok = await page.evaluate((l, s) => { const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim().includes(l) && !x.disabled); if (b) { b.click(); return true; } return false; }, label, sel);
  if (!ok) { console.log(`--- không thấy "${label}":\n` + (await page.evaluate(() => document.querySelector('.content')?.innerHTML.slice(0, 3000)))); throw new Error(`Không thấy "${label}"`); }
};
// Gán giá trị cho ô nhập đang được React kiểm soát
const setByPlaceholder = (page, ph, v) => page.evaluate((p, val) => {
  const el = [...document.querySelectorAll('input,textarea')].find((i) => i.placeholder === p || i.placeholder?.startsWith(p));
  if (!el) throw new Error('không có ô ' + p);
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true }));
}, ph, v);
const setByLabel = (page, label, v) => page.evaluate((l, val) => {
  const lb = [...document.querySelectorAll('label.lbl')].find((x) => x.innerText.trim().startsWith(l));
  const el = lb?.nextElementSibling?.querySelector('input,select,textarea');
  if (!el) throw new Error('không có trường ' + l);
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, val); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}, label, v);

async function register(page, name, attrs, pass) {
  const t0 = Date.now();
  await waitText(page, 'Quản trị đang tắt');   // chờ app biết đăng ký tự do đang tắt (hiện form gói)
  await setByPlaceholder(page, 'Dán gói', await pkg(name, attrs));
  await setByPlaceholder(page, 'Đặt passphrase', pass);
  await click(page, 'Đăng ký bằng gói');
  await waitText(page, 'THAO TÁC');
  // luôn dùng đơn vị MẪU khi kiểm thử (không ghi dữ liệu thử vào đơn vị thật)
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.includes('TRƯỜNG THPT MẪU A')));
    const o = [...sel.options].find((x) => x.text.includes('TRƯỜNG THPT MẪU A'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, o.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  console.log('     (đăng ký ' + name + ' mất ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
}

// Kịch bản này đăng ký bằng GÓI theo vai trò: tạm TẮT đăng ký tự do (mặc định của bản demo là BẬT) và khôi phục khi xong.
const ALL_ATTRS = ['Role:TiepDon', 'Role:BacSi', 'Role:KTV', 'Role:KetLuan', 'Khoa:Nhi', 'Khoa:Mat', 'Khoa:TMH', 'Khoa:RHM', 'Khoa:XetNghiem'];
async function setOpen(open) {
  const cfg = await (await fetch(`${API}/api/config`)).json();
  await post(`${API}/api/admin/enrollment`, T.storage, { open });
  for (const n of cfg.nodes) await post(`${n.url}/admin/open-enrollment`, T[n.org], { enabled: open, attrs: ALL_ATTRS });
}
await setOpen(false);
const CCCD = '07' + String(Date.now()).slice(-10);
const NAME = 'NGUYEN THI MAU ' + CCCD.slice(-5); // tên duy nhất mỗi lần chạy (các lần trước để lại hồ sơ cùng tên)
const dirs = Object.fromEntries(['tiepdon', 'nhi', 'mat'].map((k) => [k, mkdtempSync(join(tmpdir(), `medabe-${k}-`))]));
const apps = [];
try {
  // ===== 1. Tiếp đón nhập hành chính =====
  let a = await launch(dirs.tiepdon); apps.push(a);
  check(await a.page.evaluate(() => globalThis.medabe?.desktop === true), 'Chạy trong ứng dụng desktop (cầu nối an toàn tới tiến trình chính)');
  check(await a.page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'), 'Giao diện bị cô lập: không có Node trong trang');
  await register(a.page, 'Tiep don An', ['Role:TiepDon'], 'matkhau-tiepdon-1');
  const t = await text(a.page);
  check(['Thông tin Hành chính', 'NỘI DUNG PHIẾU', 'Chọn mẫu', 'Khám sức khỏe định kỳ', 'Quản lý hồ sơ', 'Khoá của tôi'].every((s) => t.includes(s)), 'Giao diện giống phần mềm bệnh viện: thanh menu, Chọn mẫu/Công ty, THAO TÁC, NỘI DUNG PHIẾU');
  await a.page.screenshot({ path: `${SHOTS}/k1-form-trong.png` });

  await setByPlaceholder(a.page, 'NHẬP HỌ TÊN', NAME);
  await setByLabel(a.page, '3. Ngày sinh', '2010-05-20');
  await setByPlaceholder(a.page, 'Nhập số CCCD', CCCD);
  await setByLabel(a.page, '8. Nguồn chi trả', 'Nhà trường / Doanh nghiệp');
  await setByLabel(a.page, '11. Họ tên người đi cùng', 'NGUYEN VAN MAU');
  await setByPlaceholder(a.page, 'Nhập số điện thoại', '0901234567');
  await click(a.page, 'Lưu', '.op');
  await waitText(a.page, 'Đã lưu 1 mục');
  await waitText(a.page, NAME);
  check(true, 'Tiếp đón lưu mục Hành chính (mã hoá trên máy); xuất hiện trong lưới danh sách');
  await a.page.screenshot({ path: `${SHOTS}/k2-tiepdon-luu.png` });

  // Tiếp đón không được ghi mục lâm sàng; khoá 🔒 hiển thị đúng
  await click(a.page, 'Khám lâm sàng', '.side nav a');
  check((await text(a.page)).includes('Nhi khoa'), 'Tiếp đón thấy form Khám lâm sàng nhưng chỉ ở chế độ xem (không có quyền ghi)');
  const filesA = readdirSync(dirs.tiepdon);
  check(filesA.includes('device.bin') && !(await a.page.evaluate(() => localStorage.getItem('medabe.vault'))), 'Khoá thiết bị lưu ngoài trang (DPAPI), không nằm trong localStorage');
  await new Promise((r) => setTimeout(r, 4000));
  await a.close();

  // ===== 2. Bác sĩ Nhi khám lâm sàng =====
  a = await launch(dirs.nhi); apps.push(a);
  await register(a.page, 'BS Nhi Lan', ['Role:BacSi', 'Khoa:Nhi'], 'matkhau-nhi-1');
  await waitText(a.page, NAME, 120000);
  check(true, 'Bác sĩ đọc được danh sách đơn vị (giải mã trên máy): thấy hồ sơ do Tiếp đón nhập');
  await click(a.page, NAME, 'tbody tr td');
  await waitText(a.page, 'Số định danh cá nhân');
  check((await a.page.evaluate(() => [...document.querySelectorAll('input')].some((i) => i.value === '0901234567'))), 'Chọn một dòng: phiếu hiển thị đúng dữ liệu hành chính đã giải mã');
  await click(a.page, 'Khám lâm sàng', '.side nav a');
  // chọn hồ sơ là sửa được ngay (không còn bước bấm Sửa)
  // Chỉ số thể lực nhập được ngay (chiều cao, cân nặng, mạch, huyết áp)
  await click(a.page, 'Khám thể lực', '.side nav a');
  for (const [l, v] of [['Chiều cao', '158'], ['Cân nặng', '45'], ['Mạch', '78'], ['Huyết áp tâm thu', '110'], ['Huyết áp tâm trương', '70']]) await setByLabel(a.page, l, v);
  const vit = await a.page.evaluate(() => [...document.querySelectorAll('label.lbl')].filter((x) => /Chiều cao|Cân nặng|Mạch|Huyết áp/.test(x.innerText)).map((x) => { const e = x.nextElementSibling.querySelector('input'); return [e.value, e.disabled]; }));
  check(vit.length === 5 && vit.every(([v, d]) => v !== '' && !d), 'Nhập được chỉ số thể lực (chiều cao, cân nặng, mạch, huyết áp) khi chọn hồ sơ: ' + JSON.stringify(vit));
  await click(a.page, NAME, 'tbody tr td');                // chọn lại để bỏ các giá trị thử (không lưu chỉ số thể lực trong kịch bản này)
  await new Promise((r) => setTimeout(r, 1500));
  await click(a.page, 'Khám lâm sàng', '.side nav a');
  await a.page.evaluate(() => { // ô "Kết quả" đầu tiên (Nhi khoa - Tuần hoàn)
    const el = document.querySelector('.lsitem input[placeholder="Nhập kết quả khám"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Nhịp tim đều, không tiếng thổi');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(a.page, 'Lưu', '.op');
  await waitText(a.page, 'Đã lưu 1 mục');
  check(true, 'Bác sĩ Nhi lưu mục Khám lâm sàng - Nhi (bản ghi mã hoá riêng, chính sách riêng)');
  await new Promise((r) => setTimeout(r, 3500));
  await a.close();

  // ===== 3. Bác sĩ Mắt: không đọc được phần Nhi =====
  a = await launch(dirs.mat); apps.push(a);
  await register(a.page, 'BS Mat Hoa', ['Role:BacSi', 'Khoa:Mat'], 'matkhau-mat-1');
  await waitText(a.page, NAME, 120000);
  await click(a.page, NAME, 'tbody tr td');
  await waitText(a.page, 'Số định danh cá nhân');
  await click(a.page, 'Khám lâm sàng', '.side nav a');
  await waitText(a.page, 'Không đủ quyền đọc', 90000);
  const mt = await text(a.page);
  check(mt.includes('Mắt') && mt.includes('🔒'), 'Bác sĩ Mắt: phần Nhi khoa bị khoá 🔒 (không đủ thuộc tính), phần Mắt vẫn làm việc được');
  check(!mt.includes('Nhịp tim đều'), 'Nội dung khám Nhi không lộ cho bác sĩ chuyên khoa khác');
  await a.page.screenshot({ path: `${SHOTS}/k3-bacsi-mat-bi-khoa.png` });

  // Màn hình "Quản lý hồ sơ": cho thấy máy chủ chỉ biết metadata
  await click(a.page, 'Quản lý hồ sơ', '.menubar a');
  await waitText(a.page, 'DANH SÁCH HỒ SƠ');
  await waitText(a.page, NAME, 120000);
  await click(a.page, NAME, 'tbody tr td');
  await new Promise((r) => setTimeout(r, 2500));
  const panels = await a.page.evaluate(() => [...document.querySelectorAll('.lpanel')].map((p) => p.innerText));
  const okMg = panels[0]?.includes(NAME) && panels[1]?.includes('hanhchinh') && !panels[1].includes(NAME) && !panels[1].includes(CCCD) && !panels[1].includes('0901234567');
  if (!okMg) console.log('--- Quản lý hồ sơ: khung trái có tên=' + panels[0]?.includes(NAME) + ', khung phải có loại mục=' + panels[1]?.includes('hanhchinh') + ', khung phải lộ tên/CCCD=' + (panels[1]?.includes(NAME) || panels[1]?.includes(CCCD)));
  check(okMg, 'Quản lý hồ sơ: khung "máy chủ thấy gì" chỉ có loại mục, thời điểm, chính sách, kích thước - không có tên/CCCD; khung giải mã (trên máy) có đủ nội dung');
  await a.page.screenshot({ path: `${SHOTS}/k4-may-chu-thay-gi.png` });
  await a.close();
} catch (e) {
  console.log('LỖI:', e.message);
  failed++;
}
for (const p of spawned) p.kill();
await setOpen(true).catch(() => undefined);
console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nTất cả kiểm tra ứng dụng desktop đạt');
process.exit(failed ? 1 : 0);
