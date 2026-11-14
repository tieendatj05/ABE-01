// DỌN THIẾT BỊ của các tài khoản mẫu trên máy chủ demo (gặp lỗi DEVICE_LIMIT khi đăng nhập thử nhiều lần/nhiều trình duyệt):
//   npx tsx app/test-ui/demo-don-thiet-bi.ts
// Thu hồi MỌI thiết bị đang hoạt động của các tài khoản mẫu (trừ quantri02); lần đăng nhập sau sẽ tự đăng ký thiết bị mới. Chỉ dùng cho máy chủ demo.
import { MedClient } from '../../security/src/client/medclient.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';
import { DEMO_URL, demoFetch } from './demo-util.js';

const admin = await MedClient.signIn(DEMO_URL, 'quantri02', 'Passw0rd-QT02', new MemoryDeviceKeyStore(), { fetch: demoFetch });
const users = await admin.api<{ userId: string; username: string }[]>('GET', '/api/v2/admin/users');
const keep = new Set([users.find((u) => u.username === 'quantri02')?.userId]);
const devices = await admin.api<{ deviceId: string; userId: string; status: string }[]>('GET', '/api/v2/admin/devices');
let n = 0;
for (const d of devices) if (d.status === 'ACTIVE' && !keep.has(d.userId) && d.deviceId !== admin.s.deviceId) { await admin.api('POST', `/api/v2/admin/devices/${d.deviceId}/revoke`, {}).catch(() => undefined); n++; }
await admin.api('POST', `/api/v2/admin/devices/${admin.s.deviceId}/revoke`, {}).catch(() => undefined);
console.log(`Đã thu hồi ${n} thiết bị cũ của các tài khoản mẫu. Bạn có thể đăng nhập lại bình thường.`);
