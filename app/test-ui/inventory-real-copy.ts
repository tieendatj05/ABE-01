// KIỂM KÊ xung đột dữ liệu cũ với mô hình tác giả, chạy trên BẢN SAO của CSDL (không đụng CSDL đang chạy). CHỈ ĐỌC.
//   npx tsx app/test-ui/inventory-real-copy.ts "<thư mục chứa medabe.mv.db>"
// Mặc định lấy bản sao lưu mới nhất trong %APPDATA%\KSK-TaiKhoan\backup-truoc-tac-gia-*\db. In ra số liệu tổng hợp (không có nội dung, không có mã bệnh nhân).
import { cpSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startResearchStack } from '../../security/src/deploy/research-stack.js';
import { MedClient } from '../../security/src/client/medclient.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';

const appdata = process.env.APPDATA ?? '';
const root = join(appdata, 'KSK-TaiKhoan');
const src = process.argv[2] ?? join(root, readdirSync(root).filter((d) => d.startsWith('backup-truoc-tac-gia-')).sort().pop() ?? '', 'db');
if (!existsSync(join(src, 'medabe.mv.db'))) throw new Error('Không thấy medabe.mv.db trong ' + src);
const work = mkdtempSync(join(tmpdir(), 'inv-copy-'));
cpSync(src, join(work, 'db'), { recursive: true });
console.log('Bản sao CSDL:', join(work, 'db'), '(CSDL gốc không bị đụng tới)');

const S = await startResearchStack({
  dataDir: join(work, 'run'), legacyBridge: true, passwordIterations: 20000,
  persist: { dbUrl: `jdbc:h2:file:${join(work, 'db', 'medabe').replace(/\\/g, '/')};AUTO_SERVER=FALSE`, serviceToken: 'copy-svc-token', kek: '00'.repeat(32), adminToken: 'copy-admin', siemToken: 'copy-siem' },
  seedUsers: 'kiemke|Passw0rd-KK01-xx|QUAN_TRI||Kiem ke (ban sao)',
});
try {
  const c = await MedClient.signIn(S.baseUrl, 'kiemke', 'Passw0rd-KK01-xx', new MemoryDeviceKeyStore(), { fetch: S.fetch });
  const inv = await c.api<Record<string, unknown>>('GET', '/api/v2/admin/inventory');
  console.log(JSON.stringify(inv, null, 2));
} finally { await S.stop(); }
