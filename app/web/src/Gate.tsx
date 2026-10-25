import { useEffect, useRef, useState } from 'react';
import { MedClient } from '../../../security/src/index.js';
import { bridge } from './bridge.js';
import { defaultStorageBase, hasVault, session, setStorageBase, wipeVault } from './session.js';
import { discoverServers, enrollmentAt } from './network.js';
import { log, run } from './ui.js';

const ORGS = ['BenhVien', 'SoYTe', 'DienThoai'];

/**
 * Vào ứng dụng. Lần đầu: chỉ cần NHẬP TÊN (quyền do quản trị đặt sẵn, người dùng không phải chọn gì). Có tuỳ chọn tự mở khoá để các lần
 * sau mở app là dùng ngay. Quản trị có thể tắt đăng ký tự do - khi đó cần "gói đăng ký" do quản trị cấp (phần Nâng cao).
 */
export function Gate() {
  const [base, setBase] = useState('');
  const [vault, setVault] = useState<boolean | null>(null);
  const [auto, setAuto] = useState<'pending' | 'no'>('pending');
  const [open, setOpen] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [autoUnlock, setAutoUnlock] = useState(true);
  const [pass, setPass] = useState('');
  const [pkg, setPkg] = useState('');
  const [invite, setInvite] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [pass1, setPass1] = useState('');
  const [failed, setFailed] = useState(false);
  const [reach, setReach] = useState<boolean | null>(null);
  const [addr, setAddr] = useState('');
  const started = useRef(false);
  const searching = useRef(false);
  const [servers, setServers] = useState<{ url: string; registryPk: string }[]>([]);

  useEffect(() => {
    void (async () => {
      setBase(await defaultStorageBase());
      setVault(await hasVault());
      await session.tryAutoUnlock().catch(() => false);
      setAuto('no');
    })();
  }, []);
  const check = async (b: string) => {
    if (searching.current) return;
    searching.current = true;
    try {
      try { setOpen(await enrollmentAt(b)); setReach(true); return; } catch { /* IP cũ hoặc máy chủ chưa bật */ }
      const found = await discoverServers(); setServers(found);
      if (found.length !== 1) { setReach(false); return; }
      const next = found[0].url;
      const isOpen = await enrollmentAt(next);
      await setStorageBase(next); setBase(next); setAddr(next); setOpen(isOpen); setReach(true);
    } catch { setReach(false); }
    finally { searching.current = false; }
  };
  useEffect(() => {
    if (!base || vault !== false) return;
    setAddr(base); void check(base);
    const timer = setInterval(() => { if (!started.current) void check(base); }, 5000);
    return () => clearInterval(timer);
  }, [base, vault]);

  // Máy mới + đăng ký tự do đang bật: tự đăng ký luôn, không hỏi gì (tên lấy theo tên máy; quyền do quản trị đặt sẵn).
  useEffect(() => {
    if (!bridge || !base || vault !== false || open !== true || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const host = (await bridge.hardware()).host || 'May-tram';
        await session.quickSetup(base, host, true);
        log('Đã sẵn sàng. Khoá riêng được tạo trên máy này và không rời khỏi máy.', 'ok');
      } catch (e) { setFailed(true); log('Tự đăng ký thất bại: ' + (e as Error).message, 'err'); }
    })();
  }, [base, vault, open]);

  if (vault === false && reach === false) {
    return (
      <section>
        <h2>Không kết nối được máy chủ</h2>
        <p>Đang tự tìm KSK Admin trong mạng nội bộ. Kết nối cùng Wi-Fi/LAN với máy Admin để làm việc.</p>
        {servers.length > 1 && <p>Có nhiều máy chủ trong mạng. Chọn đúng máy quản trị:</p>}
        {servers.map((server) => <button key={server.url} onClick={() => void (async () => { await setStorageBase(server.url); setBase(server.url); })()}>{server.url}</button>)}
        <p className="warnbar">Không thấy máy chủ tại <b>{base}</b>. Hãy kiểm tra máy quản trị đã bật KSK chưa, cùng mạng wifi/LAN chưa, và tường lửa đã mở cổng (chạy <code>npm run parent:firewall</code> trên máy quản trị).</p>
        <input placeholder="Địa chỉ máy chủ, ví dụ http://192.168.1.39:8090" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addr.trim() && void (async () => { await setStorageBase(addr.trim()); setBase(addr.trim().replace(/\/+$/, '')); })()} />
        <button disabled={!addr.trim()} onClick={() => void (async () => { await setStorageBase(addr.trim()); const b = addr.trim().replace(/\/+$/, ''); if (b === base) void check(b); else setBase(b); })()}>Kết nối</button>
      </section>
    );
  }
  if (vault === false && reach === null) return <div className="gatewrap"><p className="sub">Đang kết nối máy chủ…</p></div>;
  if (bridge && vault === false && open === true && !failed) return <div className="gatewrap"><p className="sub">Đang chuẩn bị máy này…</p></div>;
  if (vault === null || (vault && auto === 'pending')) return <div className="gatewrap"><p className="sub">Đang mở…</p></div>;

  // ===== Đã đăng ký: mở khoá bằng passphrase =====
  if (vault) {
    return (
      <section>
        <h2>Nhập passphrase để mở</h2>
        <div className="row">
          <input type="password" placeholder="Passphrase" value={pass} autoFocus autoComplete="current-password"
            onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void run('Mở khoá', () => session.unlock(pass))} />
          <button onClick={() => void run('Mở khoá', () => session.unlock(pass))}>Mở khoá</button>
        </div>
        <p className="sub">Kho khoá được bảo vệ bằng passphrase <b>và</b> khoá của máy này. Chép sang máy khác sẽ không mở được.</p>
        <a href="#" className="bad" onClick={(e) => { e.preventDefault(); if (confirm('Xoá khoá trên máy này? Bạn sẽ phải đăng ký lại.')) void wipeVault().then(() => setVault(false)); }}>Quên passphrase? Xoá và đăng ký lại</a>
      </section>
    );
  }

  // ===== Lần đầu =====
  const quick = () => run('Đăng ký', async () => {
    await session.quickSetup(base, name, autoUnlock && !!bridge, pass);
    log('Xong! Bạn có thể bắt đầu làm việc. Khoá riêng được tạo trên máy này và không rời khỏi máy.', 'ok');
  });
  const advanced = () => run('Đăng ký bằng gói', async () => {
    const p = new URLSearchParams(pkg.trim().replace(/^.*\?/, ''));
    const i = invite.trim() || p.get('i') || '';
    const all: Record<string, string> = { ...Object.fromEntries(p.getAll('a').map((x) => { const j = x.indexOf(':'); return [x.slice(0, j), x.slice(j + 1)]; })), ...codes };
    await session.setup(base, i, ORGS.filter((o) => all[o]?.trim()).map((o) => [o, all[o].trim()] as [string, string]), pass1);
    log('Đăng ký xong.', 'ok');
  });

  return (
    <section>
      <h2>Chào mừng đến MedABE</h2>
      {open === false ? (
        <p className="warnbar">Quản trị đang <b>tắt</b> đăng ký tự do. Hãy nhờ quản trị cấp <b>gói đăng ký</b> rồi dán vào phần "Nâng cao" bên dưới.</p>
      ) : (
        <>
          <p className="sub">Chỉ cần nhập tên của bạn để bắt đầu. Dữ liệu được mã hoá ngay trên máy này; máy chủ không đọc được.</p>
          <input placeholder="Họ và tên của bạn" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void quick()} />
          {bridge && (
            <label className="radio" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={autoUnlock} onChange={(e) => setAutoUnlock(e.target.checked)} />
              Tự mở khoá trên máy này (không hỏi passphrase mỗi lần mở)
            </label>
          )}
          {(!autoUnlock || !bridge) && <input type="password" placeholder="Đặt passphrase (tối thiểu 8 ký tự)" value={pass} autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />}
          <button disabled={!name.trim() || ((!autoUnlock || !bridge) && pass.length < 8)} onClick={() => void quick()}>Bắt đầu</button>
        </>
      )}

      <details style={{ marginTop: 16 }} open={open === false}>
        <summary>Nâng cao: dùng gói đăng ký do quản trị cấp / đổi địa chỉ máy chủ</summary>
        <div style={{ marginTop: 8 }}>
          <input placeholder="Địa chỉ máy chủ lưu trữ" value={base} onChange={(e) => setBase(e.target.value)} />
          <input placeholder="Dán gói đăng ký (nếu có)" value={pkg} onChange={(e) => setPkg(e.target.value)} />
          <input placeholder="Mã mời (registry)" value={invite} onChange={(e) => setInvite(e.target.value)} />
          <div className="row">
            {ORGS.map((o) => <input key={o} placeholder={`Mã ${o}`} value={codes[o] ?? ''} onChange={(e) => setCodes({ ...codes, [o]: e.target.value })} />)}
          </div>
          <input type="password" placeholder="Đặt passphrase (tối thiểu 8 ký tự)" value={pass1} autoComplete="new-password" onChange={(e) => setPass1(e.target.value)} />
          <button disabled={pass1.length < 8 || (!pkg.trim() && !invite.trim())} onClick={() => void advanced()}>Đăng ký bằng gói</button>
        </div>
      </details>
    </section>
  );
}
