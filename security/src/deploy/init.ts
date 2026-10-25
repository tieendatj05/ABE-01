// Khởi tạo cơ quan logic "MED" với khoá sinh ngưỡng 2-trên-3 (chạy MỘT LẦN, trước khi chạy hệ thống).
// Dealer sinh (α, β), chia Shamir cho 3 nút rồi KHÔNG lưu gì ngoài: tham số công khai + share của từng nút.
// Mỗi share được ghi vào thư mục RIÊNG của nút (trên máy thật: đưa qua kênh an toàn tới từng tổ chức rồi XOÁ bản dealer).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { dealAuthority } from '../abe/rw15.js';

export const ORGS = ['BenhVien', 'SoYTe', 'DienThoai'] as const;

export function initDealer(dataDir: string, force = false) {
  const dir = resolve(dataDir, 'dealer');
  const pkFile = join(dir, 'pk.json');
  if (existsSync(pkFile) && !force) return { created: false, dir };
  mkdirSync(dir, { recursive: true });
  const { pk, shares } = dealAuthority('MED', ORGS.length, 2);
  writeFileSync(pkFile, JSON.stringify(pk));
  writeFileSync(join(dir, 'index-key.txt'), randomBytes(32).toString('hex'));
  shares.forEach((s, i) => {
    const nodeDir = resolve(dataDir, 'nodes', ORGS[i]);
    mkdirSync(nodeDir, { recursive: true });
    writeFileSync(join(nodeDir, 'share.json'), JSON.stringify(s), { mode: 0o600 });
  });
  return { created: true, dir };
}

if (process.argv[1]?.endsWith('init.ts')) {
  const r = initDealer(process.env.DATA_DIR ?? 'data', process.argv.includes('--force'));
  console.log(r.created ? `Đã khởi tạo cơ quan MED (ngưỡng 2-trên-3) trong ${r.dir}` : 'Đã khởi tạo trước đó (dùng --force để tạo lại - SẼ MẤT MỌI KHOÁ CŨ)');
}
