// Sinh lại gói kích hoạt trạm quản trị (khi đã xoá file hoặc cần kích hoạt thêm một trạm):  npm run admin:package
// Gói chứa token quản trị -> chỉ đưa cho người quản trị, dùng xong hãy xoá file.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadOrCreateSecrets, writeAdminPackage } from './secrets.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data-demo');
if (!existsSync(join(dataDir, 'admin-secrets.json'))) {
  console.error(`Chưa có ${join(dataDir, 'admin-secrets.json')}: hãy chạy  npm run demo  ít nhất một lần để khởi tạo.`);
  process.exit(1);
}
const file = writeAdminPackage(dataDir, loadOrCreateSecrets(dataDir));
console.log(`Đã ghi gói kích hoạt: ${file}\nMở ứng dụng bằng:  npm run desktop -- --admin-setup   rồi dán nội dung file vào màn hình kích hoạt. Dùng xong hãy XOÁ file này.`);
