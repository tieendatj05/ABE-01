// Chạy cổng liên thông Bộ Y tế (mô phỏng) cạnh máy chủ lưu trữ. Dùng trong demo.ts (và bản nhúng trong KSK.exe) và trong test.
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { join } from 'node:path';
import { createGateway, loadFacilities, loadOrCreateGatewayKey, type Facility } from '../byt/gateway.js';

export const BYT_PORT = 8095;
/** Cổng CÔNG KHAI cho điện thoại (chỉ /api/public/* + giao diện app phụ huynh). Mặc định chỉ nghe ở 127.0.0.1; đưa ra Internet bằng đường hầm HTTPS (xem launcher/Mo-Internet-PhuHuynh.cmd). */
export const PUBLIC_PORT = 8096;
export const bytDir = (dataDir: string) => join(dataDir, 'byt');
/** Khoá công khai của cổng (sinh nếu chưa có): máy chủ lưu trữ cần biết TRƯỚC khi khởi động để công bố (có chữ ký registry) cho máy khách ghim. */
export const bytPublicKey = (dataDir: string) => loadOrCreateGatewayKey(bytDir(dataDir)).pub;

export function startGateway(o: {
  dataDir: string; port?: number; registryPk: string; facility?: Facility;
  /** Bật listener công khai (điện thoại ngoài LAN). Bỏ trống = không bật. */
  publicPort?: number; publicHost?: string; staticDir?: string; trustProxy?: boolean;
  /** HTTPS cho cổng nhân viên/Bộ Y tế (PKCS#12, cùng chứng chỉ với máy chủ). Không có => HTTP như cũ (chỉ nên dùng trong thử nghiệm: HTTP lộ siêu dữ liệu và không xác thực máy chủ). */
  tls?: { pfx: Buffer; passphrase: string };
}): { server: Server; publicServer?: Server; publicKey: string; facilities: Facility[] } {
  const dir = bytDir(o.dataDir);
  const facilities = loadFacilities(dir, o.facility ?? { ma: 'DEMO0001', ten: 'Cơ sở khám sức khoẻ (demo)' });
  const host = o.publicHost ?? '127.0.0.1';
  // Đứng sau đường hầm (nghe ở loopback) thì IP thật nằm trong header của proxy; nghe trực tiếp ra ngoài thì KHÔNG tin header (giả được).
  const trustProxy = o.trustProxy ?? (host === '127.0.0.1' || host === '::1' || host === 'localhost');
  const { app, publicApp, publicKey } = createGateway({ dir, registryPk: o.registryPk, facilities, staticDir: o.staticDir, trustProxy });
  const server = o.tls ? createHttps({ pfx: o.tls.pfx, passphrase: o.tls.passphrase, minVersion: 'TLSv1.2' }, app) : createHttp(app);
  server.listen(o.port ?? BYT_PORT, '0.0.0.0');
  let publicServer: Server | undefined;
  if (o.publicPort !== undefined) { publicServer = createHttp(publicApp); publicServer.listen(o.publicPort, host); }
  return { server, publicServer, publicKey, facilities };
}
