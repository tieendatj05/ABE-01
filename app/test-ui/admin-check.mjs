// Kiểm thử "phần bảo mật quản trị chỉ có trên trạm quản trị + đòi mật khẩu" trên ứng dụng desktop THẬT.
//   node app/test-ui/admin-check.mjs   (cần stack đang chạy: npm run demo)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { adminPackage, loadTokens } from './tokens.mjs';

const ROOT = resolve('.');
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const API = process.env.API ?? 'http://localhost:8090';
const T = loadTokens();
const PKG = adminPackage();
// Máy chạy máy chủ tự có sẵn gói kích hoạt (không cần --admin-setup). Kịch bản này kiểm tra trạng thái "máy chưa có gói" nên tạm cất file đi và trả lại khi xong.
import { existsSync as _ex, renameSync as _mv } from 'node:fs';
import { join as _join, resolve as _res } from 'node:path';
const PKG_FILE = _join(_res(process.env.DATA_DIR ?? 'data-demo'), 'admin-package.txt');
if (_ex(PKG_FILE)) _mv(PKG_FILE, PKG_FILE + '.bak');
process.on('exit', () => { try { _mv(PKG_FILE + '.bak', PKG_FILE); } catch { /* không có bản cất */ } });
const PW = 'Quan-tri-That-2026!';
let failed = 0;
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) failed++; };

const spawned = [];
let port = 12000 + Math.floor(Math.random() * 20000); // cổng gỡ lỗi ngẫu nhiên, rộng để không trùng tiến trình của lần chạy trước
async function launch(userData, { args = [], env = {} } = {}) {
  const dbg = port++;
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  const proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${dbg}`, ...args], { cwd: ROOT, env: { ...base, MEDABE_USER_DATA: userData, MEDABE_TEST: '1', ...env }, stdio: 'ignore' });
  spawned.push(proc);
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${dbg}`, defaultViewport: { width: 1400, height: 900 } }).catch(() => undefined); if (!browser) await new Promise((r) => setTimeout(r, 500)); }
  let page;
  for (let i = 0; i < 60 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('file://')); if (!page) await new Promise((r) => setTimeout(r, 300)); }
  page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failed++; });
  await new Promise((r) => setTimeout(r, 1500));
  return { page, close: async () => { await browser.disconnect(); proc.kill(); await new Promise((r) => setTimeout(r, 900)); } };
}
const text = (p) => p.evaluate(() => document.body.innerText);
const waitText = (p, s, ms = 60000) => p.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, s).catch(async (e) => { console.log(`--- không thấy "${s}":\n` + (await text(p)).slice(0, 500)); throw e; });
const click = async (p, label, sel = 'button, .menubar a, .dropmenu a') => { const ok = await p.evaluate((l, s) => { const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim().includes(l) && !x.disabled); if (b) { b.click(); return true; } return false; }, label, sel); if (!ok) throw new Error(`Không thấy "${label}"`); };
const type = (p, ph, v) => p.evaluate((q, val) => { const el = [...document.querySelectorAll('input')].find((i) => i.placeholder?.startsWith(q)); if (!el) throw new Error('không có ô ' + q); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); }, ph, v);
// trạng thái quản trị chỉ xác định sau khi tiến trình chính đo xong phần cứng (vài giây đầu): chờ nó rồi mới kiểm tra menu
const settle = async (p) => { await p.evaluate(() => medabe.admin.status()); await new Promise((r) => setTimeout(r, 1500)); };
const waitMenu = (p, s) => p.waitForFunction((x) => document.querySelector('.menubar').innerText.includes(x), { timeout: 60000 }, s);
const menuHas = (p, s) => p.evaluate((x) => document.querySelector('.menubar').innerText.includes(x), s);

try {
  const dir = mkdtempSync(join(tmpdir(), 'medabe-adm-'));

  // ===== 1. Máy BÌNH THƯỜNG (chưa kích hoạt): không có gì liên quan quản trị =====
  let a = await launch(dir);
  await settle(a.page);
  check(!(await menuHas(a.page, 'Quản trị bảo mật')), 'Máy chưa kích hoạt: menu "Quản trị bảo mật" KHÔNG hiện ra');
  check(await menuHas(a.page, 'Khoá của tôi'), 'Menu dành cho người dùng (khoá của tôi, phá vỡ kính) vẫn có');
  const st1 = await a.page.evaluate(() => medabe.admin.status());
  check(st1.enrolled === false && st1.setupMode === false, 'Cầu nối báo: chưa kích hoạt, không ở chế độ kích hoạt');
  const rej = async (fn) => a.page.evaluate(async (src) => { try { await eval(src); return 'ĐƯỢC PHÉP'; } catch (e) { return e.message; } }, fn);
  check((await rej("medabe.admin.call('storage','GET','/api/admin/devices')")).includes('mở khoá'), 'Không thể gọi API quản trị khi chưa mở khoá');
  check((await rej("medabe.admin.enroll('MEDABE-ADMIN1:x','Mat-khau-1234!')")).includes('--admin-setup'), 'Không thể tự kích hoạt trạm quản trị nếu không mở app bằng --admin-setup');
  await a.close();

  // ===== 2. Chế độ kích hoạt (--admin-setup): mật khẩu yếu bị từ chối, mạnh thì nhận =====
  a = await launch(dir, { args: ['--admin-setup'] });
  await waitMenu(a.page, 'Quản trị bảo mật');
  check(true, 'Chế độ --admin-setup: có mục kích hoạt');
  await click(a.page, 'Quản trị bảo mật', '.menubar a');
  await click(a.page, 'Kích hoạt trạm quản trị', '.dropmenu a');
  await waitText(a.page, 'KÍCH HOẠT TRẠM QUẢN TRỊ');
  await type(a.page, 'Gói kích hoạt', PKG);
  await type(a.page, 'Đặt mật khẩu', 'yeu');
  await type(a.page, 'Nhập lại', 'yeu');
  await click(a.page, 'Kích hoạt', 'button');
  await waitText(a.page, 'tối thiểu 10 ký tự');
  check(true, 'Mật khẩu yếu bị từ chối');
  await type(a.page, 'Gói kích hoạt', 'MEDABE-ADMIN1:rac');
  await type(a.page, 'Đặt mật khẩu', PW);
  await type(a.page, 'Nhập lại', PW);
  await click(a.page, 'Kích hoạt', 'button');
  await waitText(a.page, 'Gói kích hoạt không đúng') .catch(() => waitText(a.page, 'hỏng hoặc không đầy đủ'));
  check(true, 'Gói kích hoạt sai/hỏng bị từ chối');
  await type(a.page, 'Gói kích hoạt', PKG);
  await click(a.page, 'Kích hoạt', 'button');
  await waitText(a.page, 'Đã kích hoạt trạm quản trị');
  check(true, 'Gói đúng + mật khẩu mạnh: kích hoạt thành công');
  await a.close();

  // ===== 3. Mở lại BÌNH THƯỜNG: menu có, nhưng mọi trang quản trị đòi mật khẩu =====
  a = await launch(dir);
  await waitMenu(a.page, 'Quản trị bảo mật');
  check(true, 'Trạm quản trị (đúng máy): menu quản trị hiện ra');
  await click(a.page, 'Quản trị bảo mật', '.menubar a');
  await click(a.page, 'Quản trị cấp quyền', '.dropmenu a');
  await waitText(a.page, 'Nhập mật khẩu quản trị');
  check(!(await text(a.page)).includes('Cấp nhanh nhân sự'), 'Chưa nhập mật khẩu: KHÔNG thấy nội dung quản trị');
  await type(a.page, 'Mật khẩu quản trị', 'sai-mat-khau-12');
  await click(a.page, 'Mở khoá', 'button');
  await waitText(a.page, 'Còn 4 lần thử');
  check(true, 'Sai mật khẩu: bị từ chối, báo số lần còn lại');
  await type(a.page, 'Mật khẩu quản trị', PW);
  await click(a.page, 'Mở khoá', 'button');
  await waitText(a.page, 'Đăng ký máy mới');
  await a.page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));   // "Cấp nhanh nhân sự" nằm trong mục Nâng cao
  await waitText(a.page, 'Cấp nhanh nhân sự');
  check(true, 'Đúng mật khẩu: vào được màn quản trị');

  // Token không bao giờ lọt vào giao diện
  const dump = await a.page.evaluate(() => document.documentElement.outerHTML + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  const leaked = [T.storage, T.BenhVien, T.SoYTe, T.DienThoai, T.approver].filter((t) => dump.includes(t)).length;
  check(leaked === 0, 'Token quản trị KHÔNG xuất hiện trong giao diện/localStorage (chỉ nằm ở tiến trình chính)');

  // Thao tác quản trị thật chạy được qua tiến trình chính
  await type(a.page, 'Tên (vd', 'Tiep don Kiem Thu');
  await a.page.evaluate(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.text === 'TiepDon')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'TiepDon'); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(a.page, 'Tạo gói đăng ký', 'button');
  await waitText(a.page, 'Gói đăng ký (dùng một lần)');
  check(/i=[A-Za-z0-9_-]+&a=BenhVien/.test(await text(a.page)), 'Quản trị tạo được gói đăng ký nhân sự (token được gắn ở tiến trình chính)');
  // Đường dẫn ngoài danh sách trắng bị chặn
  const bad = await a.page.evaluate(async () => { try { await medabe.admin.call('storage', 'GET', '/api/files'); return 'ĐƯỢC PHÉP'; } catch (e) { return e.message; } });
  check(bad.includes('không được phép'), 'Tiến trình chính chặn đường dẫn ngoài danh sách trắng (không thể dùng làm proxy tuỳ ý)');
  await a.close();

  // ===== 4. Chép dữ liệu sang MÁY KHÁC (phần cứng khác): phần quản trị biến mất =====
  const other = JSON.stringify({ cpu: 'BFEBFBFF000906EA', board: 'MAY-LA-999', bios: 'LABIOS-1', disk: 'LADISK-2', macs: ['DE:AD:BE:EF:00:01'], host: 'MAY-KE-TROM' });
  a = await launch(dir, { env: { MEDABE_FAKE_HW: other } });
  await settle(a.page);
  check(!(await menuHas(a.page, 'Quản trị bảo mật')), 'Chép toàn bộ dữ liệu sang MÁY KHÁC: menu quản trị KHÔNG hiện ra (dù có file kho + biết mật khẩu)');
  const st4 = await a.page.evaluate(() => medabe.admin.status());
  check(st4.enrolled === false, 'Trên máy khác, cầu nối báo "chưa kích hoạt"');
  const u4 = await a.page.evaluate(async (pw) => { try { await medabe.admin.unlock(pw); return 'ĐƯỢC PHÉP'; } catch (e) { return e.message; } }, PW);
  check(!u4.includes('ĐƯỢC PHÉP'), 'Trên máy khác, mật khẩu đúng cũng không mở được');
  await a.close();

  // ===== 5. Dò mật khẩu: sai 5 lần thì KHOÁ, đúng mật khẩu cũng bị từ chối, mở lại app vẫn bị khoá =====
  a = await launch(dir);
  const tries = await a.page.evaluate(async () => { const out = []; for (let i = 0; i < 5; i++) { try { await medabe.admin.unlock('doan-sai-' + i + '-xxxx'); out.push('OK'); } catch (e) { out.push(e.message); } } return out; });
  check(tries[4].includes('Khoá 15 phút'), 'Sai 5 lần liên tiếp: khoá 15 phút');
  const afterLock = await a.page.evaluate(async (pw) => { try { await medabe.admin.unlock(pw); return 'ĐƯỢC PHÉP'; } catch (e) { return e.message; } }, PW);
  check(afterLock.includes('Đã khoá'), 'Đang bị khoá: nhập ĐÚNG mật khẩu cũng bị từ chối');
  await a.close();
  a = await launch(dir);
  await waitMenu(a.page, 'Quản trị bảo mật');
  const persisted =await a.page.evaluate(async (pw) => { try { await medabe.admin.unlock(pw); return 'ĐƯỢC PHÉP'; } catch (e) { return e.message; } }, PW);
  check(persisted.includes('Đã khoá'), 'Tắt và mở lại ứng dụng: trạng thái khoá vẫn còn (không xoá được bằng cách khởi động lại)');
  await click(a.page, 'Quản trị bảo mật', '.menubar a');
  await click(a.page, 'Quản trị cấp quyền', '.dropmenu a');
  await waitText(a.page, 'Đã khoá do nhập sai nhiều lần');
  check(true, 'Màn hình hiển thị đếm ngược thời gian khoá');
  await a.close();

  // ===== 6. Máy chủ: sai token quản trị nhiều lần cũng bị khoá (chống dò token từ mạng) =====
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await fetch(`${API}/api/admin/devices`, { headers: { 'x-admin-token': 'doan-token-' + i } })).status);
  check(codes.slice(0, 5).every((c) => c === 401) && codes[6] === 429, `Máy chủ: sai token ${codes.filter((c) => c === 401).length} lần rồi bị 429 (${codes.join(',')})`);
  const goodWhileBlocked = (await fetch(`${API}/api/admin/devices`, { headers: { 'x-admin-token': T.storage } })).status;
  check(goodWhileBlocked === 429, 'Đang bị khoá: đúng token cũng bị từ chối (kẻ dò không biết đã đoán trúng)');
  const oldDefault = (await fetch(`${API}/api/admin/devices`, { headers: { 'x-admin-token': 'admin-storage' } })).status;
  check(oldDefault === 429 || oldDefault === 401, 'Token mặc định cũ (admin-storage) không còn dùng được');
} catch (e) {
  console.log('LỖI:', e.message);
  failed++;
}
for (const p of spawned) p.kill();
console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nTất cả kiểm tra phần bảo mật quản trị đạt');
process.exit(failed ? 1 : 0);
