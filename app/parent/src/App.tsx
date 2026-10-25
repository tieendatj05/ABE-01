import { useEffect, useMemo, useState } from 'react';
import { fetchForParent, parentVersion, type ParentItem } from '../../../security/src/index.js';
import { LAM_SANG, XET_NGHIEM, flag, type LamSangData } from '../../web/src/data/catalog.js';
import { bmi, type CanLamSang, type HanhChinh, type KetLuan, type LanKham, type TheLuc, type TienSu } from '../../web/src/model.js';

type Screen = 'home' | 'theluc' | 'lamsang' | 'xetnghiem' | 'tiensu' | 'ketluan';
const MENU: [Screen, string, string][] = [
  ['theluc', '📏', 'THỂ LỰC & CHỈ SỐ'], ['lamsang', '🩺', 'KHÁM LÂM SÀNG'], ['xetnghiem', '🧪', 'XÉT NGHIỆM'],
  ['tiensu', '📋', 'TIỀN SỬ & LẦN KHÁM'], ['ketluan', '✅', 'KẾT LUẬN'],
];

// Nguồn tra cứu mặc định: CỔNG BỘ Y TẾ (cổng 8095) trên cùng máy đang phục vụ trang này; chỉ thấy hồ sơ đã liên thông. Đổi sang kho chính (8090) trong "Cài đặt" nếu cần.
const defaultBase = () => {
  try { return localStorage.getItem('medabe.parent.base') || `${location.protocol === 'https:' ? 'https:' : 'http:'}//${location.hostname || 'localhost'}:8095`; } catch { return 'http://localhost:8095'; }
};

const fmtDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s ?? '');
const Row = ({ k, v }: { k: string; v?: string | number }) => (v === undefined || v === '' ? null : <div className="row2"><span>{k}</span><b>{v}</b></div>);

export function App() {
  const [base, setBase] = useState(defaultBase);
  const [cccd, setCccd] = useState('');
  const [dob, setDob] = useState('');
  const [items, setItems] = useState<ParentItem[] | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [live, setLive] = useState(true);

  useEffect(() => { try { localStorage.setItem('medabe.parent.base', base); } catch { /* không có localStorage */ } }, [base]);

  const search = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetchForParent(base, cccd, dob);
      if (!r.length) setErr('Không tìm thấy kết quả khám. Vui lòng kiểm tra lại số CCCD và ngày sinh của học sinh.');
      else { setItems(r); setUpdated(new Date()); setScreen('home'); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  // Cập nhật gần THỜI GIAN THỰC: mỗi 4 giây hỏi "có dữ liệu mới chưa" (rất nhẹ); có thay đổi thì tải và giải mã lại ngay trên máy này.
  useEffect(() => {
    if (!items) return;
    let last: string | undefined;
    let stop = false;
    const tick = async () => {
      try {
        const v = await parentVersion(base, cccd, dob);
        setLive(true);
        if (last !== undefined && v !== last) {
          const r = await fetchForParent(base, cccd, dob);
          if (!stop && r.length) { setItems(r); setUpdated(new Date()); }
        }
        last = v;
      } catch { setLive(false); }
    };
    void tick();
    const t = setInterval(() => void tick(), 4000);
    return () => { stop = true; clearInterval(t); };
  }, [!!items, base, cccd, dob]);
  const logout = () => { setItems(null); setCccd(''); setDob(''); setScreen('home'); setErr(''); };

  const latest = useMemo(() => (type: string, khoa?: string) =>
    items?.filter((i) => i.type === type && (khoa === undefined || i.khoa === khoa)).sort((a, b) => a.ts.localeCompare(b.ts)).pop(), [items]);

  // ===== Màn hình nhập số CCCD =====
  if (!items) {
    return (
      <div className="phone login">
        <button className="gear" onClick={() => setShowCfg(!showCfg)} aria-label="Cài đặt">⚙</button>
        <img className="logo" src="icon-512.png" alt="Logo" />
        <h1>Sức khỏe học đường</h1>
        <p className="sub">Tra cứu kết quả khám sức khỏe của con</p>
        <div className="field"><span className="ico">👤</span>
          <input inputMode="numeric" autoFocus placeholder="Số CCCD của học sinh" value={cccd} onChange={(e) => setCccd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && cccd.trim() && dob && void search()} />
        </div>
        <label className="flabel">Ngày sinh của học sinh</label>
        <div className="field"><span className="ico">🎂</span>
          <input type="date" max={new Date().toISOString().slice(0, 10)} aria-label="Ngày sinh của học sinh" value={dob} onChange={(e) => setDob(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && cccd.trim() && dob && void search()} />
        </div>
        <button className="btn" disabled={!cccd.trim() || !dob || busy} onClick={() => void search()}>{busy ? 'Đang tra cứu…' : 'Tra cứu'}</button>
        {err && <div className="err">{err}</div>}
        {showCfg && <div className="cfg"><label>Nguồn tra cứu (cổng Bộ Y tế :8095, hoặc kho chính :8090)</label><input value={base} onChange={(e) => setBase(e.target.value)} /></div>}
        <p className="note">🔒 Dữ liệu được mã hoá. Cần số CCCD và ngày sinh của học sinh. Kết quả chỉ được giải mã trên thiết bị của bạn; máy chủ không đọc được nội dung.</p>
      </div>
    );
  }

  const hc = latest('hanhchinh')?.data as HanhChinh | undefined;
  const tl = latest('thecuc')?.data as TheLuc | undefined;
  const lk = latest('lankham')?.data as LanKham | undefined;
  const ts = latest('tiensu')?.data as TienSu | undefined;
  const cls = latest('canlamsang')?.data as CanLamSang | undefined;
  const kl = latest('ketluan')?.data as KetLuan | undefined;
  const title = screen === 'home' ? 'KẾT QUẢ KHÁM SỨC KHỎE' : (MENU.find((m) => m[0] === screen)?.[2] ?? '');

  return (
    <div className="phone">
      <Watermark text={'KSK · ' + (cccd.length > 4 ? '***' + cccd.slice(-4) : '')} />
      <header>
        {screen === 'home' ? <button onClick={logout} aria-label="Thoát">⎋</button> : <button onClick={() => setScreen('home')} aria-label="Quay lại">‹</button>}
        <span>{title}</span><i />
      </header>

      <main>
        <div className={'live' + (live ? '' : ' off')}>{live ? '● Đang cập nhật trực tiếp' : '○ Mất kết nối, đang thử lại…'}{updated && ` · ${updated.toLocaleTimeString('vi-VN')}`}</div>
        {screen === 'home' && (
          <>
            <div className="card">
              <div className="avatar">{(hc?.hoTen ?? '?').trim().split(' ').pop()?.[0] ?? '?'}</div>
              <div className="who"><b>{hc?.hoTen ?? 'Học sinh'}</b>{hc?.lop && <div>Lớp {hc.lop}</div>}</div>
              <Row k="Ngày sinh" v={fmtDate(hc?.ngaySinh)} />
              <Row k="Giới tính" v={hc ? (hc.gioiTinh === 'nam' ? 'Nam' : 'Nữ') : undefined} />
              <Row k="CCCD" v={hc?.cccd} />
              <Row k="Người giám hộ" v={hc?.giamHo?.hoTen} />
              <Row k="Địa chỉ" v={[hc?.diaChi, hc?.phuongXa, hc?.tinh].filter(Boolean).join(', ')} />
            </div>
            <div className="menu">
              {MENU.map(([k, ico, label]) => <button key={k} onClick={() => setScreen(k)}><span>{ico}</span>{label}<i>›</i></button>)}
            </div>
            {kl && <div className={'badge l' + kl.loai}>Phân loại sức khỏe: <b>Loại {kl.loai}</b></div>}
          </>
        )}

        {screen === 'theluc' && (tl ? (
          <div className="card list">
            <Row k="Chiều cao" v={tl.chieuCao && tl.chieuCao + ' cm'} />
            <Row k="Cân nặng" v={tl.canNang && tl.canNang + ' kg'} />
            <Row k="BMI" v={bmi(tl.chieuCao, tl.canNang)} />
            <Row k="Mạch" v={tl.mach && tl.mach + ' lần/phút'} />
            <Row k="Huyết áp" v={tl.huyetApTT && tl.huyetApTTr ? `${tl.huyetApTT}/${tl.huyetApTTr} mmHg` : ''} />
            <Row k="Nhịp thở" v={tl.nhipTho && tl.nhipTho + ' lần/phút'} />
            <Row k="Nhiệt độ" v={tl.nhietDo && tl.nhietDo + ' °C'} />
            <Row k="Phân loại thể lực" v={'Loại ' + tl.loai} />
          </div>
        ) : <Empty />)}

        {screen === 'lamsang' && (() => {
          const blocks = LAM_SANG.map((k) => ({ k, d: latest('lamsang', k.khoa)?.data as LamSangData | undefined })).filter((x) => x.d);
          return blocks.length ? blocks.map(({ k, d }) => (
            <div key={k.khoa} className="card list"><h3>{k.ten}</h3>
              {k.muc.map((m) => <div key={m} className="row2"><span>{m}</span><b>{d![m]?.kq || '—'}{d![m]?.loai ? ` (loại ${d![m].loai})` : ''}</b></div>)}
            </div>
          )) : <Empty />;
        })()}

        {screen === 'xetnghiem' && (cls && Object.keys(cls.kq ?? {}).length ? (
          <div className="card list">
            {XET_NGHIEM.filter((x) => cls.kq[x.ma] !== undefined && cls.kq[x.ma] !== '').map((x) => {
              const v = Number(cls.kq[x.ma]);
              const f = Number.isFinite(v) ? flag(x.ma, v, cls.gioiTinh ?? 'nam') : 'binhthuong';
              return <div key={x.ma} className="row2"><span>{x.ten}<small> ({x.dv})</small></span><b className={f === 'binhthuong' ? '' : 'out'}>{cls.kq[x.ma]}{f === 'cao' ? ' ↑' : f === 'thap' ? ' ↓' : ''}</b></div>;
            })}
          </div>
        ) : <Empty />)}

        {screen === 'tiensu' && (
          <>
            <div className="card list"><h3>Lần khám</h3>
              <Row k="Ngày khám" v={fmtDate(lk?.ngayKham)} /><Row k="Lý do khám" v={lk?.lyDo} /><Row k="Ghi chú" v={lk?.ghiChu} />
              {!lk && <p className="muted">Chưa có thông tin.</p>}
            </div>
            <div className="card list"><h3>Tiền sử bệnh tật</h3>
              {ts?.co?.length ? <p>{ts.co.join(', ')}</p> : <p className="muted">Không ghi nhận.</p>}
              {ts?.ghiChu && <p>{ts.ghiChu}</p>}
            </div>
          </>
        )}

        {screen === 'ketluan' && (kl ? (
          <div className="card list">
            <Row k="Ngày kết luận" v={fmtDate(kl.ngay)} />
            <Row k="Phân loại sức khỏe" v={'Loại ' + kl.loai} />
            {kl.chanDoan?.length > 0 && <div className="row2"><span>Chẩn đoán</span><b>{kl.chanDoan.map((c) => `${c[0]} ${c[1]}`).join('; ')}</b></div>}
            <div className="concl">{kl.ketLuan || 'Chưa có kết luận.'}</div>
          </div>
        ) : <Empty />)}
      </main>

      <nav className="tabs">
        <button className={screen === 'home' ? 'on' : ''} onClick={() => setScreen('home')}><span>👤</span>Hồ sơ</button>
        <button onClick={() => setScreen('ketluan')}><span>✅</span>Kết luận</button>
        <button onClick={logout}><span>🔍</span>Tra cứu khác</button>
      </nav>
    </div>
  );
}


/** Hình mờ truy vết: CCCD che bớt + giờ xem. Phủ chéo lặp lại để ảnh chụp bằng camera vẫn truy được nguồn. */
function Watermark({ text }: { text: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const esc = (s: string) => s.replace(/[<>&"']/g, '');
  const label = esc(text) + ' · ' + now.toLocaleString('vi-VN');
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200'><text x='20' y='120' transform='rotate(-24 180 100)' font-family='Segoe UI,Arial' font-size='15' font-weight='600' fill='#506070'>" + label + "</text></svg>";
  return <div className="wm" style={{ backgroundImage: 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")' }} />;
}

const Empty = () => <div className="card"><p className="muted">Chưa có kết quả cho mục này.</p></div>;
