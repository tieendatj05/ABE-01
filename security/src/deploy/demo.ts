// Chạy cả hệ thống demo bằng MỘT lệnh:  npm run demo
//   Spring Boot (kho mù + registry + SIEM) :8080 | 3 nút cấp khoá :9001-9003 | giao diện web :5173
// Cần: jar Spring (cd security/storage && ./mvnw -DskipTests package) và web đã build (npm run web:build).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import { BYT_PORT, bytPublicKey, startGateway } from './byt.js';
import { initDealer, ORGS } from './init.js';
import { ALL_OPERATIONAL_ATTRS, NODE_PORTS, startNodes } from './nodes.js';
import { loadOrCreateSecrets, writeAdminPackage } from './secrets.js';
import { startDiscovery } from '../network/discovery.js';
import { isLanPeer } from '../network/lan.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data-demo');
const springPort = Number(process.env.PORT ?? 8090);
const webPort = Number(process.env.WEB_PORT ?? 5173);
const parentPort = Number(process.env.PARENT_PORT ?? 5174);
const bytPort = Number(process.env.BYT_PORT ?? BYT_PORT);
// Token quản trị sinh NGẪU NHIÊN lần đầu (admin-secrets.json); không có token mặc định đoán được.
const firstRun = !existsSync(join(dataDir, 'admin-secrets.json'));
const secrets = loadOrCreateSecrets(dataDir);
const ADMIN = secrets.storage;
const SERVICE = secrets.service;
const SIEM = secrets.siem;
process.env.APPROVER_TOKEN = secrets.approver;
for (const o of ORGS) process.env[`ADMIN_TOKEN_${o}`] = secrets.nodes[o];
// Gói kích hoạt trạm quản trị chỉ được ghi LẦN ĐẦU; nếu đã xoá, sinh lại bằng  npm run admin:package
// Đăng ký tự do: bật mặc định cho bản demo trong mạng nội bộ (nhân viên mở app, nhập tên là dùng được). Admin tắt/đổi quyền mặc định trong
// Quản trị bảo mật; muốn tắt ngay từ đầu: MEDABE_OPEN_ENROLLMENT=false. Quyền mặc định = mọi quyền nghiệp vụ (KHÔNG có quyền quản trị).
const openEnrollment = process.env.MEDABE_OPEN_ENROLLMENT !== 'false';
const adminPackage = firstRun ? writeAdminPackage(dataDir, secrets) : join(dataDir, 'admin-package.txt') + ' (nếu đã xoá: npm run admin:package)';

const jarDir = resolve('security/storage/target');
// Chế độ nhúng (trong MedABE-Admin.exe): JAR_PATH + JAVA_BIN do tiến trình chính truyền vào, NO_WEB=1 (không chạy web riêng).
const builtJar = existsSync(jarDir) ? readdirSync(jarDir).find((f) => /^medabe-storage-.*\.jar$/.test(f)) : undefined;
const jar = process.env.JAR_PATH ?? (builtJar ? join(jarDir, builtJar) : undefined);
if (!jar || !existsSync(jar)) { console.error('Chưa có jar Spring. Chạy:  cd security/storage && ./mvnw -DskipTests package'); process.exit(1); }
if (!process.env.NO_WEB && !existsSync(resolve('app/web/dist/index.html'))) { console.error('Chưa build web. Chạy:  npm run web:build'); process.exit(1); }

const init = initDealer(dataDir);
console.log(init.created ? 'Đã khởi tạo cơ quan MED (khoá ngưỡng 2-trên-3).' : 'Dùng lại cấu hình cơ quan MED đã có.');

const base = `http://127.0.0.1:${springPort}`;
let discovery: { close(): void } | undefined;
let gateway: { close(): unknown } | undefined;
let nodeServers: ReturnType<typeof startNodes>['servers'] = [];
const lanOnly: express.RequestHandler = (req, res, next) => {
  if (!isLanPeer(req.socket.remoteAddress ?? '')) return void res.status(403).json({ error: 'LAN_ONLY: chỉ cho phép thiết bị cùng mạng nội bộ' });
  next();
};
// Cờ JVM: bản mẫu ngắn hạn nên dùng trình biên dịch nhanh + GC đơn giản để khởi động nhanh; windowsHide: không hiện cửa sổ console của java.exe.
const spring = spawn(process.env.JAVA_BIN ?? 'java', ['-XX:TieredStopAtLevel=1', '-XX:+UseSerialGC', '-Xshare:auto', '-jar', jar], {
  windowsHide: true,
  env: {
    ...process.env, PORT: String(springPort), SPRING_MAIN_LAZY_INITIALIZATION: 'true',
    DB_URL: process.env.DB_URL ?? `jdbc:h2:file:${join(dataDir, 'db', 'medabe')}`,
    MEDABE_PK_JSON: readFileSync(join(dataDir, 'dealer', 'pk.json'), 'utf8'),
    MEDABE_NODES: ORGS.map((o) => `${o}=http://127.0.0.1:${NODE_PORTS[o]}`).join(','),
    MEDABE_ADMIN_TOKEN: ADMIN, MEDABE_SERVICE_TOKEN: SERVICE, MEDABE_SIEM_TOKEN: SIEM,
    MEDABE_OPEN_ENROLLMENT: openEnrollment ? 'true' : 'false',
    MEDABE_SIEM_FILE: join(dataDir, 'siem', 'events.jsonl'),
    MEDABE_APP_UPDATES_DIR: join(dataDir, 'app-updates'),
    MEDABE_BYT_URL: `http://127.0.0.1:${bytPort}`, MEDABE_BYT_PK: bytPublicKey(dataDir),   // cổng liên thông Bộ Y tế (mô phỏng), công bố cho máy khách ghim khoá
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const stop = () => { discovery?.close(); gateway?.close(); nodeServers.forEach((server) => server.close()); spring.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
spring.on('exit', (code) => { discovery?.close(); gateway?.close(); nodeServers.forEach((server) => server.close()); console.error(`Spring thoát (mã ${code})`); process.exit(1); });

for (let i = 0; i < 240; i++) {
  if ((await fetch(`${base}/api/epochs`).catch(() => null))?.ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
const cfg = (await (await fetch(`${base}/api/config`)).json()) as { registryPk: string };
const { servers } = startNodes({ dataDir, storageBase: base, registryPk: cfg.registryPk, serviceToken: SERVICE, webhook: process.env.ALERT_WEBHOOK, open: { enabled: openEnrollment, attrs: ALL_OPERATIONAL_ATTRS } });
nodeServers = servers;
gateway = startGateway({ dataDir, port: bytPort, registryPk: cfg.registryPk, facility: { ma: process.env.MEDABE_MA_CSKCB ?? 'DEMO0001', ten: 'Cơ sở khám sức khoẻ (demo)' } }).server;
discovery = startDiscovery({ port: springPort, registryPk: cfg.registryPk });

if (!process.env.NO_WEB) {
  const web = express(); web.use(lanOnly);
  web.use(express.static(resolve('app/web/dist')));
  web.listen(webPort, '0.0.0.0');
}
// Ứng dụng RIÊNG cho phụ huynh (tra cứu bằng số CCCD) - mở trên điện thoại hoặc trình duyệt cùng mạng. Có cả khi chạy nhúng trong KSK.exe.
const parentDist = resolve(process.env.PARENT_DIST ?? 'app/parent/dist');
if (existsSync(join(parentDist, 'index.html'))) {
  const parent = express(); parent.use(lanOnly);
  parent.use(express.static(parentDist));
  parent.listen(parentPort, '0.0.0.0');
}

const host = process.env.PUBLIC_HOST ?? 'localhost';
console.log(`
MedABE đang chạy
  Giao diện         : http://${host}:${webPort}
  Phụ huynh tra cứu : http://${host}:${parentPort}   (ứng dụng riêng, mở trên điện thoại cùng mạng)
  Kho mù (Spring)   : http://${host}:${springPort}
  Cổng Bộ Y tế (mô phỏng): http://${host}:${bytPort}   (liên thông + phụ huynh tra cứu; đổi mã cơ sở trong ${join(dataDir, 'byt', 'facilities.json')})
  SIEM (JSON-lines) : ${join(dataDir, 'siem', 'events.jsonl')}

Trạm quản trị: kích hoạt MỘT lần bằng gói trong file
  ${adminPackage}
(mở ứng dụng bằng  npm run desktop -- --admin-setup ; sau khi kích hoạt hãy XOÁ file này và admin-secrets.json nếu không cần.)
Token không được in ra màn hình.
Ctrl+C để dừng.`);
