// Chạy cổng liên thông Bộ Y tế (mô phỏng) cạnh máy chủ lưu trữ. Dùng trong demo.ts (và bản nhúng trong KSK.exe) và trong test.
import { createServer as createHttp, type Server } from 'node:http';
import { join } from 'node:path';
import { createGateway, loadFacilities, loadOrCreateGatewayKey, type Facility } from '../byt/gateway.js';

export const BYT_PORT = 8095;
export const bytDir = (dataDir: string) => join(dataDir, 'byt');
/** Khoá công khai của cổng (sinh nếu chưa có): máy chủ lưu trữ cần biết TRƯỚC khi khởi động để công bố (có chữ ký registry) cho máy khách ghim. */
export const bytPublicKey = (dataDir: string) => loadOrCreateGatewayKey(bytDir(dataDir)).pub;

export function startGateway(o: { dataDir: string; port?: number; registryPk: string; facility?: Facility }): { server: Server; publicKey: string; facilities: Facility[] } {
  const dir = bytDir(o.dataDir);
  const facilities = loadFacilities(dir, o.facility ?? { ma: 'DEMO0001', ten: 'Cơ sở khám sức khoẻ (demo)' });
  const { app, publicKey } = createGateway({ dir, registryPk: o.registryPk, facilities });
  const server = createHttp(app);
  server.listen(o.port ?? BYT_PORT, '0.0.0.0');
  return { server, publicKey, facilities };
}
