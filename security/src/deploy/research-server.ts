// MÁY CHỦ NGHIÊN CỨU "BẤM LÀ CHẠY": một lệnh/một biểu tượng khởi động mọi thứ cần có.
//   Chay-MayChu-NghienCuu.cmd  (hoặc biểu tượng Desktop do `npm run research:shortcut` tạo)
// Việc nó làm: tự build jar/giao diện nếu thiếu hoặc có mã mới → sinh CA + chứng chỉ HTTPS (lần đầu) và tin CA trên MÁY NÀY → chạy Spring HTTPS + 3 nút
// cấp khoá + APP NHÂN VIÊN (đăng nhập bằng email + mật khẩu) + trang đối chiếu nghiên cứu → mở app nhân viên trong trình duyệt. Dữ liệu (CSDL, khoá, chứng chỉ, share của nút) lưu ở data-research/ nên tắt/mở không mất.
// Lần đầu tạo tài khoản quản trị `quantri01` với mật khẩu TẠM (in ra màn hình + lưu data-research/mat-khau-quan-tri-lan-dau.txt), phải tự đổi khi đăng nhập.
// Biến tuỳ chọn: RESEARCH_DATA_DIR, RESEARCH_PORT (8443), RESEARCH_UI_PORT (5175), RESEARCH_NODE_PORTS ("9001,9002,9003"),
//   RESEARCH_GIO_THAT=1 (dùng ngay lịch T2-T7 07-21h / CN 07-17h30 thay vì mở cả ngày ở lần khởi tạo đầu), RESEARCH_DEMO_USERS=1 (thêm 3 tài khoản mẫu),
//   RESEARCH_NO_BROWSER=1, RESEARCH_NO_CERT=1 (không tin CA/không mở trình duyệt: dùng khi kiểm thử).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { X509Certificate, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { isLanPeer } from '../network/lan.js';
import { BYT_PORT, bytPublicKey, startGateway } from './byt.js';
import type { DevTls } from './devtls.js';
import { DEMO_USERS, startResearchStack } from './research-stack.js';

const env = process.env;
const dataDir = resolve(env.RESEARCH_DATA_DIR ?? 'data-research');
const SPRING_PORT = Number(env.RESEARCH_PORT ?? 8443);
const UI_PORT = Number(env.RESEARCH_UI_PORT ?? 5175);          // trang đối chiếu A/B của nghiên cứu
const WEB_PORT = Number(env.RESEARCH_WEB_PORT ?? 5180);        // APP NHÂN VIÊN (app/web) chạy trong trình duyệt, dùng tài khoản email + mật khẩu
const BYT_PORT_USED = Number(env.RESEARCH_BYT_PORT ?? BYT_PORT);         // CỔNG LIÊN THÔNG BỘ Y TẾ (mô phỏng): nhận bản ghi đã mã hoá + trả biên nhận; thiếu cổng này thì "Chưa liên thông" mãi không giảm
const LOOKUP_PORT = Number(env.RESEARCH_LOOKUP_PORT ?? 5174);  // APP TRA CỨU SỨC KHỎE (app/parent): chỉ đọc, giao diện điện thoại, tự cập nhật khi máy khác nhập liệu
// Cổng nút mặc định 9101-9103 (KHÔNG trùng 9001-9003 của KSK.exe/bản demo cũ để hai hệ thống chạy song song được).
const [n1, n2, n3] = (env.RESEARCH_NODE_PORTS ?? '9101,9102,9103').split(',').map(Number);
const log = (s = '') => console.log(s);
process.title = 'MedABE - May chu nghien cuu CP-ABE';

const VIRTUAL = /vmware|virtual|vethernet|vbox|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|bluetooth|wireguard|tunnel|tap-|tun\d/i;
const lanIps = Object.entries(networkInterfaces()).filter(([n]) => !VIRTUAL.test(n))
  .flatMap(([, a]) => (a ?? []).filter((x) => x.family === 'IPv4' && !x.internal && !x.address.startsWith('169.254.')).map((x) => x.address));

const open = (p: number) => new Promise<boolean>((res) => { const s = connect(p, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
const newest = (dir: string): number => {
  let m = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'target', 'dist', '.git'].includes(e.name)) continue;
    const f = join(dir, e.name);
    m = Math.max(m, e.isDirectory() ? newest(f) : statSync(f).mtimeMs);
  }
  return m;
};
const openBrowser = (url: string) => { if (!env.RESEARCH_NO_BROWSER) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); };

function ensureBuilt() {
  if (spawnSync('java', ['-version']).error) throw new Error('Không tìm thấy Java (cần JDK 21+ trong PATH).');
  const jarDir = resolve('security/storage/target');
  const jar = existsSync(jarDir) ? readdirSync(jarDir).find((f) => /^medabe-storage-.*\.jar$/.test(f)) : undefined;
  if (!jar || statSync(join(jarDir, jar)).mtimeMs < newest(resolve('security/storage/src'))) {
    log('Đang build máy chủ Spring (lần đầu hoặc có mã mới, khoảng 1-2 phút)...');
    const mvn = (args: string[]) => execFileSync(process.platform === 'win32' ? 'cmd' : './mvnw', process.platform === 'win32' ? ['/c', '.\\mvnw.cmd', ...args] : args, { cwd: resolve('security/storage'), stdio: 'inherit' });
    try { mvn(['-o', '-q', '-DskipTests', 'package']); } catch { mvn(['-q', '-DskipTests', 'package']); }
  }
  const dist = resolve('app/research/dist/index.html');
  if (!existsSync(dist) || statSync(dist).mtimeMs < Math.max(newest(resolve('app/research/src')), newest(resolve('security/src/research')))) {
    log('Đang build giao diện nghiên cứu...');
    execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--config', 'app/research/vite.config.ts'], { stdio: 'inherit' });
  }
  const lookup = resolve('app/parent/dist/index.html');
  if (!existsSync(lookup) || statSync(lookup).mtimeMs < Math.max(newest(resolve('app/parent/src')), newest(resolve('app/web/src')), newest(resolve('security/src/client')), newest(resolve('security/src/research')))) {
    log('Đang build app tra cứu sức khỏe...');
    execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--config', 'app/parent/vite.config.ts'], { stdio: 'inherit' });
  }
  const web = resolve('app/web/dist/index.html');
  if (!existsSync(web) || statSync(web).mtimeMs < Math.max(newest(resolve('app/web/src')), newest(resolve('security/src/client')), newest(resolve('security/src/research')))) {
    log('Đang build app nhân viên...');
    execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--config', 'app/web/vite.config.ts'], { stdio: 'inherit', env: { ...env, MEDABE_EDITION: 'user' } });
  }
}

/** Phục vụ một thư mục tĩnh (chỉ cho mạng nội bộ). */
function serveStatic(dir: string, port: number) {
  return createServer((req, res) => {
    if (!isLanPeer(req.socket.remoteAddress ?? '')) { res.writeHead(403).end('LAN_ONLY'); return; }
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = join(dir, p);
    if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    createReadStream(f).pipe(res);
  }).listen(port, '0.0.0.0');
}

/** Tin CA nội bộ trên MÁY NÀY (kho Windows của người dùng hiện tại; hỏi xác nhận một lần). Khoá riêng của CA đã bị xoá sau khi cấp chứng chỉ máy chủ. */
function ensureCaTrusted(caFile: string, caPem: string) {
  if (process.platform !== 'win32' || env.RESEARCH_NO_CERT) return;
  const sha1 = new X509Certificate(caPem).fingerprint.replace(/:/g, '').toLowerCase();
  if (spawnSync('certutil', ['-user', '-store', 'Root', sha1]).status === 0) return;
  log('Lần đầu: cần tin CA nội bộ của máy chủ này để trình duyệt kết nối HTTPS.');
  log('Windows sẽ hiện hộp thoại xác nhận chứng chỉ "MedABE Research Dev CA" — hãy chọn "Yes".');
  const r = spawnSync('certutil', ['-user', '-addstore', 'Root', caFile], { stdio: 'inherit' });
  if (r.status !== 0) log('(!) Chưa cài được CA: trình duyệt sẽ báo lỗi chứng chỉ. Cài thủ công tệp ' + caFile + ' vào "Trusted Root Certification Authorities".');
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function main() {
  if (await open(SPRING_PORT)) {
    log(`Máy chủ MedABE có vẻ đang chạy rồi (cổng ${SPRING_PORT} đã được dùng). Mở app nhân viên...`);
    openBrowser(`http://localhost:${WEB_PORT}`);
    return;
  }
  const busy: number[] = [];
  for (const p of [n1, n2, n3, UI_PORT, WEB_PORT, LOOKUP_PORT, BYT_PORT_USED]) if (await open(p)) busy.push(p);
  if (busy.length) throw new Error(`Cổng ${busy.join(', ')} đang được chương trình khác dùng (có thể là một máy chủ cũ/KSK.exe). Hãy tắt chương trình đó hoặc đổi cổng bằng RESEARCH_NODE_PORTS / RESEARCH_WEB_PORT / RESEARCH_LOOKUP_PORT / RESEARCH_UI_PORT.`);
  ensureBuilt();
  mkdirSync(dataDir, { recursive: true });

  // Bí mật cố định giữa các lần chạy (KEK chế độ nền, token dịch vụ giữa Spring ↔ nút): lưu ở data-research/secrets.json
  const secretsFile = join(dataDir, 'secrets.json');
  const secrets = existsSync(secretsFile)
    ? (JSON.parse(readFileSync(secretsFile, 'utf8')) as { serviceToken: string; kek: string; adminToken: string; siemToken: string })
    : { serviceToken: randomBytes(16).toString('hex'), kek: randomBytes(32).toString('hex'), adminToken: randomBytes(16).toString('hex'), siemToken: randomBytes(16).toString('hex') };
  if (!existsSync(secretsFile)) writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });

  // Tài khoản quản trị đầu tiên: mật khẩu TẠM, bắt buộc tự đổi ở lần đăng nhập đầu.
  const firstFile = join(dataDir, 'mat-khau-quan-tri-lan-dau.txt');
  let firstPassword = '';
  if (!existsSync(firstFile)) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    do firstPassword = Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join(''); while (!/[A-Za-z]/.test(firstPassword) || !/[0-9]/.test(firstPassword));
    writeFileSync(firstFile, `Tai khoan quan tri dau tien: quantri01\nMat khau TAM: ${firstPassword}\n(Chi dung cho lan dang nhap dau - he thong bat buoc doi. Sau khi doi, mat khau nay HET HIEU LUC; co the xoa tep nay.)\n`, { mode: 0o600 });
  } else firstPassword = /Mat khau TAM: (\S+)/.exec(readFileSync(firstFile, 'utf8'))?.[1] ?? '';
  const seed = [`quantri01|${firstPassword}|QUAN_TRI||Quan tri he thong|TAM`,
    ...(env.RESEARCH_DEMO_USERS ? DEMO_USERS.filter((u) => u.username !== 'quantri01').map((u) => `${u.username}|${u.password}|${u.role}|${u.khoa}|${u.name}`) : [])].join(',');

  // KHÔI PHỤC CỤC BỘ tài khoản QUẢN TRỊ (mất mật khẩu của quản trị duy nhất): chỉ khi người vận hành trên MÁY CHỦ đặt RESEARCH_RECOVER_ADMIN=<tên đăng nhập> (xem Khoi-Phuc-Mat-Khau-Quan-Tri.cmd).
  // Sinh mật khẩu TẠM, ghi vào tệp chỉ chủ tài khoản Windows đọc được, chuyển cho Spring qua biến môi trường của tiến trình con (không qua mạng). Quyền vật lý với máy chủ = quyền với CSDL.
  const recoverUser = (env.RESEARCH_RECOVER_ADMIN ?? '').trim().toLowerCase();
  let recoverEnv: Record<string, string> = {};
  if (recoverUser) {
    const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let tmp = '';
    do tmp = Array.from(randomBytes(16), (b) => alpha[b % alpha.length]).join(''); while (!/[A-Za-z]/.test(tmp) || !/[0-9]/.test(tmp));
    const f = join(dataDir, 'mat-khau-khoi-phuc-quan-tri.txt');
    writeFileSync(f, `Khoi phuc cuc bo tai khoan quan tri: ${recoverUser}
Mat khau TAM: ${tmp}
(Chi dung cho lan dang nhap ke tiep - he thong bat buoc doi ngay. XOA tep nay sau khi dung. Moi phien dang nhap cu cua tai khoan da bi thu hoi.)
`, { mode: 0o600 });
    recoverEnv = { MEDABE_RESEARCH_RECOVER_ADMIN: `${recoverUser}|${tmp}` };
    log(`KHÔI PHỤC QUẢN TRỊ: đã tạo mật khẩu tạm cho "${recoverUser}" — xem tệp ${f}`);
  }

  // ===== CẤU HÌNH ĐỊA CHỈ + CHỨNG CHỈ + NÚT TÁCH RỜI: data-research/cau-hinh-may-chu.json (biến môi trường RESEARCH_* ghi đè) =====
  interface CauHinh { ghiChu?: string; diaChiCoDinh?: string[]; nutTuXa?: Record<string, string>; chungChiToChuc?: { p12: string; ca: string; matKhau?: string } }
  const cfgFile = join(dataDir, 'cau-hinh-may-chu.json');
  if (!existsSync(cfgFile)) {
    writeFileSync(cfgFile, JSON.stringify({
      ghiChu: 'diaChiCoDinh: IP tĩnh/tên máy mà máy khác dùng để vào máy chủ (vd ["192.168.1.50","medabe.congty.local"]) -> chứng chỉ KHÔNG đổi khi đổi mạng. nutTuXa: nút cấp khoá chạy ở máy khác (vd {"SoYTe":"https://10.0.0.5:9102"}), xem node-server.ts. chungChiToChuc: {"p12":"đường dẫn kho PKCS12","ca":"đường dẫn ca.pem","matKhau":"hoặc đặt biến RESEARCH_TLS_PASSWORD"} để dùng chứng chỉ do tổ chức cấp.',
      diaChiCoDinh: [], nutTuXa: {},
    }, null, 2));
  }
  let cauHinh: CauHinh = {};
  try { cauHinh = JSON.parse(readFileSync(cfgFile, 'utf8')) as CauHinh; } catch { throw new Error(`${cfgFile} không phải JSON hợp lệ`); }
  const csv = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const fixed = [...new Set([...(cauHinh.diaChiCoDinh ?? []), ...csv(env.RESEARCH_FIXED_ADDRS)])];
  const san = (a: string) => (/^[0-9.]+$/.test(a) ? `ip:${a}` : `dns:${a}`);
  // Nút cấp khoá cùng máy chủ được công bố là "localhost": mỗi máy khách tự đổi thành địa chỉ máy chủ mà nó đang dùng (nodeUrl), nên đổi IP/Wi-Fi KHÔNG còn làm hỏng đăng nhập.
  // RESEARCH_NODE_HOST chỉ cần khi nút nằm ở địa chỉ khác máy chủ.
  const nodeHostEnv = (env.RESEARCH_NODE_HOST ?? '').trim();
  const nodeHost = nodeHostEnv || 'localhost';
  // Có địa chỉ cố định thì chứng chỉ CHỈ gắn địa chỉ đó (+ localhost, tên máy) => đổi mạng không phải cấp lại chứng chỉ/CA; không thì gắn IP LAN hiện tại như trước.
  const sans = ['dns:localhost', `dns:${hostname()}`, 'ip:127.0.0.1', ...(fixed.length ? fixed.map(san) : lanIps.map((i) => `ip:${i}`)), ...(nodeHostEnv && nodeHostEnv !== 'localhost' ? [san(nodeHostEnv)] : [])];
  if (fixed.length) {
    const lech = lanIps.filter((i) => !fixed.includes(i));
    if (lech.length) log(`(!) Địa chỉ hiện tại ${lech.join(', ')} KHÔNG nằm trong "diaChiCoDinh": máy khác vào bằng địa chỉ đó sẽ báo lỗi chứng chỉ. Hãy đặt IP tĩnh ${fixed.join(', ')} cho máy này hoặc thêm địa chỉ vào ${cfgFile}.`);
  } else log(`(i) Chưa đặt địa chỉ cố định: chứng chỉ gắn với IP LAN hiện tại, đổi mạng thì chứng chỉ (và CA) được cấp lại. Đặt "diaChiCoDinh" trong ${cfgFile} để chứng chỉ không đổi theo mạng.`);
  // Nút cấp khoá chạy ở MÁY KHÁC (mỗi nút do một bên giữ share riêng): không chạy cục bộ, chỉ công bố địa chỉ.
  const remoteNodes: Record<string, string> = { ...(cauHinh.nutTuXa ?? {}) };
  for (const it of csv(env.RESEARCH_REMOTE_NODES)) { const i = it.indexOf('='); if (i > 0) remoteNodes[it.slice(0, i).trim()] = it.slice(i + 1).trim(); }
  for (const [k, v] of Object.entries(remoteNodes)) if (!['BenhVien', 'SoYTe', 'DienThoai'].includes(k) || !/^https:\/\/[^/]+$/.test(v)) throw new Error(`nutTuXa sai: "${k}=${v}" (tên nút BenhVien/SoYTe/DienThoai, địa chỉ dạng https://máy:cổng)`);
  if (Object.keys(remoteNodes).length) log(`Nút cấp khoá chạy ở máy khác: ${Object.entries(remoteNodes).map(([k, v]) => `${k} → ${v}`).join(' , ')} (máy này không giữ share của các nút đó).`);
  // Chứng chỉ do TỔ CHỨC cấp (thay chứng chỉ tự sinh).
  let orgTls: DevTls | undefined;
  const ct = cauHinh.chungChiToChuc;
  if (ct) {
    const p12 = resolve(ct.p12), ca = resolve(ct.ca), password = env.RESEARCH_TLS_PASSWORD ?? ct.matKhau ?? '';
    if (!existsSync(p12) || !existsSync(ca)) throw new Error(`chungChiToChuc: không thấy ${!existsSync(p12) ? p12 : ca}`);
    if (!password) throw new Error('chungChiToChuc: thiếu mật khẩu kho (đặt biến RESEARCH_TLS_PASSWORD)');
    orgTls = { dir: dirname(p12), caPem: readFileSync(ca, 'utf8'), caFile: ca, serverP12: p12, password };
    log('Dùng chứng chỉ do tổ chức cấp: ' + p12);
  }
  log('Đang khởi động máy chủ (Spring HTTPS + 3 nút cấp khoá)...');
  const stack = await startResearchStack({
    dataDir, host: '127.0.0.1', nodeHost, sans, passwordIterations: 600_000, remoteNodes, tls: orgTls,
    ports: { spring: SPRING_PORT, nodes: { BenhVien: n1, SoYTe: n2, DienThoai: n3 } },
    persist: { dbUrl: `jdbc:h2:file:${join(dataDir, 'db', 'medabe').replace(/\\/g, '/')}`, ...secrets },
    legacyBridge: true, seedUsers: seed, initialSchedule: env.RESEARCH_GIO_THAT ? null : undefined, evidence: false,
    env: { MEDABE_BYT_URL: `https://127.0.0.1:${BYT_PORT_USED}`, MEDABE_BYT_PK: bytPublicKey(dataDir), MEDABE_RESEARCH_ADMIN_MFA: env.RESEARCH_ADMIN_MFA === '0' ? 'false' : 'true', ...recoverEnv },      // Quản trị BẮT BUỘC xác thực hai lớp (RESEARCH_ADMIN_MFA=0 để tắt)   // máy khách ghim khoá công khai của cổng; địa chỉ được đổi sang máy chủ mà máy khách đang kết nối
  });
// Cổng liên thông chạy HTTPS cùng chứng chỉ với máy chủ: HTTP trước đây để lộ siêu dữ liệu (loại mục, tên thuộc tính trong chính sách, chứng chỉ thiết bị) cho kẻ nghe lén trong LAN.
  const gwTls = { pfx: readFileSync(orgTls?.serverP12 ?? join(stack.tlsDir, 'server.p12')), passphrase: orgTls?.password ?? (JSON.parse(readFileSync(join(stack.tlsDir, 'tls.json'), 'utf8')) as { password: string }).password };
  const gateway = startGateway({ dataDir, port: BYT_PORT_USED, registryPk: stack.registryPk, facility: { ma: env.MEDABE_MA_CSKCB ?? 'DEMO0001', ten: 'Cơ sở khám sức khoẻ (demo)' }, tls: gwTls });
  ensureCaTrusted(stack.caFile, stack.caPem);

  const ui = serveStatic(resolve('app/research/dist'), UI_PORT);
  const web = serveStatic(resolve('app/web/dist'), WEB_PORT);
  const lookup = serveStatic(resolve('app/parent/dist'), LOOKUP_PORT);

  const url = `http://localhost:${UI_PORT}`;
  const webUrl = `http://localhost:${WEB_PORT}`;
  log('\n================ MÁY CHỦ MEDABE ĐÃ SẴN SÀNG ================');
  log(`APP NHÂN VIÊN (trình duyệt) : ${webUrl}   ← đăng nhập bằng email + mật khẩu do quản trị cấp`);
  for (const ip of lanIps) log(`  từ máy khác trong mạng    : http://${ip}:${WEB_PORT}   (máy khác cần tin CA ${stack.caFile} và mở cổng ${SPRING_PORT}, ${n1}-${n3}, ${WEB_PORT} trên tường lửa)`);
  log(`APP TRA CỨU SỨC KHỎE      : http://localhost:${LOOKUP_PORT}   ← chỉ đọc, giao diện điện thoại, tự cập nhật khi máy khác nhập${lanIps.length ? ' (máy khác/điện thoại cùng mạng: http://' + lanIps[0] + ':' + LOOKUP_PORT + ')' : ''}`);
  log(`App desktop KSK.exe         : nhập địa chỉ máy chủ ${stack.baseUrl.replace('127.0.0.1', lanIps[0] ?? 'localhost')} ở mục "Máy chủ" của màn đăng nhập (cần bản KSK.exe đã đóng gói lại)`);
  log(`Trang đối chiếu nghiên cứu  : ${url}`);
  log(`Dịch vụ HTTPS               : ${stack.baseUrl.replace('127.0.0.1', 'localhost')}   | nút cấp khoá: ${Object.values(stack.nodeUrls).join(' , ')}`);
  log(`Dữ liệu lưu tại      : ${dataDir}`);
  if (existsSync(firstFile) && readFileSync(firstFile, 'utf8').includes(firstPassword)) {
    log(`Tài khoản quản trị   : quantri01   (lần đầu: mật khẩu TẠM ${firstPassword} — sẽ buộc đổi; nếu đã đổi rồi thì dùng mật khẩu của bạn)`);
  }
  log('Lịch giờ làm việc    : ' + (env.RESEARCH_GIO_THAT ? 'mặc định T2-T7 07-21h, CN 07-17h30' : 'lần khởi tạo đầu MỞ CẢ NGÀY để bạn thử được; chỉnh trong tab Quản trị → Lịch giờ làm việc'));
  log('Đóng cửa sổ này hoặc bấm Ctrl+C để TẮT máy chủ.\n');
  log(`READY ${JSON.stringify({ ui: url, web: webUrl, lookup: `http://localhost:${LOOKUP_PORT}`, api: stack.baseUrl, ca: stack.caFile })}`);
  openBrowser(webUrl);

  const shutdown = () => { gateway.server.close(); ui.close(); web.close(); lookup.close(); void stack.stop().finally(() => process.exit(0)); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, shutdown);
}

main().catch((e) => { console.error('\nLỖI: ' + (e instanceof Error ? e.message : String(e))); process.exit(1); });
