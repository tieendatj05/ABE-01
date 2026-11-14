// Chụp màn hình app phụ huynh (khung điện thoại) với dữ liệu MẪU được mã hoá bằng đúng hàm của app, qua một máy chủ giả rất nhỏ.
//   npm run parent:build && npx tsx app/test-ui/parent-shots.ts        -> ảnh nằm ở app/test-ui/shots/parent-*.png
// Cũng kiểm tra luồng thật: đăng nhập họ tên + CCCD (có dấu/không dấu), sai thông tin, cập nhật trực tiếp, ngoại tuyến, nhiều con.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { bytesToHex } from '@noble/hashes/utils.js';
import { parentCreds, wrapForParent } from '../../security/src/client/parent.js';

const DIST = resolve('app/parent/dist');
const SHOTS = resolve('app/test-ui/shots');
mkdirSync(SHOTS, { recursive: true });
const xn = JSON.parse(readFileSync('app/web/src/data/gen/xetnghiem.json', 'utf8')) as { ma: string; nam: [number, number] | null }[];

let failed = 0;
const check = (c: boolean, m: string) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) failed++; };

/* ---------- dữ liệu mẫu ---------- */
interface Sample { name: string; cccd: string; data: { type: string; khoa: string; data: unknown; ts: string }[] }
const kq: Record<string, string> = {};
const pick = (ma: string, f: (lo: number, hi: number) => number) => { const x = xn.find((y) => y.ma === ma && y.nam); if (x?.nam) kq[ma] = String(+f(x.nam[0], x.nam[1]).toFixed(2)); };
for (const ma of ['H01', 'H02', 'H04', 'H13', 'H17', 'S01']) pick(ma, (lo, hi) => (lo + hi) / 2);
pick('H02', (lo) => lo - 18);          // huyết sắc tố thấp
pick('S01', (_l, hi) => hi + 1.2);     // đường huyết cao
const SAMPLE: Sample = {
  name: 'Nguyễn Minh Khang', cccd: '079213004512',
  data: [
    { type: 'hanhchinh', khoa: 'KSK', ts: '2026-10-20T08:00:00Z', data: { hoTen: 'Nguyễn Minh Khang', lop: '6A1', gioiTinh: 'nam', ngaySinh: '2013-05-12', cccd: '079213004512', giamHo: { hoTen: 'Nguyễn Văn Hùng', quanHe: 'Cha' } } },
    { type: 'lankham', khoa: 'KSK', ts: '2026-10-27T08:30:00Z', data: { ngayKham: '2026-10-27', lyDo: 'Khám sức khỏe định kỳ', ghiChu: 'Học sinh hợp tác tốt trong quá trình khám.' } },
    { type: 'tiensu', khoa: 'KSK', ts: '2026-10-27T08:40:00Z', data: { co: ['Dị ứng', 'Cận thị / tật khúc xạ'], ghiChu: 'Dị ứng với hải sản từ nhỏ.' } },
    { type: 'thecuc', khoa: 'KSK', ts: '2026-10-27T09:00:00Z', data: { chieuCao: '152', canNang: '41.5', mach: '82', huyetApTT: '105', huyetApTTr: '68', nhipTho: '20', nhietDo: '36.7', loai: 2 } },
    { type: 'lamsang', khoa: 'Nhi', ts: '2026-10-27T09:20:00Z', data: { 'Tuần hoàn': { kq: 'Bình thường', loai: '1' }, 'Hô hấp': { kq: 'Bình thường', loai: '1' }, 'Tiêu hoá': { kq: 'Bình thường', loai: '1' }, 'Thần kinh': { kq: 'Bình thường', loai: '1' } } },
    { type: 'lamsang', khoa: 'Mat', ts: '2026-10-27T09:30:00Z', data: { 'Mắt phải không kính': { kq: '7/10', loai: '3' }, 'Mắt trái không kính': { kq: '8/10', loai: '2' }, 'Bệnh lý mắt': { kq: 'Cận thị nhẹ', loai: '3' } } },
    { type: 'lamsang', khoa: 'TMH', ts: '2026-10-27T09:40:00Z', data: { 'Tai trái (nói thường)': { kq: '5', loai: '1' }, 'Tai phải (nói thường)': { kq: '5', loai: '1' }, 'Các bệnh TMH': { kq: 'Viêm họng nhẹ', loai: '2' } } },
    { type: 'lamsang', khoa: 'RHM', ts: '2026-10-27T09:50:00Z', data: { 'Hàm trên': { kq: 'Sâu răng 2 chiếc', loai: '3' }, 'Hàm dưới': { kq: 'Sức nhai 100%', loai: '1' } } },
    { type: 'canlamsang', khoa: 'XetNghiem', ts: '2026-10-27T10:10:00Z', data: { gioiTinh: 'nam', kq } },
    { type: 'ketluan', khoa: 'KSK', ts: '2026-10-27T11:00:00Z', data: { loai: 2, ngay: '2026-10-27', chanDoan: [['H52.1', 'Cận thị'], ['K02.1', 'Sâu răng ngà']], ketLuan: 'Sức khỏe tốt. Cận thị nhẹ, sâu răng cần điều trị.\nĐề nghị: khám mắt và đo thị lực định kỳ 6 tháng, đưa em đi điều trị răng tại cơ sở nha khoa.' } },
  ],
};
const SIBLING: Sample = {
  name: 'Nguyễn Gia Hân', cccd: '079216002233',
  data: [
    { type: 'hanhchinh', khoa: 'KSK', ts: '2026-10-20T08:00:00Z', data: { hoTen: 'Nguyễn Gia Hân', lop: '3B', gioiTinh: 'nu', ngaySinh: '2016-02-03', cccd: '079216002233', giamHo: { hoTen: 'Nguyễn Văn Hùng', quanHe: 'Cha' } } },
    { type: 'thecuc', khoa: 'KSK', ts: '2026-10-27T09:00:00Z', data: { chieuCao: '121', canNang: '22', mach: '90', huyetApTT: '95', huyetApTTr: '60', nhipTho: '22', nhietDo: '36.6', loai: 1 } },
  ],
};

const aes = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt']);
async function rowsOf(s: Sample) {
  const out: unknown[] = [];
  const patientIdx = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  for (const d of s.data) {
    const id = crypto.randomUUID();
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = JSON.stringify({ data: d.data, ts: d.ts, author: { name: 'BS. Trần Thu Hà' } });
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(`${patientIdx}|${d.type}|${id}`) }, await aes(key), new TextEncoder().encode(JSON.stringify({ body, sig: 'x' }))));
    out.push({ id, patientIdx, type: d.type, khoa: d.khoa, createdAt: d.ts, envelope: { iv: bytesToHex(iv), ciphertext: bytesToHex(ct) }, parentWrap: await wrapForParent(s.cccd, s.name, id, key) });
  }
  return out;
}

/* ---------- máy chủ giả ---------- */
const db = new Map<string, unknown[]>();
db.set(parentCreds(SAMPLE.cccd, SAMPLE.name).idx, await rowsOf(SAMPLE));
db.set(parentCreds(SIBLING.cccd, SIBLING.name).idx, await rowsOf(SIBLING));
let version = 1, outage = false;
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const u = new URL(req.url!, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname.startsWith('/api/public/')) {
    if (outage) { res.writeHead(503); return void res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    if (u.pathname.endsWith('/ping')) return void res.end('{"ok":true}');
    const rows = db.get(u.searchParams.get('parentIdx') ?? '') ?? [];
    if (u.pathname.endsWith('/parent-version')) return void res.end(JSON.stringify({ n: rows.length, last: String(version) }));
    return void res.end(JSON.stringify(rows));
  }
  let p = join(DIST, decodeURIComponent(u.pathname));
  if (!p.startsWith(DIST) || !existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
  createReadStream(p).pipe(res);
}).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${(server.address() as { port: number }).port}`;

/* ---------- trình duyệt ---------- */
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync)!;
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => localStorage.setItem('ksk.base', location.origin));
const shot = (n: string, full = false) => page.screenshot({ path: join(SHOTS, `parent-${n}.png`), fullPage: full });
const text = () => page.evaluate(() => document.body.innerText);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const click = async (sel: string, label?: string) => {
  await page.evaluate((s, l) => {
    const els = [...document.querySelectorAll<HTMLElement>(s)];
    (l ? els.find((e) => e.innerText.includes(l)) : els[0])?.click();
  }, sel, label);
  await wait(250);
};
const typeInto = async (sel: string, v: string) => { await page.focus(sel); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type(sel, v); };

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await shot('01-login');
  check(/Cài app lên màn hình chính/.test(await text()), 'đăng nhập: có thẻ "Cài app lên màn hình chính" (hướng dẫn cài cho iPhone/Android)');
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  check(fonts.some((f) => /Be Vietnam/.test(f)), 'font Be Vietnam Pro đã nạp (hiển thị đúng tiếng Việt)');

  // đăng nhập sai
  await typeInto('input[placeholder="Nguyễn Văn An"]', 'Nguyễn Minh Khôi');
  await typeInto('input[inputmode=numeric]', SAMPLE.cccd);
  await click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.alert'), { timeout: 20000 });
  check(/Chưa tìm thấy/.test(await text()), 'sai họ tên: báo không tìm thấy, không lộ dữ liệu');
  await shot('02-login-loi');

  // đăng nhập đúng — gõ KHÔNG DẤU, chữ thường
  await typeInto('input[placeholder="Nguyễn Văn An"]', 'nguyen minh khang');
  await click('button[type=submit]');
  await page.waitForSelector('.greet', { timeout: 20000 });
  check((await text()).includes('Nguyễn Minh Khang'), 'đúng thông tin (gõ không dấu): trang chủ chào đúng tên có dấu lấy từ hồ sơ');
  await wait(600);
  await shot('03-home');
  await shot('03-home-full', true);

  for (const [k, n] of [['Thể lực', 'theluc'], ['lâm sàng', 'lamsang'], ['nghiệm', 'xetnghiem'], ['Tiền sử', 'tiensu'], ['Kết luận', 'ketluan']] as const) {
    await click('.sc', k); await wait(300);
    await shot(`04-${n}`, true);
    await click('.bar .icon-btn[aria-label="Quay lại"]');
  }
  // nội dung chính
  await click('.sc', 'nghiệm');
  const xt = await text();
  check(/cần chú ý/.test(xt) && /↑ Cao|↓ Thấp/.test(xt), 'xét nghiệm: có nhóm "cần chú ý" và đánh dấu cao/thấp');
  await click('.bar .icon-btn[aria-label="Quay lại"]');
  await click('.tabs button', 'Kết quả'); await wait(300); await shot('04-tab-ketqua', true);
  check(/Thể lực/.test(await text()) && /Kết luận/.test(await text()), 'tab Kết quả: danh sách các mục kèm tóm tắt');
  await click('.tabs button', 'Hồ sơ'); await wait(300); await shot('04-tab-hoso', true);
  check(/Nguyễn Văn Hùng/.test(await text()), 'tab Hồ sơ: thông tin học sinh + người giám hộ');
  await click('.tabs button', 'Trang chủ'); await wait(300);

  // cập nhật trực tiếp: máy chủ có dữ liệu mới -> app tự tải lại
  const idx = parentCreds(SAMPLE.cccd, SAMPLE.name).idx;
  const upd: Sample = { ...SAMPLE, data: SAMPLE.data.map((d) => d.type === 'thecuc' ? { ...d, ts: '2026-10-28T08:00:00Z', data: { ...(d.data as object), canNang: '43.0' } } : d) };
  db.set(idx, await rowsOf(upd)); version++;
  await page.waitForFunction(() => document.body.innerText.includes('43'), { timeout: 20000 });
  check(true, 'cập nhật trực tiếp: nhân viên lưu số liệu mới -> điện thoại tự cập nhật (cân nặng 43)');

  // ngoại tuyến
  await page.setOfflineMode(true);
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await wait(400);
  check(/Không có mạng/.test(await text()) && (await text()).includes('Nguyễn Minh Khang'), 'mất mạng: vẫn xem được dữ liệu đã lưu, có thông báo ngoại tuyến');
  await shot('05-offline');
  await page.setOfflineMode(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));

  // mở lại app: dữ liệu mã hoá trong kho, xem ngay không cần gõ lại
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.greet', { timeout: 20000 });
  check((await text()).includes('Nguyễn Minh Khang'), 'mở lại app: tự vào thẳng hồ sơ đã ghi nhớ (không gõ lại)');
  const stored = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open('ksk-phuhuynh', 1); q.onsuccess = () => r(q.result); });
    return new Promise<string>((r) => { const g = db.transaction('kv').objectStore('kv').get('vault'); g.onsuccess = () => r(JSON.stringify(g.result)); });
  });
  check(!stored.includes('Nguyễn') && !stored.includes('079213004512') && !stored.includes('Khang'), 'kho trên máy chỉ chứa dữ liệu mã hoá (không có tên/CCCD dạng rõ)');

  // thêm con thứ hai + chuyển qua lại
  await click('.kid.add');
  await typeInto('input[placeholder="Nguyễn Văn An"]', SIBLING.name);
  await typeInto('input[inputmode=numeric]', SIBLING.cccd);
  await click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.greet')?.textContent?.includes('Gia Hân'), { timeout: 20000 });
  check(await page.evaluate(() => document.querySelectorAll('.kid:not(.add)').length === 2), 'thêm con thứ hai: hai học sinh trên một máy');
  await shot('06-nhieu-con');

  // cài đặt + tối
  await click('.tabs button', 'Cài đặt');
  await shot('07-caidat');
  await click('.seg button', 'Tối'); await wait(300);
  await shot('08-caidat-toi');
  await click('.sheet-h .icon-btn'); await wait(300);
  await shot('09-home-toi');
  await click('.kid', 'Khang'); await wait(300);
  await click('.sc', 'Kết luận'); await wait(300);
  await shot('10-ketluan-toi', true);
  await click('.bar .icon-btn[aria-label="Quay lại"]');
  await click('.sc', 'nghiệm'); await wait(300);
  await shot('11-xetnghiem-toi', true);

  // xoá dữ liệu trên máy
  await click('.bar .icon-btn[aria-label="Quay lại"]'); await click('.tabs button', 'Cài đặt');
  await click('.btn-danger'); await click('.confirm .btn-danger');
  await page.waitForSelector('.login', { timeout: 5000 });
  check(true, 'xoá dữ liệu trên máy: quay về màn hình đăng nhập');
  const left = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open('ksk-phuhuynh', 1); q.onsuccess = () => r(q.result); });
    return new Promise<unknown>((r) => { const g = db.transaction('kv').objectStore('kv').get('vault'); g.onsuccess = () => r(g.result); });
  });
  check(left === undefined, 'kho đã bị xoá sạch');

  // máy chủ lỗi
  outage = true;
  await typeInto('input[placeholder="Nguyễn Văn An"]', SAMPLE.name);
  await typeInto('input[inputmode=numeric]', SAMPLE.cccd);
  await click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.alert'), { timeout: 20000 });
  await shot('12-loi-mang');
} catch (e) {
  failed++; console.log('FAIL', (e as Error).message);
  await shot('zz-loi').catch(() => undefined);
}
try {
  // mở trong trình duyệt của Zalo: không cài được app -> nhắc mở bằng Safari
  const z = await browser.newPage();
  await z.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await z.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo/23.10');
  await z.goto(base, { waitUntil: 'networkidle0' }); await wait(500);
  check(/Hãy mở bằng Safari/.test(await z.evaluate(() => document.body.innerText)), 'mở trong Zalo trên iPhone: nhắc "Hãy mở bằng Safari để cài app"');
  await z.screenshot({ path: join(SHOTS, 'parent-13-zalo.png') });
} catch (e) { failed++; console.log('FAIL', (e as Error).message); }
await browser.close(); server.close();
console.log(failed ? `\n${failed} lỗi` : '\nTất cả kiểm tra đạt.');
process.exit(failed ? 1 : 0);
