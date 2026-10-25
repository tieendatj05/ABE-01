// Chạy 3 nút cấp khoá (mỗi nút một cổng, một thư mục dữ liệu, một admin token riêng).
//   npx tsx src/deploy/nodes.ts      (cần Spring storage đang chạy; xem scripts/start-demo.mjs)
import { readFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { join, resolve } from 'node:path';
import { createNode } from '../authority/node.js';
import type { Share } from '../abe/rw15.js';
import { ORGS } from './init.js';

/** Token quản trị KHÔNG còn giá trị mặc định đoán được: thiếu biến môi trường thì từ chối khởi động. */
const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error('Thiếu biến môi trường ' + name + ' (không còn token mặc định). Chạy npm run demo để tự sinh token ngẫu nhiên.');
  return v;
};

export const NODE_PORTS: Record<string, number> = { BenhVien: 9001, SoYTe: 9002, DienThoai: 9003 };

export const ALL_OPERATIONAL_ATTRS = ['Role:TiepDon', 'Role:BacSi', 'Role:KTV', 'Role:KetLuan', 'Khoa:Nhi', 'Khoa:Mat', 'Khoa:TMH', 'Khoa:RHM', 'Khoa:XetNghiem'];

export function startNodes(opts: { open?: { enabled: boolean; attrs: string[] }; ports?: Record<string, number>; dataDir: string; storageBase: string; registryPk: string; serviceToken: string; webhook?: string }) {
  const indexKey = readFileSync(resolve(opts.dataDir, 'dealer', 'index-key.txt'), 'utf8').trim();
  const tokens: Record<string, string> = {};
  const servers = ORGS.map((org) => {
    const dir = resolve(opts.dataDir, 'nodes', org);
    const share = JSON.parse(readFileSync(join(dir, 'share.json'), 'utf8')) as Share;
    const adminToken = need(`ADMIN_TOKEN_${org}`);
    const approverToken = need('APPROVER_TOKEN');
    tokens[org] = adminToken;
    const { app } = createNode({
      dir, org, share, adminToken, registryPk: opts.registryPk, storageBase: opts.storageBase, serviceToken: opts.serviceToken,
      indexKey, requiresApproval: org === 'DienThoai', approverToken, webhook: opts.webhook, defaultOpen: opts.open,
    });
    const s = createHttp(app);
    s.listen((opts.ports ?? NODE_PORTS)[org], '0.0.0.0');
    return s;
  });
  return { servers, tokens };
}

if (process.argv[1]?.endsWith('nodes.ts')) {
  const storageBase = process.env.STORAGE_URL ?? 'http://127.0.0.1:8090';
  const cfg = await (await fetch(`${storageBase}/api/config`)).json() as { registryPk: string };
  const { tokens } = startNodes({
    dataDir: process.env.DATA_DIR ?? 'data', storageBase, registryPk: cfg.registryPk,
    serviceToken: need('MEDABE_SERVICE_TOKEN'), webhook: process.env.ALERT_WEBHOOK,
  });
  for (const [org, t] of Object.entries(tokens)) console.log(`Nút ${org}: cổng ${NODE_PORTS[org]}, admin token ${t} (CHỈ demo)`);
}
