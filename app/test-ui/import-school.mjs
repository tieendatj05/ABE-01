// Nhập thử file Excel THẬT của trường vào ứng dụng desktop và đo hiệu năng.
//   node app/test-ui/import-school.mjs "E:\NHAP LIEU\NHẬP THCS TÂN TIẾN B.xlsx"
// QUYỀN RIÊNG TƯ: dữ liệu học sinh (trẻ vị thành niên) là dữ liệu thật. Script này CHỈ in số lượng/thời gian,
// không in tên/CCCD/số điện thoại và KHÔNG chụp ảnh màn hình có dữ liệu.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import readXlsx from 'read-excel-file/node';

const XLSX = process.argv[2] ?? 'E:\\NHAP LIEU\\NHẬP THCS TÂN TIẾN B.xlsx';
const ROOT = resolve('.');
const ELECTRON = process.env.APP_EXE ?? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_ARGS = process.env.APP_EXE ? [] : ['.'];
const API = process.env.API ?? 'http://localhost:8090';
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data-demo');
import { loadTokens } from './tokens.mjs';
const T = loadTokens();

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
let port = 9600 + Math.floor(Math.random() * 300);
async function launch(userData) {
  const dbg = port++;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  const proc = spawn(ELECTRON, [...APP_ARGS, `--remote-debugging-port=${dbg}`], { cwd: ROOT, env: { ...env, MEDABE_USER_DATA: userData, MEDABE_TEST: '1' }, stdio: 'ignore' });
  spawned.push(proc);
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${dbg}`, defaultViewport: null }).catch(() => undefined); if (!browser) await new Promise((r) => setTimeout(r, 500)); }
  let page;
  for (let i = 0; i < 60 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('file://')); if (!page) await new Promise((r) => setTimeout(r, 300)); }
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  return { page, close: async () => { await browser.disconnect(); proc.kill(); await new Promise((r) => setTimeout(r, 800)); } };
}
const text = (p) => p.evaluate(() => document.body.innerText);
const waitText = (p, s, ms = 600000) => p.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, s).catch(async (e) => {
  // chỉ in 14 dòng đầu (menu/khung) để tránh in dữ liệu học sinh
  const head = (await p.evaluate(() => document.body.innerText)).split('\n').slice(0, 14).join(' | ').slice(0, 500);
  console.log(`--- không thấy "${s}"; đầu trang: ${head}`);
  console.log('--- thanh trạng thái: ' + (await p.evaluate(() => document.querySelector('.statusbar')?.innerText ?? '')).slice(0, 400));
  throw e;
});
const click = (p, label, sel = 'button, .menubar a, .side nav a, .tabsrow a') => p.evaluate((l, s) => { const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim().includes(l) && !x.disabled); if (!b) throw new Error('không thấy ' + l); b.click(); }, label, sel);
const setByPlaceholder = (p, ph, v) => p.evaluate((q, val) => { const el = [...document.querySelectorAll('input')].find((i) => i.placeholder?.startsWith(q)); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); }, ph, v);
const selectUnit = (p, label) => p.evaluate((l) => { const sel = [...document.querySelectorAll('.pickbar select')][1]; const o = [...sel.options].find((x) => x.text.includes(l)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, o.value); sel.dispatchEvent(new Event('change', { bubbles: true })); }, label);
const num = (s, re) => Number((re.exec(s) ?? [])[1] ?? NaN);

try {
  // ----- Số liệu gốc từ file (chỉ để đối chiếu, không in nội dung) -----
  const [{ data: rows }] = await readXlsx(XLSX);
  const expected = rows.slice(1).filter((r) => r.some((x) => x != null && String(x).trim() !== '')).length;
  console.log(`File: ${rows.length - 1} dòng dữ liệu (${expected} dòng không trống)`);

  const dirA = mkdtempSync(join(tmpdir(), 'medabe-imp-'));
  let a = await launch(dirA);
  await waitText(a.page, 'Đăng ký thiết bị', 90000);
  await setByPlaceholder(a.page, 'Dán gói', await pkg('Tiep don Import', ['Role:TiepDon']));
  await setByPlaceholder(a.page, 'Đặt passphrase', 'matkhau-import-1');
  await click(a.page, 'Đăng ký');
  await waitText(a.page, 'THAO TÁC', 120000);
  await selectUnit(a.page, 'THCS TÂN TIẾN');
  await click(a.page, 'Import Excel', '.menubar a');
  await waitText(a.page, 'B1. Chọn file');

  const t0 = Date.now();
  // Đưa file vào ô chọn file như người dùng chọn (không dùng hộp thoại hệ điều hành): dựng File từ byte rồi kích hoạt sự kiện change.
  await a.page.evaluate(async (b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const f = new File([u], 'danh-sach.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const dt = new DataTransfer();
    dt.items.add(f);
    const input = document.querySelector('input[type=file]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, readFileSync(XLSX).toString('base64'));
  if (process.env.DEBUG_UI) {
    for (let i = 0; i < 40; i++) { const st = await a.page.evaluate(() => document.querySelector('.statusbar')?.innerText ?? ''); if (/Đã đọc|Lỗi/.test(st)) break; await new Promise((r) => setTimeout(r, 1500)); }
    console.log('debug:', JSON.stringify(await a.page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input[type=file]')];
      const i = inputs[0];
      const pk = i && Object.keys(i).find((k) => k.startsWith('__reactProps'));
      return { nInputs: inputs.length, files: i?.files?.length, hasReactOnChange: !!(pk && i[pk].onChange), accept: i?.accept, status: document.querySelector('.statusbar')?.innerText?.slice(0, 200) };
    })));
  }
  // nút B2 chỉ bật khi file đã được đọc xong
  await a.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('B2.') && !b.disabled), { timeout: 120000 });
  await click(a.page, 'B2. Kiểm tra thông tin', 'button');
  await waitText(a.page, 'Danh sách lỗi (', 120000);
  const sum = await text(a.page);
  console.log(`Đọc & kiểm tra file: ${((Date.now() - t0) / 1000).toFixed(1)} s | tổng số dòng: ${num(sum, /Tổng số dòng:\s*(\d+)/)} | số lỗi phát hiện: ${num(sum, /Danh sách lỗi \((\d+)\)/)}`);

  const t1 = Date.now();
  await click(a.page, 'B3. Import', 'button');
  await waitText(a.page, 'Đã thêm mới', 900000);
  const done = await text(a.page);
  console.log(`Import: ${((Date.now() - t1) / 1000).toFixed(1)} s | ${(/Đã thêm mới (\d+) hồ sơ/.exec(done) ?? [])[1]} hồ sơ đã mã hoá & lưu`);
  await new Promise((r) => setTimeout(r, 4000));

  // ----- Mở danh sách -----
  await click(a.page, 'Khám sức khỏe định kỳ', '.menubar a');
  const t2 = Date.now();
  await waitText(a.page, 'Import excel (1000)', 300000).catch(() => undefined);
  const tab = (/Import excel \((\d+)\)/.exec(await text(a.page)) ?? [])[1];
  console.log(`Mở danh sách đơn vị (giải mã trên máy): ${((Date.now() - t2) / 1000).toFixed(1)} s | số hồ sơ đọc được: ${tab}`);

  // ----- Máy chủ có lộ gì không? (so sánh với dữ liệu trong file, KHÔNG in giá trị) -----
  const sample = rows.slice(1, 400).flatMap((r) => [r[2], r[8], r[22]]).filter((v) => v != null).map(String).filter((v) => v.length >= 8).slice(0, 300);
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  let leaked = 0, scanned = 0;
  for (const f of walk(DATA_DIR).filter((p) => !/\.(jar|class)$/.test(p) && statSync(p).size < 80_000_000)) {
    let buf; try { buf = readFileSync(f).toString('latin1'); } catch { continue; }
    scanned++;
    const lat = (s) => Buffer.from(s, 'utf8').toString('latin1');
    leaked += sample.filter((v) => buf.includes(v) || buf.includes(lat(v))).length;
  }
  console.log(`Quét ${scanned} file dữ liệu máy chủ với ${sample.length} giá trị mẫu từ Excel: ${leaked === 0 ? 'KHÔNG tìm thấy giá trị nào (chỉ có ciphertext)' : 'PHÁT HIỆN ' + leaked + ' lần khớp!'}`);
  await a.close();

  // ----- Bác sĩ mở danh sách trên máy khác -----
  const dirB = mkdtempSync(join(tmpdir(), 'medabe-bs-'));
  const b = await launch(dirB);
  await waitText(b.page, 'Đăng ký thiết bị', 90000);
  await setByPlaceholder(b.page, 'Dán gói', await pkg('BS Nhi Import', ['Role:BacSi', 'Khoa:Nhi']));
  await setByPlaceholder(b.page, 'Đặt passphrase', 'matkhau-bs-1');
  await click(b.page, 'Đăng ký');
  await waitText(b.page, 'THAO TÁC', 120000);
  await selectUnit(b.page, 'THCS TÂN TIẾN');
  const t3 = Date.now();
  await waitText(b.page, 'Import excel (1000)', 300000).catch(() => undefined);
  const tabB = (/Import excel \((\d+)\)/.exec(await text(b.page)) ?? [])[1];
  console.log(`Bác sĩ (máy khác) mở danh sách: ${((Date.now() - t3) / 1000).toFixed(1)} s | đọc được ${tabB} hồ sơ`);
  await b.close();
} catch (e) {
  console.log('LỖI:', e.message);
}
for (const p of spawned) p.kill();
process.exit(0);
