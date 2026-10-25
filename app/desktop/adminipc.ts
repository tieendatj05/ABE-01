import { lookup } from 'node:dns/promises';
import { isLanPeer } from '../../security/src/network/lan.js';
import { nodeUrl } from '../../security/src/client/connection.js';
import { requestServerProof } from '../../security/src/client/server-proof.js';
// Phần QUẢN TRỊ của tiến trình chính - CHỈ được đăng ký ở bản "admin" (bản "user" không chứa đoạn mã này).
// Giao diện không bao giờ nhận token: nó gọi 'admin:call' và tiến trình chính gắn token vào rồi gọi máy chủ, sau khi kiểm tra
// mật khẩu quản trị đã mở khoá, đích gọi (danh sách cố định) và đường dẫn (danh sách trắng).
import { appendFileSync } from 'node:fs';
import type { Hardware } from '../../security/src/hardware.js';
import { matchHardware } from '../../security/src/hardware.js';
import { AdminVault, type Attempts, type VaultEnv } from './adminvault.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';

export interface AdminDeps {
  handle: (channel: string, fn: (arg: any) => unknown) => void;
  file: (name: string) => string;
  atomicWrite: (path: string, data: string | Buffer) => void;
  seal: (plain: string) => Buffer;
  unseal: (b: Buffer) => string;
  hardware: () => Promise<Hardware>;
  storageBase: () => string;
  setupMode: boolean;
  /** Trạm quản trị nhúng máy chủ: gói kích hoạt do chính máy này sinh ra (không phải dán tay). */
  pendingPackage?: () => string | null;
  onEnrolled?: () => void;
}

const TARGETS = ['storage', 'BenhVien', 'SoYTe', 'DienThoai'];
const STORAGE_PATH = /^\/api\/(admin\/[A-Za-z0-9/_.:-]{1,120}|siem\/events|enrollment)(\?[A-Za-z0-9=&_.-]{0,60})?$/;
const NODE_PATH = /^\/(admin\/[A-Za-z0-9/_.:-]{1,120}|approvals(\/[A-Za-z0-9-]{1,64})?)$/;
const MAX_BODY = 100_000;
const MAX_RESPONSE = 5_000_000;

export function registerAdmin(d: AdminDeps) {
  const env: VaultEnv = {
    read: () => (existsSync(d.file('admin.bin')) ? readFileSync(d.file('admin.bin')) : null),
    write: (b) => d.atomicWrite(d.file('admin.bin'), b),
    remove: () => rmSync(d.file('admin.bin'), { force: true }),
    seal: d.seal,
    unseal: d.unseal,
    readAttempts: (): Attempts => { try { return JSON.parse(readFileSync(d.file('admin-attempts.json'), 'utf8')); } catch { return { n: 0, lockouts: 0, until: 0 }; } },
    writeAttempts: (a) => d.atomicWrite(d.file('admin-attempts.json'), JSON.stringify(a)),
    hardware: d.hardware,
    matchHw: (a, b) => matchHardware(a, b).ok,
    now: Date.now,
    audit: (line) => { try { appendFileSync(d.file('admin-audit.log'), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }); } catch { /* không để lỗi ghi log chặn thao tác */ } },
  };
  const vault = new AdminVault(env);

  d.handle('admin:status', async () => { const s = await vault.status(); return { ...s, setupMode: d.setupMode || (!s.enrolled && !!d.pendingPackage?.()) }; });
  d.handle('admin:pending', async () => ((await vault.status()).enrolled ? null : d.pendingPackage?.() ?? null));
  d.handle('admin:enroll', async (a: { pkg: string; password: string }) => {
    if (!d.setupMode && !d.pendingPackage?.()) throw new Error('Chỉ kích hoạt được khi mở ứng dụng bằng tham số --admin-setup');
    await vault.enroll(String(a?.pkg ?? ''), String(a?.password ?? ''));
    d.onEnrolled?.();
  });
  d.handle('admin:unlock', (pw: string) => vault.unlock(String(pw ?? '')));
  d.handle('admin:lock', () => vault.lock());
  d.handle('admin:changePassword', (a: { oldPw: string; newPw: string }) => vault.changePassword(String(a?.oldPw ?? ''), String(a?.newPw ?? '')));
  d.handle('admin:reset', (pw: string) => vault.reset(String(pw ?? '')));

  const allowed = async (base: string) => {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Địa chỉ quản trị không hợp lệ');
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (!addresses.length || !addresses.every((entry) => isLanPeer(entry.address))) throw new Error('Chỉ quản trị máy chủ/nút trong mạng nội bộ');
  };
  const trustedConfig = async () => {
    const base = d.storageBase(); await allowed(base);
    const pinFile = d.file('admin-registry.bin');
    const pinned = existsSync(pinFile) ? d.unseal(readFileSync(pinFile)) : undefined;
    // Lần pin đầu của trạm quản trị chỉ thực hiện với máy chủ cục bộ đang giữ gói kích hoạt.
    if (!pinned && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Kích hoạt danh tính máy chủ quản trị tại localhost trước khi đổi địa chỉ mạng.');
    const proof = await requestServerProof(base, fetch, pinned);
    if (!pinned) d.atomicWrite(pinFile, d.seal(proof.registryPk));
    return proof.config;
  };

  d.handle('admin:call', async (a: { target: string; method: string; path: string; body?: unknown }) => {
    const b = vault.use();                                                     // ném lỗi nếu chưa mở khoá / đã tự khoá
    if (!TARGETS.includes(a?.target)) throw new Error('Đích không hợp lệ');
    const method = a.method === 'GET' ? 'GET' : 'POST';
    const isStorage = a.target === 'storage';
    if (!(isStorage ? STORAGE_PATH : NODE_PATH).test(String(a.path ?? ''))) throw new Error('Đường dẫn không được phép');
    const body = a.body === undefined ? undefined : JSON.stringify(a.body);
    if (body && body.length > MAX_BODY) throw new Error('Nội dung quá lớn');

    const cfg = await trustedConfig();
    const node = cfg.nodes.find((entry) => entry.org === a.target);
    const base = isStorage ? d.storageBase() : node ? nodeUrl(node.url, d.storageBase()) : undefined;
    if (base) await allowed(base);
    if (!base) throw new Error(`Không biết địa chỉ nút ${a.target}`);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (isStorage) headers['x-admin-token'] = b.storage;
    else if (a.path.startsWith('/approvals')) headers['x-approver-token'] = b.approver;
    else headers['x-admin-token'] = b.nodes[a.target];

    if (method === 'POST') env.audit(`CALL ${a.target} POST ${a.path.split('?')[0]}`);
    const r = await fetch(base + a.path, { method, headers, body: method === 'POST' ? body ?? '{}' : undefined, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    const text = (await r.text()).slice(0, MAX_RESPONSE);
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* giữ nguyên dạng văn bản (vd NDJSON) */ }
    return { status: r.status, body: json };
  });

  // CẢM BIẾN MẠNG: đọc bảng neighbor (ARP) của CARD CÓ DEFAULT ROUTE (LAN thật, vd Wi-Fi) - bỏ qua card ảo VMware.
  // Chạy ở TIẾN TRÌNH CHÍNH (không phải React). Không cần quyền Administrator cho Get-NetNeighbor. Chỉ Windows.
  d.handle('net:scan', async () => {
    if (process.platform !== 'win32') return { iface: null, rows: [], unsupported: true };
    const script = [
      "$ErrorActionPreference='SilentlyContinue';",
      "$r=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric,ifMetric | Select-Object -First 1;",
      "if(-not $r){'{\"iface\":null,\"rows\":[]}';exit};",
      '$idx=$r.ifIndex; $alias=(Get-NetAdapter -InterfaceIndex $idx).InterfaceAlias;',
      "$rows=Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex $idx | Where-Object { $_.State -in 'Reachable','Stale','Permanent' -and $_.LinkLayerAddress } |",
      'ForEach-Object { [pscustomobject]@{ ip=$_.IPAddress; mac=$_.LinkLayerAddress; state="$($_.State)" } };',
      '[pscustomobject]@{ iface=$alias; rows=@($rows) } | ConvertTo-Json -Compress -Depth 4',
    ].join(' ');
    const { execFile } = await import('node:child_process');
    const out: string = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 15_000, maxBuffer: 2_000_000 }, (_err, stdout) => resolve(stdout || ''));
    });
    try {
      const j = JSON.parse(out || '{}');
      const rows = Array.isArray(j.rows) ? j.rows : j.rows ? [j.rows] : [];
      return { iface: j.iface ?? null, rows: rows.filter((x: any) => x && x.ip && x.mac).slice(0, 512) };
    } catch { return { iface: null, rows: [], error: 'Không đọc được bảng ARP' }; }
  });
}
