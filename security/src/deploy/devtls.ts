// Sinh CA nội bộ + chứng chỉ máy chủ cho môi trường DEV/NGHIÊN CỨU bằng keytool của JDK (không cần openssl).
//   node/tsx security/src/deploy/devtls.ts <thư-mục> [san1,san2,...]    ví dụ SAN: dns:localhost,ip:127.0.0.1,dns:medabe.research
// Đầu ra: ca.pem (đưa cho máy khách để GHIM), server.p12 (Spring + các nút), mật khẩu kho trong tls.json.
// Bản triển khai thật nên dùng CA của tổ chức; khoá CA ở đây chỉ để chạy thử.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface DevTls { dir: string; caPem: string; caFile: string; serverP12: string; password: string }

export function generateDevTls(dir: string, sans: string[] = ['dns:localhost', 'ip:127.0.0.1']): DevTls {
  const d = resolve(dir);
  const meta = join(d, 'tls.json');
  if (existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, 'utf8')) as { sans: string[]; password: string };
    if (JSON.stringify(m.sans) === JSON.stringify(sans)) return { dir: d, caPem: readFileSync(join(d, 'ca.pem'), 'utf8'), caFile: join(d, 'ca.pem'), serverP12: join(d, 'server.p12'), password: m.password };
  }
  for (const f of ['ca.p12', 'ca.pem', 'server.p12', 'server.pem', 'server.csr', 'tls.json']) rmSync(join(d, f), { force: true });   // SAN đổi: sinh lại từ đầu (CA mới)
  mkdirSync(d, { recursive: true });
  const pw = randomBytes(12).toString('hex');
  const kt = (...a: string[]) => execFileSync('keytool', a, { stdio: ['ignore', 'pipe', 'pipe'] });
  const common = ['-storetype', 'PKCS12', '-storepass', pw, '-keypass', pw];
  const ca = join(d, 'ca.p12'), srv = join(d, 'server.p12');
  kt('-genkeypair', '-alias', 'ca', '-keyalg', 'EC', '-groupname', 'secp256r1', '-sigalg', 'SHA256withECDSA', '-dname', 'CN=MedABE Research Dev CA',
    '-ext', 'bc:c=ca:true', '-ext', 'ku:c=keyCertSign,cRLSign', '-validity', '825', '-keystore', ca, ...common);
  kt('-exportcert', '-alias', 'ca', '-keystore', ca, '-storepass', pw, '-rfc', '-file', join(d, 'ca.pem'));
  kt('-genkeypair', '-alias', 'server', '-keyalg', 'EC', '-groupname', 'secp256r1', '-sigalg', 'SHA256withECDSA', '-dname', 'CN=medabe.research',
    '-validity', '825', '-keystore', srv, ...common);
  kt('-certreq', '-alias', 'server', '-keystore', srv, '-storepass', pw, '-file', join(d, 'server.csr'));
  kt('-gencert', '-alias', 'ca', '-keystore', ca, '-storepass', pw, '-infile', join(d, 'server.csr'), '-outfile', join(d, 'server.pem'), '-rfc',
    '-validity', '825', '-sigalg', 'SHA256withECDSA', '-ext', `san=${sans.join(',')}`, '-ext', 'eku=serverAuth', '-ext', 'ku:c=digitalSignature');
  kt('-importcert', '-alias', 'ca', '-keystore', srv, '-storepass', pw, '-file', join(d, 'ca.pem'), '-noprompt');
  kt('-importcert', '-alias', 'server', '-keystore', srv, '-storepass', pw, '-file', join(d, 'server.pem'));
  for (const f of ['ca.p12', 'server.csr']) rmSync(join(d, f), { force: true });          // khoá CA KHÔNG cần nữa sau khi đã cấp chứng chỉ: xoá để không ai dùng nó cấp chứng chỉ giả
  writeFileSync(meta, JSON.stringify({ sans, password: pw }), { mode: 0o600 });
  return { dir: d, caPem: readFileSync(join(d, 'ca.pem'), 'utf8'), caFile: join(d, 'ca.pem'), serverP12: srv, password: pw };
}

if (process.argv[1]?.endsWith('devtls.ts')) {
  const t = generateDevTls(process.argv[2] ?? 'data-research/tls', process.argv[3]?.split(','));
  console.log(`CA: ${t.caFile}\nMáy chủ: ${t.serverP12}\n(Mật khẩu kho nằm trong ${join(t.dir, 'tls.json')})`);
}
