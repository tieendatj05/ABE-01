// Tiến trình chính của ứng dụng MedABE (Windows). Giữ mọi thứ nhạy cảm NGOÀI giao diện:
//  - khoá thiết bị lưu bằng kho khoá của hệ điều hành (DPAPI qua safeStorage) VÀ buộc vào phần cứng thật của máy;
//  - giao diện chạy trong cửa sổ cô lập (sandbox, không Node, không điều hướng/ mở cửa sổ lạ), chặn chụp màn hình.
import { lookup } from 'node:dns/promises';
import { discoverServers } from '../../security/src/network/discovery.js';
import { isLanPeer } from '../../security/src/network/lan.js';
import { requestServerProof } from '../../security/src/client/server-proof.js';
import { storageUrl } from '../../security/src/client/connection.js';
import { app, BrowserWindow, ipcMain, Menu, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { existsSync, openSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { collectHardware, hardwareHash, matchHardware, type Hardware } from '../../security/src/hardware.js';
import { registerAdmin } from './adminipc.js';

// Bản phát hành: "admin" (có phần quản trị, chỉ hiện trên máy đã kích hoạt) hoặc "user" (KHÔNG chứa mã quản trị). Do esbuild --define.
declare const __EDITION__: string;

if (process.env.MEDABE_USER_DATA) app.setPath('userData', resolve(process.env.MEDABE_USER_DATA)); // chỉ để chạy nhiều bản thử trên 1 máy
const DEBUG = !!process.env.MEDABE_DEBUG || !!process.env.MEDABE_TEST;
const UI = join(__dirname, '..', '..', 'web', 'dist', 'index.html');

// ===== Máy chủ nhúng (chỉ bản admin đã đóng gói): kho mù Spring + 3 nút cấp khoá chạy ngầm cùng ứng dụng, không cần cài/ chạy gì thêm =====
const SERVER_DIR = join(process.resourcesPath ?? '', 'server');
const EMBEDDED = __EDITION__ === 'admin' && app.isPackaged && existsSync(join(SERVER_DIR, 'server.mjs'));
const serverData = () => join(app.getPath('userData'), 'server-data');
const adminPkgFile = () => (EMBEDDED ? join(serverData(), 'admin-package.txt') : app.isPackaged ? join(app.getPath('userData'), 'no-such-file') : resolve(process.env.DATA_DIR ?? 'data-demo', 'admin-package.txt'));
/** Địa chỉ LAN của máy này (các máy nhân viên/điện thoại dùng để vào máy chủ). Đặt MEDABE_PUBLIC_HOST để ép giá trị. */
const lanIp = () => {
  if (process.env.MEDABE_PUBLIC_HOST) return process.env.MEDABE_PUBLIC_HOST;
  // Bỏ các card ảo (VMware, VirtualBox, Hyper-V/WSL, Docker, VPN...) rồi ưu tiên Wi-Fi, sau đó Ethernet.
  const bad = /vmware|virtual|vethernet|vbox|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|bluetooth/i;
  const cand = Object.entries(networkInterfaces()).filter(([n]) => !bad.test(n)).flatMap(([n, a]) => (a ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ n, ip: i.address })));
  const rank = (c: { n: string; ip: string }) => (/wi-?fi|wlan|wireless/i.test(c.n) ? 0 : /ethernet/i.test(c.n) ? 1 : 2) * 10 + (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c.ip) ? 0 : 5);
  return cand.sort((a, b) => rank(a) - rank(b))[0]?.ip ?? '127.0.0.1';
};
let serverProc: ChildProcess | undefined;
const up = async (url: string) => !!(await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null))?.ok;
const serverUp = async () => (await up('http://127.0.0.1:8090/api/epochs')) && (await up('http://127.0.0.1:9001/info'));
async function startServer(): Promise<boolean> {
  if (!EMBEDDED) return true;
  if (!(await serverUp())) {
    mkdirSync(serverData(), { recursive: true });
    serverProc = spawn(process.execPath, [join(SERVER_DIR, 'server.mjs')], {
      windowsHide: true, stdio: ['ignore', openSync(join(serverData(), 'server.log'), 'a'), openSync(join(serverData(), 'server.log'), 'a')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_WEB: '1', PARENT_DIST: join(SERVER_DIR, 'parent'), DATA_DIR: serverData(), JAR_PATH: join(SERVER_DIR, 'medabe-storage.jar'), JAVA_BIN: join(SERVER_DIR, 'jre', 'bin', 'java.exe'), PORT: '8090', PUBLIC_HOST: lanIp() },
    });
  }
  for (let i = 0; i < 240; i++) { if (await serverUp()) return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}
function stopServer() {
  if (serverProc?.pid) spawnSync('taskkill', ['/PID', String(serverProc.pid), '/T', '/F'], { windowsHide: true });
  serverProc = undefined;
}

const file = (n: string) => join(app.getPath('userData'), n);
const atomicWrite = (p: string, data: string | Buffer) => {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(p + '.tmp', data, { mode: 0o600 });
  renameSync(p + '.tmp', p);
};

interface DeviceFile {
  hw: Hardware;
  sign: { priv: JsonWebKey; pub: JsonWebKey };
  wrap: string; // AES-256 thô, base64
}

let hwPromise: Promise<Hardware> | undefined;
// MEDABE_FAKE_HW chỉ có tác dụng khi MEDABE_TEST bật: giả lập "máy khác" để kiểm thử cơ chế từ chối. Bản phát hành không đặt MEDABE_TEST.
const currentHw = () =>
  (hwPromise ??= process.env.MEDABE_TEST && process.env.MEDABE_FAKE_HW ? Promise.resolve(JSON.parse(process.env.MEDABE_FAKE_HW) as Hardware) : collectHardware());

/** Chỉ chấp nhận lệnh từ chính giao diện của app (file://), không phải từ trang nào khác. */
function trusted(e: IpcMainInvokeEvent) {
  const url = e.senderFrame?.url ?? '';
  if (!url.startsWith('file://')) throw new Error('Nguồn không được tin cậy');
}

function handle<T>(channel: string, fn: (arg: any) => Promise<T> | T) {
  ipcMain.handle(channel, async (e, arg) => { trusted(e); return fn(arg); });
}

handle('hw:info', async () => {
  const h = await currentHw();
  return { hash: hardwareHash(h), host: h.host, macs: h.macs };
});

handle('device:load', async () => {
  const p = file('device.bin');
  if (!existsSync(p)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không có kho khoá an toàn; từ chối chạy');
  const stored = JSON.parse(safeStorage.decryptString(readFileSync(p))) as DeviceFile;
  const r = matchHardware(stored.hw, await currentHw());
  if (!r.ok) {
    throw new Error(`HARDWARE_MISMATCH: khoá thiết bị này được tạo trên máy khác (khớp ${r.matched}/${r.available} thành phần phần cứng). Cần đăng ký lại thiết bị.`);
  }
  return { hwHash: hardwareHash(stored.hw), sign: stored.sign, wrap: stored.wrap };
});

handle('device:save', async (d: { sign: DeviceFile['sign']; wrap: string }) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không có kho khoá an toàn; từ chối lưu');
  const hw = await currentHw();
  atomicWrite(file('device.bin'), safeStorage.encryptString(JSON.stringify({ hw, sign: d.sign, wrap: d.wrap } satisfies DeviceFile)));
  return { hwHash: hardwareHash(hw) };
});

// Tự mở khoá: mật khẩu kho khoá là chuỗi NGẪU NHIÊN do app tự sinh, cất bằng DPAPI + buộc phần cứng (không ai phải nhớ/ nhập).
// Đánh đổi (đã nêu trong hướng dẫn): ai dùng được phiên Windows này thì mở được app - giống mọi phần mềm nghiệp vụ trên máy trạm.
handle('autounlock:get', async () => {
  const p = file('autounlock.bin');
  if (!existsSync(p) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const s = JSON.parse(safeStorage.decryptString(readFileSync(p))) as { hw: Hardware; pass: string };
    return matchHardware(s.hw, await currentHw()).ok ? s.pass : null;
  } catch { return null; }
});
handle('autounlock:set', async (pass: string) => {
  if (typeof pass !== 'string' || pass.length < 16) throw new Error('mật khẩu tự mở khoá phải dài ≥ 16 ký tự');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không có kho khoá an toàn');
  atomicWrite(file('autounlock.bin'), safeStorage.encryptString(JSON.stringify({ hw: await currentHw(), pass })));
});
handle('autounlock:clear', () => { rmSync(file('autounlock.bin'), { force: true }); });

handle('vault:get', () => (existsSync(file('vault.json')) ? readFileSync(file('vault.json'), 'utf8') : null));
handle('vault:set', (v: string) => { if (typeof v !== 'string' || v.length > 5_000_000) throw new Error('vault sai'); atomicWrite(file('vault.json'), v); });
handle('vault:wipe', () => { for (const f of ['vault.json', 'device.bin', 'autounlock.bin']) rmSync(file(f), { force: true }); });

const settings = (): Record<string, string> => { try { return JSON.parse(readFileSync(file('settings.json'), 'utf8')); } catch { return {}; } };
// Bản nhân viên được đóng gói kèm địa chỉ máy chủ của máy quản trị (server-url.txt) để mở lên là kết nối đúng chỗ.
const bakedServer = () => { try { return readFileSync(join(__dirname, '..', 'server-url.txt'), 'utf8').trim() || null; } catch { return null; } };
handle('setting:get', (k: string) => settings()[k] ?? (k === 'storage' ? bakedServer() : null));

if (__EDITION__ === 'admin') {
  registerAdmin({
    handle: (ch, fn) => handle(ch, fn as (a: any) => unknown),
    file, atomicWrite,
    seal: (p) => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không có kho khoá an toàn'); return safeStorage.encryptString(p); },
    unseal: (b) => safeStorage.decryptString(b),
    hardware: currentHw,
    storageBase: () => settings().storage ?? 'http://localhost:8090',
    setupMode: process.argv.includes('--admin-setup'),
    // Máy chạy cả máy chủ (bản nhúng, hoặc chạy thử từ mã nguồn với data-demo): gói kích hoạt có sẵn trên chính máy này, không phải dán tay.
    pendingPackage: () => { try { return readFileSync(adminPkgFile(), 'utf8').trim(); } catch { return null; } },
    onEnrolled: () => { rmSync(adminPkgFile(), { force: true }); },
  });
}
handle('setting:set', ({ k, v }: { k: string; v: string }) => { if (!/^[a-z.]{1,40}$/.test(k)) throw new Error('khoá cấu hình sai'); atomicWrite(file('settings.json'), JSON.stringify({ ...settings(), [k]: v })); });
handle('app:quit', () => app.quit());

async function allowedLanServer(raw: string): Promise<boolean> {
  try {
    const base = new URL(storageUrl(raw));
    const host = base.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((v) => isLanPeer(v.address));
  } catch { return false; }
}
handle('network:allowed', (raw: string) => typeof raw === 'string' && raw.length < 300 ? allowedLanServer(raw) : false);
handle('network:probe', async (raw: string) => {
  if (typeof raw !== 'string' || !(await allowedLanServer(raw))) throw new Error('Máy chủ không thuộc mạng nội bộ hiện tại.');
  const proof = await requestServerProof(raw, fetch, undefined, AbortSignal.timeout(2500));
  return { registryPk: proof.registryPk };
});
// ===== Tự cập nhật: chỉ thay app.asar (giao diện + logic, ~2 MB) bằng bản admin vừa đóng gói lại, không đụng Electron/Chromium. =====
// Mở lại app là có tính năng mới, không cài gì tay - xem security/storage/.../AppUpdateController.java và app/desktop/update-packaged.mjs.
const asarPath = () => join(process.resourcesPath ?? '', 'app.asar');
handle('update:localHash', () => {
  const p = asarPath();
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
});
handle('update:apply', async (raw: string) => {
  if (typeof raw !== 'string' || !(await allowedLanServer(raw))) throw new Error('Máy chủ không thuộc mạng nội bộ hiện tại.');
  const base = storageUrl(raw);
  const infoRes = await fetch(`${base}/api/app/version?edition=${__EDITION__}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!infoRes.ok) throw new Error('Máy chủ chưa có bản cập nhật cho bản này.');
  const info = (await infoRes.json()) as { hash: string; size: number };
  const dlRes = await fetch(`${base}/api/app/download?edition=${__EDITION__}`, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!dlRes.ok) throw new Error('Tải bản cập nhật thất bại.');
  const buf = Buffer.from(await dlRes.arrayBuffer());
  if (buf.length !== info.size || createHash('sha256').update(buf).digest('hex') !== info.hash) throw new Error('Dữ liệu tải về không khớp, thử lại.');
  const p = asarPath(), bak = p + '.bak', tmp = p + '.new';
  writeFileSync(tmp, buf);
  rmSync(bak, { force: true });
  renameSync(p, bak); // giữ bản cũ để khôi phục nếu bước sau lỗi
  try {
    renameSync(tmp, p);
  } catch (e) {
    renameSync(bak, p);
    throw e;
  }
  setTimeout(() => { app.relaunch(); app.exit(0); }, 400); // đợi IPC trả lời xong rồi mới khởi động lại
  return true;
});

handle('network:discover', async () => {
  const found = await discoverServers();
  // UDP chỉ gợi ý địa chỉ. Máy đích phải chứng minh giữ khóa registry và ký đúng IP/cổng.
  const verified = await Promise.all(found.map(async (server) => {
    try {
      if (!(await allowedLanServer(server.url))) return null;
      const proof = await requestServerProof(server.url, fetch, server.registryPk, AbortSignal.timeout(2500));
      return { url: server.url, registryPk: proof.registryPk };
    } catch { return null; }
  }));
  const unique = new Map<string, { url: string; registryPk: string }>();
  for (const candidate of verified) if (candidate && !unique.has(candidate.registryPk)) unique.set(candidate.registryPk, candidate);
  return [...unique.values()];
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 900, minHeight: 600, title: 'MedABE', backgroundColor: '#0e1815',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, devTools: DEBUG, spellcheck: false,
      backgroundThrottling: false, // không giảm tốc khi cửa sổ bị che: khoá tự động và các tác vụ nền vẫn chạy đúng hạn
    },
  });
  // Chặn chụp/ghi màn hình (Windows: SetWindowDisplayAffinity): TẮT theo mặc định (đang trong giai đoạn demo/báo lỗi bằng ảnh chụp).
  // Bật lại khi cần trình diễn đúng tính năng này: đặt MEDABE_BLOCK_CAPTURE=1. Lưu ý: không chặn được camera điện thoại -> có hình mờ truy vết (watermark).
  if (app.isPackaged && process.env.MEDABE_BLOCK_CAPTURE) win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // không camera/mic/vị trí...
  void win.loadFile(UI);
  return win;
}

Menu.setApplicationMenu(null);
if (!process.env.MEDABE_USER_DATA && !app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(async () => {
  void currentHw();
  if (EMBEDDED) {
    const splash = new BrowserWindow({ width: 460, height: 300, frame: false, resizable: false, alwaysOnTop: true, center: true, skipTaskbar: false, backgroundColor: '#0b2238', title: 'KSK' });
    let logo = '';
    try { logo = 'data:image/png;base64,' + readFileSync(join(__dirname, '..', '..', 'web', 'dist', 'ksk-logo.png')).toString('base64'); } catch { /* không có logo thì chỉ hiện chữ */ }
    const page = `<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font:15px Segoe UI,sans-serif;color:#dbe9f6;background:linear-gradient(160deg,#12467a,#071c33);border:1px solid #2a5a8a;box-sizing:border-box">
      ${logo ? `<img src="${logo}" width="120" height="120" style="object-fit:contain;margin-bottom:10px">` : ''}
      <div style="font-size:20px;font-weight:600;letter-spacing:.5px">KHÁM SỨC KHỎE</div>
      <div style="margin:8px 0 18px;opacity:.85">Đang khởi động hệ thống bảo mật…</div>
      <div style="width:240px;height:4px;background:#ffffff22;border-radius:3px;overflow:hidden"><div style="width:40%;height:100%;background:#e8c35a;border-radius:3px;animation:m 1.2s ease-in-out infinite"></div></div>
      <style>@keyframes m{0%{margin-left:-40%}100%{margin-left:100%}}</style></body>`;
    void splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    const ok = await startServer();
    splash.close();
    if (!ok) { stopServer(); app.quit(); return; }
  } // đo phần cứng ngay khi mở app (PowerShell/WMI khởi động nguội mất ~20 s) để lúc đăng ký không phải chờ
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', stopServer);
