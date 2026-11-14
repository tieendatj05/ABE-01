// Tạo TỜ QR (HTML in/chiếu được) để phát cho phụ huynh: quét bằng camera iPhone hoặc Android là mở app.
//   node launcher/qr-flyer.mjs https://phuhuynh.ten-mien-cua-ban.vn      (dùng khi đã có địa chỉ cố định)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import QRCode from 'qrcode';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ghi release/QR-PhuHuynh.html cho địa chỉ `url` và trả về đường dẫn file. */
export async function writeFlyer(url) {
  const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0b2540', light: '#ffffff' } });
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Quét mã để xem kết quả khám sức khỏe</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--b:#0a6cc4;--t:#0f9d9a;--ink:#0f2236}
*{box-sizing:border-box}body{margin:0;font-family:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif;color:var(--ink);background:#eef3f8}
.sheet{max-width:820px;margin:24px auto;background:#fff;border-radius:28px;overflow:hidden;box-shadow:0 10px 40px #0a3c6e26}
.head{padding:36px 40px 56px;color:#fff;background:linear-gradient(145deg,#0a6cc4,#0b86b8 55%,#0f9d9a)}
.head h1{margin:0 0 6px;font-size:32px;letter-spacing:-.02em}.head p{margin:0;opacity:.92;font-size:18px}
.qrwrap{display:flex;gap:36px;align-items:center;padding:0 40px;margin-top:-30px}
.qr{flex:none;width:300px;background:#fff;border-radius:24px;padding:14px;box-shadow:0 12px 34px #0a3c6e30}.qr svg{width:100%;height:auto;display:block}
.how{flex:1;padding-top:40px}.how h2{margin:0 0 10px;font-size:20px}
.how ol{margin:0;padding-left:22px;line-height:1.7;font-size:17px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:28px 40px 8px}
.card{border:1.5px solid #e3eaf1;border-radius:20px;padding:18px 20px}.card h3{margin:0 0 8px;font-size:18px;color:var(--b)}
.card ol{margin:0;padding-left:20px;line-height:1.65}
.login{margin:12px 40px 0;padding:16px 20px;border-radius:18px;background:#e7f1fc;font-size:17px}
.url{padding:18px 40px 30px;color:#53677c;font-size:14px;word-break:break-all}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none}}
@media(max-width:700px){.qrwrap{flex-direction:column;align-items:stretch}.qr{width:auto}.cols{grid-template-columns:1fr}}
</style></head><body><div class="sheet">
<div class="head"><h1>Xem kết quả khám sức khỏe của con</h1><p>Quét mã QR bằng camera điện thoại — iPhone hoặc Android</p></div>
<div class="qrwrap"><div class="qr">${qr}</div>
<div class="how"><h2>3 bước đơn giản</h2><ol><li>Mở <b>Camera</b> và quét mã bên cạnh.</li><li>Bấm vào đường dẫn hiện ra.</li><li>Bấm <b>Cài app</b> để có biểu tượng trên màn hình chính.</li></ol></div></div>
<div class="login"><b>Đăng nhập:</b> nhập <b>họ và tên</b> và <b>số CCCD</b> của học sinh. Không cần tạo tài khoản, không cần mật khẩu.</div>
<div class="cols">
<div class="card"><h3> iPhone</h3><ol><li>Mở đường dẫn bằng <b>Safari</b>.</li><li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên).</li><li>Chọn <b>Thêm vào MH chính</b>.</li></ol></div>
<div class="card"><h3> Android</h3><ol><li>Mở đường dẫn bằng <b>Chrome</b>.</li><li>Bấm <b>Cài đặt</b> ở thẻ "Cài app" trong ứng dụng.</li><li>Nếu không thấy: menu <b>⋮</b> → <b>Cài đặt ứng dụng</b>.</li></ol></div>
</div><div class="url">Hoặc nhập địa chỉ: ${url}</div></div></body></html>`;
  const out = resolve(root, 'release', 'QR-PhuHuynh.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  // Tin nhắn mẫu để dán vào Zalo gửi phụ huynh (gửi ĐƯỜNG DẪN, không gửi file: iPhone không cài được file từ Zalo).
  writeFileSync(resolve(root, 'release', 'TinNhan-Zalo.txt'), `Kết quả khám sức khỏe của con đã có trên điện thoại.

1) Bấm vào đường dẫn: ${url}
2) Nếu đường dẫn mở trong Zalo: bấm dấu ⋯ ở góc → chọn "Mở bằng Safari" (iPhone) hoặc "Mở bằng trình duyệt" (Android).
3) Bấm "Cài app" (iPhone: nút Chia sẻ → "Thêm vào MH chính").
4) Đăng nhập bằng họ tên và số CCCD của học sinh.
`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = (process.argv[2] ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(url)) { console.error('Dùng: node launcher/qr-flyer.mjs https://dia-chi-cua-ban'); process.exit(1); }
  console.log('Đã tạo tờ QR:', await writeFlyer(url));
}
