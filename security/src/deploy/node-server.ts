// MỘT NÚT CẤP KHOÁ chạy RIÊNG, ở máy/tiến trình KHÁC máy chủ chính. Mỗi nút giữ đúng MỘT share Shamir (ngưỡng 2-trên-3); chỉ khi share nằm ở các bên khác nhau thì
// "hai nút phải đồng ý" mới có nghĩa bảo mật (nếu cả ba share cùng nằm trên máy chủ thì ai có quyền máy chủ đều ghép lại được).
//   Chuẩn bị gói cho nút: npx tsx security/src/deploy/tach-nut.ts --org=SoYTe --dich=<thư mục> (xem tach-nut.ts), chép sang máy kia, chạy chay-nut.cmd.
//   Biến môi trường (chay-nut.cmd đã điền sẵn):
//     NODE_ORG=BenhVien|SoYTe|DienThoai   NODE_DATA_DIR=<thư mục có nodes/<ORG>/share.json và dealer/index-key.txt>   NODE_PORT=<cổng>
//     STORAGE_URL=https://<máy chủ chính>:8443   CA_FILE=<ca.pem>   MEDABE_SERVICE_TOKEN=<token dịch vụ>   TLS_P12=<kho PKCS12 của nút>   TLS_PASSWORD=<mật khẩu kho>
//     REGISTRY_PK=<khoá registry đã ghim, tuỳ chọn nhưng NÊN đặt: không khớp thì nút từ chối chạy>
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tlsFetch } from '../common/tls.js';
import { ORGS } from './init.js';
import { startNodes } from './nodes.js';

const need = (name: string): string => { const v = process.env[name]; if (!v) throw new Error('Thiếu biến môi trường ' + name); return v; };
const DEFAULT_PORT: Record<string, number> = { BenhVien: 9101, SoYTe: 9102, DienThoai: 9103 };

async function main() {
  const org = need('NODE_ORG');
  if (!(ORGS as readonly string[]).includes(org)) throw new Error(`NODE_ORG phải là một trong ${ORGS.join(', ')}`);
  const dataDir = resolve(process.env.NODE_DATA_DIR ?? '.');
  const storage = need('STORAGE_URL').replace(/\/$/, '');
  const f = tlsFetch(readFileSync(need('CA_FILE'), 'utf8'));
  const cfg = (await (await f(`${storage}/api/config`)).json()) as { registryPk: string };
  const pinned = process.env.REGISTRY_PK?.trim();
  if (pinned && pinned !== cfg.registryPk) throw new Error('Khoá registry của máy chủ KHÔNG khớp khoá đã ghim (REGISTRY_PK): có thể đang nối nhầm máy chủ giả. Dừng.');
  const port = Number(process.env.NODE_PORT ?? DEFAULT_PORT[org]);
  // token quản trị của nút chỉ dùng nội bộ tiến trình này: sinh ngẫu nhiên mỗi lần chạy, không ghi ra đâu
  process.env[`ADMIN_TOKEN_${org}`] = randomBytes(16).toString('hex');
  process.env.APPROVER_TOKEN = randomBytes(16).toString('hex');
  startNodes({
    dataDir, storageBase: storage, registryPk: cfg.registryPk, serviceToken: need('MEDABE_SERVICE_TOKEN'), ports: { [org]: port },
    research: { backendBase: storage }, fetchFn: f, tls: { pfx: readFileSync(need('TLS_P12')), passphrase: need('TLS_PASSWORD') }, only: [org],
  });
  console.log(`Nút ${org} đang chạy riêng ở cổng ${port} (HTTPS). Máy chủ chính: ${storage}. Chỉ giữ share của nút này.`);
  console.log(`READY ${JSON.stringify({ org, port })}`);
}

main().catch((e) => { console.error('LỖI: ' + (e instanceof Error ? e.message : String(e))); process.exit(1); });
