// KIỂM TRA GIAO DIỆN QUẢN LÝ THUỘC TÍNH THEO TÀI KHOẢN + HẠN CHẾ / KHÔI PHỤC (app nhân viên thật, máy chủ thử, hồ sơ giả):
//  - bảng tài khoản có cột "Thuộc tính ABE" (vai trò, khoa, tác giả; quản trị = không có), bảng phiên bản thuộc tính (epoch);
//  - "Báo rủi ro" chỉ ghi nhật ký (không đổi quyền); "Hạn chế" → chỉ còn thuộc tính tác giả, epoch tăng; "Khôi phục" → trả lại thuộc tính.
// Cần: npm run web:build, jar Spring đã build.   npx tsx app/test-ui/accounts-ui-check.ts      Ảnh chụp: .test-runs/accounts-ui/
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DEMO_USERS, startResearchStack } from '../../security/src/deploy/research-stack.js';

const dist = resolve('app/web/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Chưa build app: npm run web:build');
const shots = resolve('.test-runs/accounts-ui');
mkdirSync(shots, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Không thấy Edge/Chrome');
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;

const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true, env: { MEDABE_RESEARCH_ADMIN_MFA: 'false' } });
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const web = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const f = join(dist, p === '/' ? 'index.html' : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}).listen(5197, '127.0.0.1');
const spki = createHash('sha256').update(new X509Certificate(readFileSync(join(stack.tlsDir, 'server.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${spki}`] });
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  await page.evaluateOnNewDocument((url: string) => localStorage.setItem('medabe.storage', url), stack.baseUrl);
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  const prompts: string[] = [];
  page.on('dialog', (d) => { if (d.type() === 'prompt') { prompts.push(d.message().slice(0, 80)); void d.accept('Kiem thu giao dien: nghi bi chiem (GIA LAP)'); } else void d.accept(); });
  const waitText = (s: string, ms = 60_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, s);
  const clickText = (sel: string, label: string) => page.evaluate((s, l) => (Array.from(document.querySelectorAll(s)).find((e) => e.textContent?.includes(l)) as HTMLElement).click(), sel, label);
  const typeInto = async (sel: string, value: string) => { await page.focus(sel); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type(sel, value); };
  const rowOf = (who: string) => page.evaluate((w) => Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes(w))?.textContent ?? '', who);
  const tagsOf = (who: string) => page.evaluate((w) => Array.from(Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes(w))?.querySelectorAll('span.tag') ?? []).map((e) => e.textContent ?? ''), who);
  const rowClick = (who: string, label: string) => page.evaluate((w, l) => { const r = Array.from(document.querySelectorAll('tbody tr')).find((x) => x.textContent?.includes(w)); (Array.from(r!.querySelectorAll('button')).find((b) => b.textContent === l) as HTMLElement).click(); }, who, label);

  await page.goto('http://127.0.0.1:5197/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 });
  await typeInto('input[autocomplete="username"]', 'quantri01'); await typeInto('input[autocomplete="current-password"]', pw('quantri01'));
  await clickText('button', 'Đăng nhập');
  await waitText('Cấp tài khoản cho nhân viên mới', 90_000);
  await waitText('Thuộc tính ABE', 30_000);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('tbody tr')).some((r) => r.textContent?.includes('bsmat01')), { timeout: 30_000 });

  // 1) Cột thuộc tính theo từng tài khoản
  let t = await page.evaluate(() => document.body.innerText);
  const mat = await tagsOf('bsmat01');
  check('có cột "Thuộc tính ABE"', t.includes('Thuộc tính ABE'));
  check('bác sĩ Mắt: thuộc tính Role:BacSi + Khoa:Mat + Author', mat.includes('Role:BacSi') && mat.includes('Khoa:Mat') && mat.includes('Author'), mat.join(', '));
  check('quản trị: "không có (không giải mã được gì)"', (await rowOf('quantri02')).includes('không có'));
  check('có bảng phiên bản thuộc tính (epoch), chưa có thu hồi nào', t.includes('Phiên bản thuộc tính (epoch) hiện hành') && t.includes('Chưa có thu hồi nào'));
  await page.screenshot({ path: join(shots, '1-bang-thuoc-tinh.png') });

  // 2) Báo rủi ro: chỉ ghi nhật ký, KHÔNG đổi quyền
  await rowClick('bsmat01', 'Báo rủi ro');
  await waitText('Đã ghi tín hiệu rủi ro', 30_000);
  check('"Báo rủi ro" ghi nhật ký nhưng quyền không đổi', (await tagsOf('bsmat01')).includes('Khoa:Mat') && !(await rowOf('bsmat01')).includes('Bị hạn chế'));

  // 3) Hạn chế: chỉ còn thuộc tính tác giả; epoch tăng
  await rowClick('bsmat01', 'Hạn chế');
  await waitText('Bị hạn chế', 60_000);
  const after = await tagsOf('bsmat01');
  t = await page.evaluate(() => document.body.innerText);
  check('sau "Hạn chế": chỉ còn thuộc tính Author, mất Role/Khoa', after.length === 1 && after[0] === 'Author', after.join(', '));
  check('trạng thái hiện "Bị hạn chế" kèm lý do; có nút Khôi phục thay cho Hạn chế', (await rowOf('bsmat01')).includes('Kiem thu giao dien') && (await page.evaluate(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Khôi phục'))));
  await page.waitForFunction(() => document.body.innerText.includes('Role:BacSi') && !document.body.innerText.includes('Chưa có thu hồi nào'), { timeout: 30_000 }).catch(() => undefined);
  const epochTable = await page.evaluate(() => Array.from(document.querySelectorAll('table.small tbody tr')).map((r) => r.textContent ?? ''));
  check('bảng epoch hiện bộ đếm đã tăng cho Role:BacSi và Khoa:Mat', epochTable.some((x) => /Role:BacSi\s*1/.test(x)) && epochTable.some((x) => /Khoa:Mat\s*1/.test(x)), epochTable.join(' | '));
  await page.screenshot({ path: join(shots, '2-bi-han-che.png') });

  // 4) Khôi phục sau xác minh
  await rowClick('bsmat01', 'Khôi phục');
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes('bsmat01'))?.textContent?.includes('Bị hạn chế'), { timeout: 60_000 });
  const back = await tagsOf('bsmat01');
  check('sau "Khôi phục": trả lại Role:BacSi + Khoa:Mat + Author', back.includes('Role:BacSi') && back.includes('Khoa:Mat') && back.includes('Author'), back.join(', '));
  check('mỗi thao tác đều hỏi lý do (3 hộp thoại)', prompts.length === 3, `${prompts.length}`);
  await page.screenshot({ path: join(shots, '3-da-khoi-phuc.png') });
} catch (e) {
  console.error('LỖI:', e); failed++;
  try { const pg = (await browser.pages()).at(-1); await pg?.screenshot({ path: join(shots, 'error.png') }); } catch { /* ignore */ }
} finally {
  await browser.close(); web.close(); await stack.stop();
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nQUẢN LÝ THUỘC TÍNH (giao diện): tất cả kiểm tra đạt');
  process.exit(failed ? 1 : 0);
}
