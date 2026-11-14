import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { session } from './session.js';
import { log, run } from './ui.js';

// Xác thực hai lớp (TOTP) cho tài khoản QUẢN TRỊ. Khi máy chủ bật admin-mfa, mọi việc quản trị (tài khoản, lịch, nhật ký, máy đã đăng ký) bị chặn cho đến khi phiên này nhập
// đúng mã 6 số từ ứng dụng xác thực (Google/Microsoft Authenticator...). Lần đầu: nhập lại mật khẩu → quét mã QR → nhập mã để xác nhận. Mã bí mật máy chủ lưu đã mã hoá.
// Máy chủ không bật tính năng này (required=false) thì bọc này đi thẳng vào trang quản trị.
type Status = { required: boolean; enrolled: boolean; verified: boolean; freshMinutes: number };

export function AdminMfaGate({ children }: { children: ReactNode }) {
  const c = session.client!;
  const [st, setSt] = useState<Status | null>(null);
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null);
  const load = () => c.mfaStatus().then(setSt);
  useEffect(() => {
    void run('Kiểm tra xác thực hai lớp', async () => { await load(); });
    // MFA hết hạn (mfa.freshMinutes) thì màn quản trị tự khoá lại và hỏi lại mã
    const t = setInterval(() => { void load().catch(() => undefined); }, 30_000);
    return () => clearInterval(t);
  }, [c]);

  if (!st) return <div className="pagebody"><section><p>Đang kiểm tra xác thực hai lớp…</p></section></div>;
  if (!st.required || st.verified) return <>{children}</>;

  const startEnroll = () => run('Đăng ký xác thực hai lớp', async () => {
    const e = await c.mfaEnroll(pw); setPw('');
    setEnrol({ secret: e.secret, qr: await QRCode.toDataURL(e.uri, { width: 220, margin: 1 }) });
    log('Quét mã QR bằng ứng dụng xác thực rồi nhập mã 6 số để xác nhận.', 'ok');
  });
  const confirmCode = () => run('Xác thực hai lớp', async () => {
    await c.mfaVerify(code.trim()); setCode(''); setEnrol(null);
    await load();
    log(`Đã xác thực hai lớp: quản trị mở khoá trong ${st.freshMinutes} phút.`, 'ok');
  });

  return (
    <div className="pagebody">
      <section>
        <h2>🔐 Xác thực hai lớp cho Quản trị</h2>
        <p className="warnbar" role="note" style={{ marginTop: 0 }}>Tài khoản Quản trị là tài khoản mạnh nhất (cấp tài khoản, đổi mật khẩu, xem nhật ký). Vì vậy <b>bắt buộc</b> nhập thêm mã 6 số từ ứng dụng xác thực trên điện thoại của bạn, ngoài mật khẩu. Phiên quản trị tự khoá lại sau <b>{st.freshMinutes} phút</b> kể từ lần nhập mã.</p>
        {!st.enrolled && !enrol && (
          <div className="row" style={{ alignItems: 'center' }}>
            <span style={{ flex: 'none' }}>Bạn chưa đăng ký. Nhập lại mật khẩu để tạo mã QR:</span>
            <input type="password" aria-label="Mật khẩu để đăng ký MFA" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pw) void startEnroll(); }} style={{ maxWidth: 260 }} />
            <button disabled={!pw} onClick={() => void startEnroll()}>Tạo mã QR</button>
          </div>
        )}
        {enrol && (
          <div className="row" style={{ alignItems: 'center' }}>
            <img src={enrol.qr} alt="Mã QR đăng ký MFA" width={220} height={220} style={{ flex: 'none' }} />
            <div>Quét bằng Google/Microsoft Authenticator. Không quét được thì nhập tay mã bí mật:<br /><code aria-label="Bí mật MFA" style={{ userSelect: 'all', fontSize: 15 }}>{enrol.secret}</code><br /><small>Mã bí mật chỉ hiện <b>một lần</b>. Cất ở nơi an toàn: mất điện thoại thì cần quản trị khác (hoặc người có quyền trên máy chủ) đặt lại.</small></div>
          </div>
        )}
        {(st.enrolled || enrol) && (
          <div className="row" style={{ alignItems: 'center' }}>
            <span style={{ flex: 'none' }}>{enrol ? 'Nhập mã 6 số để xác nhận đăng ký:' : 'Nhập mã 6 số trong ứng dụng xác thực:'}</span>
            <input inputMode="numeric" maxLength={6} autoFocus aria-label="Mã MFA 6 số" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void confirmCode(); }} style={{ maxWidth: 140 }} />
            <button disabled={code.length !== 6} onClick={() => void confirmCode()}>Xác nhận</button>
          </div>
        )}
      </section>
    </div>
  );
}
