// TÁCH MỘT NÚT CẤP KHOÁ SANG MÁY KHÁC: xuất "gói nút" (share + khoá chỉ mục + CA + lệnh chạy) để chép bằng USB sang máy/đơn vị giữ nút đó.
//   npx tsx security/src/deploy/tach-nut.ts --org=SoYTe --dich=E:\GoiNut-SoYTe --may-chu=https://192.168.1.50:8443 [--du-lieu=data-research] [--cong=9102] [--p12=<kho TLS của nút> --mat-khau=<mật khẩu kho>]
//   Sau khi nút mới CHẠY ĐƯỢC ở máy kia, gỡ share khỏi máy chủ chính:
//   npx tsx security/src/deploy/tach-nut.ts --org=SoYTe --xoa-khoi-may-nay --xac-nhan-nut-moi=https://10.0.0.5:9102 [--du-lieu=data-research]
//     (công cụ hỏi thẳng nút mới xem đúng nút SoYTe, đúng share chưa; đúng thì ĐỔI TÊN share.json trên máy này thành share.json.da-chuyen-<ngày>, không xoá hẳn)
// QUY TẮC: máy chủ chính chỉ được giữ TỐI ĐA 1 trong 3 share (ngưỡng 2): chuyển ÍT NHẤT 2 nút sang hai bên khác nhau, kể cả khi mỗi bên là một máy riêng của cùng công ty.
// Gói chứa share và token dịch vụ: chép bằng USB/kênh an toàn, KHÔNG gửi email/chat, xoá bản chép sau khi nút chạy.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tlsFetch } from '../common/tls.js';
import { ORGS } from './init.js';

const PORT: Record<string, number> = { BenhVien: 9101, SoYTe: 9102, DienThoai: 9103 };

export interface ExportOptions { dataDir: string; org: string; outDir: string; storageUrl: string; port?: number; tlsP12?: string; tlsPassword?: string }

/** Ghi gói nút ra outDir. Trả về các tệp đã tạo. KHÔNG sửa gì ở dataDir. */
export function exportNodePackage(o: ExportOptions): string[] {
  if (!(ORGS as readonly string[]).includes(o.org)) throw new Error(`Tên nút phải là một trong ${ORGS.join(', ')}`);
  const share = join(resolve(o.dataDir), 'nodes', o.org, 'share.json');
  const idx = join(resolve(o.dataDir), 'dealer', 'index-key.txt');
  const ca = join(resolve(o.dataDir), 'tls', 'ca.pem');
  const secrets = join(resolve(o.dataDir), 'secrets.json');
  for (const f of [share, idx, ca, secrets]) if (!existsSync(f)) throw new Error('Thiếu ' + f + (f === share ? ' (nút này đã được chuyển đi chưa?)' : ''));
  const out = resolve(o.outDir);
  mkdirSync(join(out, 'nodes', o.org), { recursive: true });
  mkdirSync(join(out, 'dealer'), { recursive: true });
  const made: string[] = [];
  const put = (from: string, to: string, mode?: number) => { copyFileSync(from, to); made.push(to); void mode; };
  put(share, join(out, 'nodes', o.org, 'share.json'));
  put(idx, join(out, 'dealer', 'index-key.txt'));
  put(ca, join(out, 'ca.pem'));
  let tlsLines = ['rem Nút cần một chứng chỉ HTTPS (PKCS12) hợp lệ cho ĐỊA CHỈ của máy này, ký bởi cùng CA (hoặc CA tổ chức). Điền đường dẫn + mật khẩu:', 'set TLS_P12=%~dp0nut-tls.p12', 'set TLS_PASSWORD=ĐIỀN-MẬT-KHẨU-KHO'];
  if (o.tlsP12) {
    const dst = join(out, 'nut-tls.p12'); copyFileSync(resolve(o.tlsP12), dst); made.push(dst);
    tlsLines = ['set TLS_P12=%~dp0nut-tls.p12', `set TLS_PASSWORD=${o.tlsPassword ?? 'ĐIỀN-MẬT-KHẨU-KHO'}`];
  }
  const token = (JSON.parse(readFileSync(secrets, 'utf8')) as { serviceToken: string }).serviceToken;
  const port = o.port ?? PORT[o.org];
  const cmd = [
    '@echo off', 'chcp 65001 >nul', `title KSK - Nut cap khoa ${o.org} (chay rieng)`, 'cd /d "%~dp0"',
    'rem GOI NAY CHUA SHARE + TOKEN: giu bi mat, xoa ban chep thua. Can Node.js va thu muc du an (security\\src\\deploy\\node-server.ts); KHONG can Java.',
    `set NODE_ORG=${o.org}`, 'set NODE_DATA_DIR=%~dp0', `set NODE_PORT=${port}`,
    `set STORAGE_URL=${o.storageUrl.replace(/\/$/, '')}`, 'set CA_FILE=%~dp0ca.pem', `set MEDABE_SERVICE_TOKEN=${token}`,
    ...tlsLines,
    'rem Chay trong thu muc du an (sua duong dan cho dung may nay):', 'cd /d "ĐIỀN-ĐƯỜNG-DẪN-THƯ-MỤC-DỰ-ÁN"', 'npx tsx security/src/deploy/node-server.ts', 'pause', '',
  ].join('\r\n');
  const cmdFile = join(out, 'chay-nut.cmd'); writeFileSync(cmdFile, cmd, { mode: 0o600 }); made.push(cmdFile);
  const guide = join(out, 'HUONG-DAN.txt');
  writeFileSync(guide, [
    `GÓI NÚT CẤP KHOÁ ${o.org}`, '',
    '1. Chép nguyên thư mục này sang máy sẽ giữ nút (USB, không email/chat).',
    '2. Máy đó cần: Node.js + thư mục dự án medabe (đã chạy npm install); không cần Java.',
    '3. Mở chay-nut.cmd, điền mật khẩu kho TLS và đường dẫn thư mục dự án; kho TLS (PKCS12) phải hợp lệ cho địa chỉ của máy đó.',
    `4. Mở cổng ${port} trên tường lửa của máy đó cho máy chủ chính và máy nhân viên.`,
    `5. Chạy chay-nut.cmd. Trên máy chủ chính đặt "nutTuXa": {"${o.org}": "https://<địa-chỉ-máy-này>:${port}"} trong data-research\\cau-hinh-may-chu.json rồi khởi động lại máy chủ.`,
    '6. Kiểm tra đăng nhập thử, rồi trên máy chủ chính chạy tach-nut.ts --xoa-khoi-may-nay để gỡ share khỏi máy chủ.',
    '7. Xoá bản chép gói sau khi nút chạy ổn; chỉ giữ một bản lưu trữ an toàn ngoại tuyến (mất share + mất máy = mất một phần ngưỡng).', '',
  ].join('\r\n'), { mode: 0o600 });
  made.push(guide);
  return made;
}

/** Hỏi thẳng nút mới (qua HTTPS, xác minh CA) xem có đúng nút o.org với đúng share không; đúng thì ĐỔI TÊN share cục bộ (không xoá). Trả về số share còn lại trên máy này. */
export async function retireLocalShare(o: { dataDir: string; org: string; newNodeUrl: string }): Promise<{ renamed: string; localSharesLeft: number }> {
  const dir = join(resolve(o.dataDir), 'nodes', o.org);
  const share = join(dir, 'share.json');
  if (!existsSync(share)) throw new Error('Không còn share của nút này trên máy (đã chuyển rồi?)');
  const local = JSON.parse(readFileSync(share, 'utf8')) as { x: number; k: number; n: number };
  const f = tlsFetch(readFileSync(join(resolve(o.dataDir), 'tls', 'ca.pem'), 'utf8'));
  const info = (await (await f(o.newNodeUrl.replace(/\/$/, '') + '/info')).json()) as { org?: string; x?: number; k?: number; n?: number };
  if (info.org !== o.org || info.x !== local.x || info.k !== local.k || info.n !== local.n)
    throw new Error(`Nút ở ${o.newNodeUrl} KHÔNG khớp (hỏi được: org=${info.org}, x=${info.x}; cần org=${o.org}, x=${local.x}). Không gỡ share khỏi máy này.`);
  const renamed = join(dir, `share.json.da-chuyen-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
  renameSync(share, renamed);
  const left = (ORGS as readonly string[]).filter((g) => existsSync(join(resolve(o.dataDir), 'nodes', g, 'share.json'))).length;
  return { renamed, localSharesLeft: left };
}

if (process.argv[1]?.endsWith('tach-nut.ts')) {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const dataDir = arg('du-lieu') ?? 'data-research';
  const org = arg('org') ?? '';
  try {
    if (process.argv.includes('--xoa-khoi-may-nay')) {
      const url = arg('xac-nhan-nut-moi');
      if (!url) throw new Error('Thiếu --xac-nhan-nut-moi=https://địa-chỉ-nút-mới:cổng (công cụ phải hỏi được nút mới trước khi gỡ share ở đây)');
      const r = await retireLocalShare({ dataDir, org, newNodeUrl: url });
      console.log(`✓ Nút mới ở ${url} đúng là nút ${org}. Đã đổi tên share trên máy này thành ${r.renamed} (có thể đổi lại nếu cần).`);
      console.log(r.localSharesLeft > 1 ? `(!) Máy này vẫn giữ ${r.localSharesLeft} share: cần chuyển thêm để chỉ còn TỐI ĐA 1.` : `Máy này còn giữ ${r.localSharesLeft} share — đạt yêu cầu "tối đa 1".`);
      console.log('Nhớ đặt "nutTuXa" trong data-research\\cau-hinh-may-chu.json và khởi động lại máy chủ.');
    } else {
      const files = exportNodePackage({ dataDir, org, outDir: arg('dich') ?? `GoiNut-${org}`, storageUrl: arg('may-chu') ?? 'https://ĐIỀN-ĐỊA-CHỈ-MÁY-CHỦ:8443', port: arg('cong') ? Number(arg('cong')) : undefined, tlsP12: arg('p12'), tlsPassword: arg('mat-khau') });
      console.log(`Đã tạo gói nút ${org} (${files.length} tệp) tại ${resolve(arg('dich') ?? `GoiNut-${org}`)} — đọc HUONG-DAN.txt trong đó.`);
      console.log('Gói chứa share và token dịch vụ: chép bằng USB, không gửi qua mạng/chat, xoá bản chép sau khi dùng.');
    }
  } catch (e) { console.error('LỖI: ' + (e instanceof Error ? e.message : String(e))); process.exit(1); }
}
