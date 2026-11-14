import { useEffect, useState } from 'react';
import { bridge, cleanIpcError, type AdminStatus } from './bridge.js';
import { log, run } from './ui.js';

/** Kích hoạt MỘT lần: chỉ có khi mở app bằng tham số --admin-setup. Gói do máy chủ sinh ra (admin-package.txt). */
export function AdminSetup({ onDone }: { onDone: () => void }) {
  const [pkg, setPkg] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [auto, setAuto] = useState(false);
  useEffect(() => { void bridge!.admin!.pending().then((p) => { if (p) { setPkg(p); setAuto(true); } }); }, []);
  return (
    <div className="page"><div className="strip secstrip">🔒 KÍCH HOẠT TRẠM QUẢN TRỊ</div>
      <div className="pagebody">
        {auto ? <p className="ok">Đã nhận gói kích hoạt.</p>
          : <input placeholder="Gói kích hoạt (MEDABE-ADMIN1:...)" value={pkg} onChange={(e) => setPkg(e.target.value)} />}
        <input type="password" placeholder="Mật khẩu quản trị (≥ 10 ký tự, có chữ và số)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <input type="password" placeholder="Nhập lại mật khẩu" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        <p className="warnbar">Mật khẩu <b>không thể khôi phục</b>.</p>
        <button disabled={!pkg.trim() || !pw || pw !== pw2} onClick={() => void run('Kích hoạt trạm quản trị', async () => {
          await bridge!.admin!.enroll(pkg.trim(), pw);
          setPkg(''); setPw(''); setPw2('');
          log('Đã kích hoạt trạm quản trị.', 'ok');
          onDone();
        })}>Kích hoạt</button>
      </div>
    </div>
  );
}

/** Màn nhập mật khẩu quản trị: hiện trước mọi trang quản trị. Sai 5 lần thì khoá (thời gian tăng dần); tự khoá sau 5 phút không dùng. */
export function AdminGate({ status, onDone }: { status: AdminStatus; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = status.lockedUntil > now ? Math.ceil((status.lockedUntil - now) / 1000) : 0;

  const submit = async () => {
    setErr('');
    try {
      await bridge!.admin!.unlock(pw);
      setPw('');
      onDone();
    } catch (e) {
      setErr(cleanIpcError((e as Error).message));
      setPw('');
      onDone(); // làm mới trạng thái để hiện số lần còn lại / thời gian khoá
    }
  };

  return (
    <div className="gatewrap">
      <section>
        <h2>🔒 Quản trị bảo mật</h2>
        <input type="password" autoFocus placeholder="Mật khẩu quản trị" value={pw} disabled={left > 0} autoComplete="current-password"
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        <button disabled={!pw || left > 0} onClick={() => void submit()}>Mở khoá</button>
        {left > 0 && <p className="bad">Đã khoá. Thử lại sau {Math.floor(left / 60)} phút {left % 60} giây.</p>}
        {!left && err && <p className="bad">{err}</p>}
        {!left && status.attemptsLeft < 5 && <p className="warn">Còn {status.attemptsLeft} lần thử.</p>}
      </section>
    </div>
  );
}
