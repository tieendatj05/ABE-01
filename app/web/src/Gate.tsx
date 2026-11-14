import { useEffect, useState } from 'react';
import { MedClient, PasswordChangeRequiredError } from '../../../security/src/index.js';
import { defaultStorageBase, session } from './session.js';
import { discoverServers } from './network.js';
import { log } from './ui.js';

const explain = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  const code = m.split(/[ (:]/)[0];
  return ({
    BAD_CREDENTIALS: 'Sai email hoặc mật khẩu.', ACCOUNT_LOCKED: 'Tài khoản tạm khóa do nhập sai nhiều lần. Thử lại sau ít phút.', DENY_ACCOUNT_DISABLED: 'Tài khoản đã bị khóa. Hãy liên hệ quản trị.',
    PASSWORD_WEAK: 'Mật khẩu mới quá yếu: tối thiểu 10 ký tự (vai trò Giám sát: tối thiểu 14 ký tự), có cả chữ và số.', PASSWORD_REUSED: 'Mật khẩu mới phải khác mật khẩu tạm.', STEP_UP_FAILED: 'Mật khẩu hiện tại không đúng.',
    DEVICE_LIMIT: 'Tài khoản đã đăng ký đủ số máy tối đa. Nhờ quản trị thu hồi bớt máy cũ.', LOGIN_RATE_LIMIT: 'Đăng nhập quá nhiều lần, thử lại sau.', FORGOT_RATE_LIMIT: 'Gửi yêu cầu quá nhiều lần, thử lại sau ít phút.',
    DENY_PENDING_APPROVAL: 'Tài khoản đang chờ một quản trị viên KHÁC duyệt. Hãy liên hệ quản trị.', DENY_REMOTE_ACCESS: 'Tài khoản này không được dùng qua Internet. Hãy đăng nhập trong mạng nội bộ.',
  } as Record<string, string>)[code] ?? m;
};

/**
 * Đăng nhập bằng TÀI KHOẢN do công ty cấp (email + mật khẩu). Quản trị tạo tài khoản và đưa mật khẩu TẠM; lần đầu nhân viên phải tự đặt mật khẩu mới
 * (sau đó quản trị không biết mật khẩu). Vai trò, khoa và quyền do máy chủ quản lý — người dùng không tự chọn gì.
 */
export function Gate() {
  const [base, setBase] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [needNew, setNeedNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [finding, setFinding] = useState(false);
  const [forgot, setForgot] = useState(false);       // đang ở màn "Quên mật khẩu"
  const [sent, setSent] = useState(false);

  useEffect(() => { void defaultStorageBase().then(setBase); }, []);

  const mismatch = needNew && n1 !== n2;
  const submit = async () => {
    if (busy || mismatch) return;
    setBusy(true); setErr('');
    try {
      await session.signIn(base, email.trim(), pass, needNew ? n1 : undefined);
      log('Đã đăng nhập.', 'ok');
    } catch (e) {
      if (e instanceof PasswordChangeRequiredError) { setNeedNew(true); setErr('Đây là mật khẩu TẠM do quản trị cấp. Hãy đặt mật khẩu mới của riêng bạn (quản trị sẽ không biết mật khẩu này).'); }
      else setErr(explain(e));
    } finally { setBusy(false); }
  };
  /** Quên mật khẩu: chỉ báo cho quản trị (không đổi gì). Luôn hiện cùng một thông báo dù email có tồn tại hay không. */
  const sendForgot = async () => {
    if (busy || !email.trim()) return;
    setBusy(true); setErr('');
    try { await MedClient.requestPasswordReset(base, email.trim()); setSent(true); }
    catch (e) { setErr(explain(e)); }
    finally { setBusy(false); }
  };
  const find = async () => {
    setFinding(true); setErr('');
    try {
      const found = await discoverServers();
      if (found.length) setBase(found[0].url); else setErr('Không tìm thấy máy chủ trong mạng. Nhập địa chỉ do quản trị cung cấp (vd https://192.168.1.10:8443).');
    } finally { setFinding(false); }
  };

  if (forgot) return (
    <section>
      <h2>Quên mật khẩu</h2>
      {sent ? (
        <>
          <p className="ok" role="status">✔ Đã gửi yêu cầu tới quản trị.</p>
          <p style={{ color: '#5d6b79' }}>Nếu email này có trong hệ thống, quản trị sẽ <b>liên hệ xác minh bạn</b> (gọi lại số điện thoại đã đăng ký hoặc gặp trực tiếp) rồi đưa <b>mật khẩu tạm</b>. Đăng nhập bằng mật khẩu tạm đó và đặt mật khẩu mới của riêng bạn. Yêu cầu hết hạn sau 72 giờ.</p>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0, color: '#5d6b79' }}>Nhập email công ty của bạn. Hệ thống chỉ <b>báo cho quản trị</b>; bạn sẽ nhận mật khẩu tạm trực tiếp từ quản trị sau khi họ xác minh đúng là bạn. Hệ thống không tự gửi mật khẩu qua email hay tin nhắn.</p>
          <input type="email" placeholder="Email công ty (vd ten@congty.vn)" value={email} autoFocus autoComplete="username" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendForgot()} />
          <button disabled={busy || !email.trim()} onClick={() => void sendForgot()}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu cấp lại mật khẩu'}</button>
        </>
      )}
      {err && <p className="bad" role="alert">{err}</p>}
      <p><a href="#" onClick={(e) => { e.preventDefault(); setForgot(false); setSent(false); setErr(''); }}>← Quay lại đăng nhập</a></p>
    </section>
  );

  return (
    <section>
      <h2>Đăng nhập MedABE</h2>
      <p style={{ marginTop: 0, color: '#5d6b79' }}>Dùng email và mật khẩu do công ty cấp. Lần đầu bạn sẽ được yêu cầu đặt mật khẩu mới.</p>
      <input type="email" placeholder="Email công ty (vd ten@congty.vn)" value={email} autoFocus autoComplete="username" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      <input type="password" placeholder={needNew ? 'Mật khẩu tạm (do quản trị cấp)' : 'Mật khẩu'} value={pass} autoComplete="current-password" onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      {needNew && (
        <>
          <input type="password" placeholder="Mật khẩu mới (≥10 ký tự, Giám sát ≥14, có chữ và số)" value={n1} autoComplete="new-password" onChange={(e) => setN1(e.target.value)} />
          <input type="password" placeholder="Nhập lại mật khẩu mới" value={n2} autoComplete="new-password" onChange={(e) => setN2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          {mismatch && <p className="bad">Hai lần nhập mật khẩu mới chưa khớp.</p>}
        </>
      )}
      <button disabled={busy || !email.trim() || !pass || (needNew && (!n1 || mismatch))} onClick={() => void submit()}>{busy ? 'Đang đăng nhập…' : needNew ? 'Đặt mật khẩu mới và đăng nhập' : 'Đăng nhập'}</button>
      {err && <p className={needNew && err.startsWith('Đây là') ? 'warn' : 'bad'} role="alert">{err}</p>}
      {!needNew && <p style={{ margin: '8px 0 0' }}><a href="#" onClick={(e) => { e.preventDefault(); setForgot(true); setErr(''); }}>Quên mật khẩu?</a></p>}
      <details style={{ marginTop: 16 }}>
        <summary>Máy chủ</summary>
        <div style={{ marginTop: 8 }}>
          <input aria-label="Địa chỉ máy chủ" placeholder="https://địa-chỉ-máy-chủ:8443" value={base} onChange={(e) => setBase(e.target.value)} />
          <button disabled={finding} onClick={() => void find()}>{finding ? 'Đang tìm…' : 'Tìm máy chủ trong mạng'}</button>
        </div>
      </details>
    </section>
  );
}
