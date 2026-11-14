import { useEffect, useMemo, useRef, useState } from 'react';
import { PasswordChangeRequiredError, type ImageView, type ParentItem } from '../../../security/src/index.js';
import { UNITS } from '../../web/src/data/catalog.js';
import type { HanhChinh, KetLuan, LanKham, TheLuc } from '../../web/src/model.js';
import { bmi } from '../../web/src/model.js';
import { defaultStorageBase, session } from '../../web/src/session.js';
import { useBusiness, useConnection, useSession } from '../../web/src/ui.js';
import { Icon, Logo, type IconName } from './icons.js';
import { InstallCard } from './install.js';
import { fold, friendly, isCccd, usePatient, usePeople, type ImgGroup, type Person } from './lookup.js';
import { KetLuanView, LamSangView, LoaiBadge, ThucLuc, TienSuView, XetNghiemView, data, fmtDate, fmtTime, latestOf, loaiOf, LOAI } from './screens.js';

// APP TRA CỨU SỨC KHỎE (đăng nhập bằng tài khoản). Đọc theo ĐÚNG quyền ABE của tài khoản: bác sĩ chỉ thấy phần thuộc khoa mình, người nhập chỉ thấy phần mình nhập...
// Chỉ ĐỌC, không sửa/nhập. Mọi giải mã diễn ra trên máy này; không lưu dữ liệu sức khỏe ra đĩa. Máy khác vừa nhập xong thì app tự cập nhật trong vài giây (xem lookup.ts).
type Detail = 'theluc' | 'lamsang' | 'xetnghiem' | 'tiensu' | 'ketluan' | 'anh';
type Screen = 'home' | 'hoso' | Detail;
const MENU: { k: Detail; ico: IconName; t: [string, string]; tone: string }[] = [
  { k: 'theluc', ico: 'activity', t: ['Thể lực', '& chỉ số'], tone: 'blue' },
  { k: 'lamsang', ico: 'heart', t: ['Khám', 'lâm sàng'], tone: 'rose' },
  { k: 'xetnghiem', ico: 'flask', t: ['Xét', 'nghiệm'], tone: 'teal' },
  { k: 'tiensu', ico: 'clipboard', t: ['Tiền sử', '& lần khám'], tone: 'violet' },
  { k: 'ketluan', ico: 'shield', t: ['Kết luận', 'bác sĩ'], tone: 'green' },
  { k: 'anh', ico: 'brain', t: ['Ảnh', 'CT / MRI'], tone: 'sky' },
];
const TITLE: Record<Screen, string> = { home: '', hoso: 'Hồ sơ', theluc: 'Thể lực & chỉ số', lamsang: 'Khám lâm sàng', xetnghiem: 'Xét nghiệm', tiensu: 'Tiền sử & lần khám', ketluan: 'Kết luận', anh: 'Ảnh CT / MRI' };
const ROLE: Record<string, string> = { TIEP_DON: 'Tiếp đón', NHAP_LIEU: 'Nhập liệu', BAC_SI: 'Bác sĩ', KTV: 'Kỹ thuật viên', KET_LUAN: 'Bác sĩ kết luận', QUAN_TRI: 'Quản trị', GIAM_SAT: 'Giám sát' };
const KHOA: Record<string, string> = { Nhi: 'Nhi', ThanKinh: 'Thần kinh', Mat: 'Mắt', TMH: 'Tai-Mũi-Họng', RHM: 'Răng-Hàm-Mặt', KSK: 'Khám chung', XetNghiem: 'Xét nghiệm' };

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* không có localStorage */ } },
};
export const applyTheme = (t: string | null) => {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) ? '#0b1622' : '#0a6cc4');
};
const maskId = (s: string) => (s.length > 4 ? '•••• •••• ' + s.slice(-4) : s);
const initial = (n: string) => (n.trim().split(/\s+/).pop()?.[0] ?? '?').toUpperCase();

/** Giữ kết nối với máy chủ: kết nối (nhận khoá) sau khi đăng nhập, rồi kiểm tra mỗi 3 giây; mất kết nối thì tự thử lại. */
function useLink(on: boolean) {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!on) { setMsg(''); return; }
    let alive = true, busy = false;
    const connect = async () => {
      if (busy || !session.client) return;
      busy = true;
      try { await session.reconnect(session.client.s.storageBase); if (alive) setMsg(''); }
      catch (e) { session.suspendNetwork(); if (alive) setMsg(friendly(e)); }
      finally { busy = false; }
    };
    void connect();
    const t = setInterval(() => {
      if (busy || !session.client) return;
      if (!session.connectionReady) { void connect(); return; }
      busy = true;
      void session.checkConnection().then(() => { if (alive) setMsg(''); }).catch((e) => { if (alive) setMsg(friendly(e)); }).finally(() => { busy = false; });
    }, 3000);
    return () => { alive = false; clearInterval(t); session.suspendNetwork(); };
  }, [on]);
  return msg;
}

/* ====================================================================== */
export function App() {
  const unlocked = useSession();
  const ready = useConnection();
  const biz = useBusiness();
  const linkMsg = useLink(unlocked);
  const [theme, setTheme] = useState<string>(() => ls.get('ksk.theme') ?? 'auto');
  const [unit, setUnit] = useState<string>(() => (UNITS.some((u) => u.ma === ls.get('ksk.unit')) ? ls.get('ksk.unit')! : UNITS[0].ma));
  const [sheet, setSheet] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [from, setFrom] = useState<Screen>('home');
  const [recents, setRecents] = useState<Person[]>([]);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (m: string) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2600); };

  useEffect(() => { ls.set('ksk.theme', theme); applyTheme(theme); }, [theme]);
  useEffect(() => { ls.set('ksk.unit', unit); }, [unit]);
  useEffect(() => { if (!unlocked) { setCode(null); setScreen('home'); setRecents([]); } }, [unlocked]);
  useEffect(() => {   // tự đăng xuất sau 30 phút không thao tác (session.touch đặt lại bộ đếm)
    const t = () => session.touch();
    addEventListener('pointerdown', t); addEventListener('keydown', t);
    return () => { removeEventListener('pointerdown', t); removeEventListener('keydown', t); };
  }, []);
  useEffect(() => { try { indexedDB.deleteDatabase('ksk-phuhuynh'); } catch { /* bản cũ của app có lưu hồ sơ trên máy: xoá đi, bản này không lưu gì */ } }, []);

  const c = session.client;
  const role = c?.s.account?.role ?? '';
  const open = (p: Person) => { setCode(p.cccd); setScreen('home'); setRecents((r) => [p, ...r.filter((x) => x.cccd !== p.cccd)].slice(0, 6)); window.scrollTo(0, 0); };
  const rename = (cccd: string, hoTen: string) => setRecents((r) => (r.some((x) => x.cccd === cccd && x.hoTen !== hoTen) ? r.map((x) => (x.cccd === cccd ? { ...x, hoTen } : x)) : r));

  if (!unlocked || !c) return <><Login /><Toast text={toast} /></>;
  if (role === 'QUAN_TRI' || role === 'GIAM_SAT') {
    return (
      <div className="login">
        <div className="login-hero"><div className="login-logo"><Logo size={76} /></div><h1>Tra cứu sức khỏe</h1><p>{c.s.name} · {ROLE[role]}</p></div>
        <div className="login-card">
          <div className="alert" role="alert">
            {role === 'QUAN_TRI'
              ? 'Tài khoản Quản trị không đọc dữ liệu sức khỏe (đúng thiết kế ABE). Hãy dùng app nhân viên để quản lý tài khoản.'
              : 'Tài khoản Giám sát phải xác thực MFA và nêu lý do mỗi lần đọc. Hãy dùng trang "Giám sát hồ sơ" trong app nhân viên.'}
          </div>
          <button className="btn-ghost" onClick={() => void session.signOut()}>Đăng xuất</button>
        </div>
      </div>
    );
  }

  return (
    <Shell
      key={c.s.account?.userId} ready={ready} linkMsg={linkMsg} bizClosed={!!biz && !biz.open} bizNext={biz?.nextOpenAt ?? null}
      code={code} screen={screen} from={from} setScreen={setScreen} setFrom={setFrom} onBack={() => { setCode(null); setScreen('home'); }}
      unit={unit} setUnit={setUnit} recents={recents} open={open} rename={rename} sheet={sheet} setSheet={setSheet} theme={theme} setTheme={setTheme} say={say} toast={toast}
    />
  );
}

/* ====================================================================== */
interface ShellProps {
  ready: boolean; linkMsg: string; bizClosed: boolean; bizNext: string | null; code: string | null; screen: Screen; from: Screen;
  setScreen: (s: Screen) => void; setFrom: (s: Screen) => void; onBack: () => void; unit: string; setUnit: (u: string) => void;
  recents: Person[]; open: (p: Person) => void; rename: (cccd: string, hoTen: string) => void;
  sheet: boolean; setSheet: (b: boolean) => void; theme: string; setTheme: (t: string) => void; say: (m: string) => void; toast: string;
}
function Shell(p: ShellProps) {
  const c = session.client!;
  const khoas = (c.s.account?.khoa ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const who = c.s.name;
  const banner = (
    <>
      {p.bizClosed && <div className="offline" role="alert"><Icon n="lock" size={16} /> Ngoài giờ làm việc — máy chủ đã khóa đọc{p.bizNext ? `, mở lại lúc ${new Date(p.bizNext).toLocaleString('vi-VN')}` : ''}.</div>}
      {!p.ready && <div className="offline" role="status"><Icon n="wifioff" size={16} /> {p.linkMsg || 'Đang kết nối máy chủ…'}</div>}
    </>
  );
  return (
    <div className="app">
      <Watermark text={'KSK · ' + who + (p.code ? ' · ' + maskId(p.code) : '')} />
      {p.code
        ? <PatientView key={p.code} code={p.code} ready={p.ready} banner={banner} screen={p.screen} from={p.from} setScreen={p.setScreen} setFrom={p.setFrom} onBack={p.onBack} rename={p.rename} />
        : (
          <SearchView
            who={who} role={ROLE[c.s.account?.role ?? ''] ?? ''} khoas={khoas} banner={banner} ready={p.ready} unit={p.unit} setUnit={p.setUnit}
            recents={p.recents} open={p.open} onSettings={() => p.setSheet(true)}
          />
        )}
      {p.sheet && <Settings theme={p.theme} onTheme={p.setTheme} onClose={() => p.setSheet(false)} say={p.say} />}
      <Toast text={p.toast} />
    </div>
  );
}

const Toast = ({ text }: { text: string }) => (text ? <div className="toast" role="status">{text}</div> : null);

/* ====================================================================== */
function SearchView({ who, role, khoas, banner, ready, unit, setUnit, recents, open, onSettings }: {
  who: string; role: string; khoas: string[]; banner: React.ReactNode; ready: boolean; unit: string; setUnit: (u: string) => void;
  recents: Person[]; open: (p: Person) => void; onSettings: () => void;
}) {
  const [q, setQ] = useState('');
  const t = q.trim();
  const byName = t.length >= 2 && !isCccd(t);
  const { people, error, loading } = usePeople(unit, byName, ready);
  const matches = useMemo(() => {
    if (!byName || !people) return [];
    const f = fold(t);
    return people.filter((x) => fold(x.hoTen).includes(f) || x.cccd.includes(f.replace(/\s/g, ''))).slice(0, 12);
  }, [byName, people, t]);
  const submit = () => { if (isCccd(t)) open({ hoTen: '', cccd: t }); else if (matches.length === 1) open(matches[0]); };
  return (
    <>
      <header className="top">
        <div className="top-bar">
          <div className="brand light"><Logo size={30} /><span>Tra cứu sức khỏe</span></div>
          <div className="bar-r"><button className="icon-btn light" onClick={onSettings} aria-label="Cài đặt"><Icon n="sliders" /></button></div>
        </div>
        <div className="greet">
          <div className="greet-av">{initial(who)}</div>
          <div className="greet-t">
            <small>{role}{khoas.length ? ' · ' + khoas.map((k) => KHOA[k] ?? k).join(' + ') : ''}</small>
            <h2>{who}</h2>
            <p><span className={`dot${ready ? ' live' : ''}`} />{ready ? 'Đã kết nối — cập nhật trực tiếp' : 'Đang kết nối…'}</p>
          </div>
        </div>
      </header>
      {banner}
      <main className="page home">
        <section className="card" aria-label="Tra cứu">
          <label className="fld">
            <span>Họ tên hoặc số CCCD của bệnh nhân</span>
            <div className="inp"><Icon n="user" size={19} />
              <input aria-label="Tra cứu bệnh nhân" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Nguyễn Văn An hoặc 12 số CCCD" autoComplete="off" enterKeyHint="search" autoFocus />
            </div>
          </label>
          <div className="seg1">
            <label htmlFor="unit">Đơn vị (để tra theo tên)</label>
            <select id="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS.map((u) => <option key={u.ma} value={u.ma}>{u.ten}</option>)}</select>
          </div>
          {isCccd(t) && <button className="btn-primary" onClick={submit}>Mở hồ sơ {t}</button>}
          {byName && loading && !people && <p className="hint"><span className="dot live" /> Đang tải danh sách để tra theo tên…</p>}
          {byName && error && <div className="alert" role="alert">{error}</div>}
          {byName && people && !matches.length && !error && <p className="hint">Không thấy hồ sơ nào khớp trong đơn vị này mà tài khoản bạn đọc được. Nếu vừa có người nhập, danh sách tự cập nhật trong vài giây; hoặc gõ đủ 12 số CCCD.</p>}
        </section>
        {matches.length > 0 && (
          <div className="card list" role="list" aria-label="Kết quả tra cứu">
            {matches.map((m) => (
              <button key={m.cccd} className="row-btn" role="listitem" onClick={() => open(m)}>
                <span className="kid-av lg">{initial(m.hoTen || '?')}</span>
                <span className="row-t"><b>{m.hoTen || '(không tên)'}</b><small>CCCD {m.cccd}</small></span>
                <Icon n="right" size={18} className="chev" />
              </button>
            ))}
          </div>
        )}
        {recents.length > 0 && (
          <>
            <h3 className="eyebrow list-h">Vừa xem</h3>
            <div className="card list">
              {recents.map((m) => (
                <button key={m.cccd} className="row-btn" onClick={() => open(m)}>
                  <span className="kid-av lg">{initial(m.hoTen || '?')}</span>
                  <span className="row-t"><b>{m.hoTen || 'Hồ sơ ' + maskId(m.cccd)}</b><small>CCCD {maskId(m.cccd)}</small></span>
                  <Icon n="right" size={18} className="chev" />
                </button>
              ))}
            </div>
          </>
        )}
        <InstallCard />
        <div className="secure"><Icon n="lock" size={16} /><p>Mọi dữ liệu được mã hoá ABE; chỉ giải mã trên máy này theo <b>đúng quyền tài khoản của bạn</b> (khoa, vai trò). Máy chủ không đọc được nội dung. App chỉ đọc và không lưu gì ra đĩa.</p></div>
      </main>
    </>
  );
}

/* ====================================================================== */
function PatientView({ code, ready, banner, screen, from, setScreen, setFrom, onBack, rename }: {
  code: string; ready: boolean; banner: React.ReactNode; screen: Screen; from: Screen; setScreen: (s: Screen) => void; setFrom: (s: Screen) => void;
  onBack: () => void; rename: (cccd: string, hoTen: string) => void;
}) {
  const { data: d, error, live, syncing, changedAt, refresh } = usePatient(code, ready);
  const items: ParentItem[] = d?.items ?? [];
  const hc = data<HanhChinh>(latestOf(items, 'hanhchinh'));
  const tl = data<TheLuc>(latestOf(items, 'thecuc'));
  const kl = data<KetLuan>(latestOf(items, 'ketluan'));
  const lk = data<LanKham>(latestOf(items, 'lankham'));
  const name = hc?.hoTen?.trim() || '';
  useEffect(() => { if (name) rename(code, name); }, [name, code]); // eslint-disable-line react-hooks/exhaustive-deps
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (!changedAt) return; setFlash(true); const t = setTimeout(() => setFlash(false), 6000); return () => clearTimeout(t); }, [changedAt]);

  const has: Record<Detail, boolean> = {
    theluc: !!tl, lamsang: items.some((i) => i.type === 'lamsang'), xetnghiem: items.some((i) => i.type === 'canlamsang'),
    tiensu: items.some((i) => i.type === 'lankham' || i.type === 'tiensu'), ketluan: !!kl, anh: !!d?.images.some((g) => g.view),
  };
  const go = (k: Screen) => { setScreen(k); window.scrollTo(0, 0); };
  const openDetail = (k: Screen) => { if (screen === 'home' || screen === 'hoso') setFrom(screen); go(k); };
  const isTab = screen === 'home' || screen === 'hoso';
  const b = tl ? bmi(tl.chieuCao, tl.canNang) : '';
  const waiting = !!d && d.total === 0;
  const status = !ready ? 'Đang kết nối…' : live ? 'Đang cập nhật trực tiếp' : 'Đang thử kết nối lại…';
  const pname = name || 'Hồ sơ ' + maskId(code);
  const addr = [hc?.diaChi, hc?.phuongXa, hc?.tinh].filter(Boolean).join(', ');

  return (
    <>
      <header className="bar">
        <button className="icon-btn" onClick={() => (isTab ? onBack() : go(from))} aria-label="Quay lại"><Icon n="left" /></button>
        <h1 className="bar-t">{screen === 'home' ? pname : TITLE[screen]}</h1>
        <div className="bar-r"><button className={`icon-btn${syncing ? ' spin' : ''}`} onClick={() => void refresh()} aria-label="Làm mới" disabled={!ready}><Icon n="refresh" /></button></div>
      </header>
      {banner}
      <div className={`livebar${flash ? ' flash' : ''}`} role="status" aria-live="polite">
        <span className={`dot${live && ready ? ' live' : ''}`} />
        {flash ? 'Vừa có dữ liệu mới từ máy khác' : status}{d ? ` · ${fmtTime(d.loadedAt)}` : ''}
      </div>
      {error && <div className="alert mx" role="alert">{error}</div>}

      <main key={screen + code} className="page">
        {!d && !error && <div className="empty"><div className="empty-ico"><span className="spinner dark" /></div><p>Đang tải và giải mã hồ sơ trên máy này…</p></div>}

        {d && d.restricted > 0 && (
          <p className="notice" role="note">⚠ Còn <b>{d.restricted}</b> mục của hồ sơ này mà tài khoản bạn <b>không được xem</b> (khoa/quyền khác). Phần bạn thấy chỉ là phạm vi của bạn: <u>vùng trống hoặc thiếu không có nghĩa là bình thường</u>.</p>
        )}

        {d && waiting && screen === 'home' && (
          <div className="card wait" role="status">
            <span className="dot live" />
            <div><b>Chưa có dữ liệu nào bạn được xem cho CCCD {maskId(code)}</b>
              <p className="muted">Nếu có người vừa nhập ở máy khác, hồ sơ sẽ <b>tự hiện ra trong vài giây</b> — không cần làm mới.</p></div>
          </div>
        )}

        {d && screen === 'home' && !waiting && (
          <>
            <section className="hero" aria-label="Thẻ bệnh nhân">
              <div className="hero-top">
                <div className="hero-av">{initial(pname)}</div>
                <div className="hero-id">
                  <h2>{pname}</h2>
                  <p>{[hc?.gioiTinh && (hc.gioiTinh === 'nam' ? 'Nam' : 'Nữ'), hc?.ngaySinh && fmtDate(hc.ngaySinh), hc?.lop && `Lớp ${hc.lop}`].filter(Boolean).join(' · ') || 'CCCD ' + code}</p>
                </div>
                {kl && loaiOf(kl.loai) ? <div className={`hero-loai l${loaiOf(kl.loai)}`}><b>{loaiOf(kl.loai)}</b><small>Loại</small></div> : null}
              </div>
              <div className="hero-foot"><span className={`dot${live && ready ? ' live' : ''}`} />{status}<span> · {d.total} mục</span></div>
            </section>
            <section className="card shortcuts" aria-label="Mục hồ sơ">
              <div className="sc-grid">
                {MENU.map((s) => (
                  <button key={s.k} className={`sc${!has[s.k] ? ' dim' : ''}`} onClick={() => openDetail(s.k)}>
                    <span className={`tile-ico xl ${s.tone}`}><Icon n={s.ico} size={26} /></span>
                    <span className="sc-t">{s.t[0]}<br />{s.t[1]}</span>
                    {has[s.k] && <i className="sc-ok" aria-label="Đã có dữ liệu" />}
                  </button>
                ))}
              </div>
            </section>
            {tl && (
              <>
                <h3 className="eyebrow list-h">Chỉ số gần nhất</h3>
                <div className="quick">
                  <div><Icon n="ruler" size={18} /><b>{tl.chieuCao || '—'}</b><small>cm</small></div>
                  <div><Icon n="scale" size={18} /><b>{tl.canNang || '—'}</b><small>kg</small></div>
                  <div><Icon n="activity" size={18} /><b>{b || '—'}</b><small>BMI</small></div>
                </div>
              </>
            )}
            <h3 className="eyebrow list-h">Thông tin</h3>
            <div className="card list">
              <button className="row-btn" onClick={() => openDetail('ketluan')}>
                <span className="tile-ico green"><Icon n="shield" size={20} /></span>
                <span className="row-t"><b>Kết luận của bác sĩ</b><small>{kl ? (loaiOf(kl.loai) ? `Loại ${loaiOf(kl.loai)} · ${LOAI[loaiOf(kl.loai)]}` : 'Đã có kết luận') : 'Chưa có kết luận'}</small></span>
                {kl ? <LoaiBadge v={kl.loai} /> : null}<Icon n="right" size={18} className="chev" />
              </button>
              <button className="row-btn" onClick={() => openDetail('tiensu')}>
                <span className="tile-ico violet"><Icon n="calendar" size={20} /></span>
                <span className="row-t"><b>Lần khám gần nhất</b><small>{lk?.ngayKham ? `${fmtDate(lk.ngayKham)}${lk.lyDo ? ' · ' + lk.lyDo : ''}` : 'Chưa có thông tin'}</small></span>
                <Icon n="right" size={18} className="chev" />
              </button>
              <button className="row-btn" onClick={() => openDetail('hoso')}>
                <span className="tile-ico sky"><Icon n="id" size={20} /></span>
                <span className="row-t"><b>Hồ sơ hành chính</b><small>{hc ? 'Họ tên, ngày sinh, giám hộ…' : 'Tài khoản này không xem được mục hành chính'}</small></span>
                <Icon n="right" size={18} className="chev" />
              </button>
            </div>
          </>
        )}

        {d && screen === 'hoso' && (
          <div className="card">
            <h3 className="sec"><Icon n="user" size={16} /> Thông tin hành chính</h3>
            {hc ? (
              <>
                <div className="kv"><span>Họ và tên</span><b>{hc.hoTen}</b></div>
                {hc.gioiTinh && <div className="kv"><span>Giới tính</span><b>{hc.gioiTinh === 'nam' ? 'Nam' : 'Nữ'}</b></div>}
                {hc.ngaySinh && <div className="kv"><span>Ngày sinh</span><b>{fmtDate(hc.ngaySinh)}</b></div>}
                {hc.lop && <div className="kv"><span>Lớp</span><b>{hc.lop}</b></div>}
                <div className="kv"><span>CCCD</span><b>{code}</b></div>
                {hc.dienThoai && <div className="kv"><span>Điện thoại</span><b>{hc.dienThoai}</b></div>}
                {hc.giamHo?.hoTen && <div className="kv"><span>Người giám hộ</span><b>{hc.giamHo.hoTen}{hc.giamHo.quanHe ? ` (${hc.giamHo.quanHe})` : ''}</b></div>}
                {addr && <div className="kv"><span>Địa chỉ</span><b>{addr}</b></div>}
              </>
            ) : <p className="muted">Tài khoản này không được xem mục hành chính của hồ sơ.</p>}
          </div>
        )}

        {d && screen === 'theluc' && <ThucLuc items={items} />}
        {d && screen === 'lamsang' && <LamSangView items={items} />}
        {d && screen === 'xetnghiem' && <XetNghiemView items={items} />}
        {d && screen === 'tiensu' && <TienSuView items={items} />}
        {d && screen === 'ketluan' && <KetLuanView items={items} />}
        {d && screen === 'anh' && <ImagesView groups={d.images} />}
      </main>
    </>
  );
}

/* ====================================================================== */
function PixelCanvas({ view }: { view: ImageView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    let dead = false;
    const drawPixels = () => {
      cv.width = view.pixels.w; cv.height = view.pixels.h;
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(view.pixels.data), view.pixels.w, view.pixels.h), 0, 0);
    };
    // Người có ẢNH GỐC (tác giả / Giám sát) xem ảnh gốc nguyên vẹn; người chỉ có vài vùng xem các vùng được cấp trên nền trống.
    const o = view.original;
    if (!o) { drawPixels(); return; }
    createImageBitmap(new Blob([o.bytes as BlobPart], { type: o.mime }))
      .then((bm) => { if (dead) { bm.close(); return; } cv.width = bm.width; cv.height = bm.height; cv.getContext('2d')!.drawImage(bm, 0, 0); bm.close(); })
      .catch(() => { if (!dead) drawPixels(); });
    return () => { dead = true; };
  }, [view]);
  return <canvas ref={ref} className="imgcanvas" aria-label={view.original ? 'Ảnh gốc đầy đủ' : 'Ảnh theo vùng được phép'} />;
}

/** Ảnh CT/MRI: mỗi nhóm = một ảnh hoặc một chuỗi lát cắt (có thanh trượt). Chỉ hiện vùng tài khoản này giải mã được; phần còn lại là nền caro. */
function ImagesView({ groups }: { groups: ImgGroup[] }) {
  const shown = groups.filter((g): g is { key: string; view: ImageView } => !!g.view && g.view.width > 0);
  const cards = useMemo(() => {
    const by = new Map<string, { key: string; list: ImageView[] }>();
    for (const g of shown) { const k = g.view.series?.id ?? g.view.imageId; (by.get(k) ?? by.set(k, { key: k, list: [] }).get(k)!).list.push(g.view); }
    for (const c of by.values()) c.list.sort((a, b) => (a.series?.index ?? 0) - (b.series?.index ?? 0));
    return [...by.values()];
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps
  const [at, setAt] = useState<Record<string, number>>({});
  if (!cards.length) return <div className="empty"><div className="empty-ico"><Icon n="brain" size={30} /></div><p>Không có ảnh nào thuộc quyền của tài khoản này cho hồ sơ này.</p></div>;
  return (
    <>
      {cards.map((card, n) => {
        const i = Math.min(at[card.key] ?? Math.floor(card.list.length / 2), card.list.length - 1);
        const v = card.list[i];
        return (
          <div key={card.key} className="card">
            <h3 className="sec">Ảnh {n + 1}{card.list.length > 1 ? ` · chuỗi ${card.list.length} lát (lát ${i + 1}/${card.list.length})` : ''}</h3>
            {card.list.length > 1 && <input type="range" className="slice" aria-label="Chọn lát cắt" min={0} max={card.list.length - 1} value={i} onChange={(e) => setAt((o) => ({ ...o, [card.key]: Number(e.target.value) }))} />}
            <div className="imgbox"><PixelCanvas view={v} /></div>
            <p className={v.limited ? 'warnline' : 'okline'}>{v.limited ? '⚠ Bản hiển thị đã GIỚI HẠN: chỉ các vùng tài khoản này được cấp. Phần ngoài vùng không có trên máy này.' : '✔ Ảnh gốc đầy đủ (bạn là người nhập)'}</p>
            <small className="muted">Vùng đọc được: {v.regions.length ? v.regions.map((r, j) => `#${j + 1} [${r.khoas.map((k) => KHOA[k] ?? k).join(' + ')}]`).join(' · ') : 'không có'}</small>
            {v.tampered > 0 && <p className="alert">⚠ {v.tampered} phần của ảnh bị phát hiện can thiệp/sai chữ ký nên không hiển thị. Hãy báo quản trị.</p>}
          </div>
        );
      })}
      <p className="foot">Ảnh minh hoạ trong môi trường thử nghiệm, không dùng để chẩn đoán.</p>
    </>
  );
}

/* ====================================================================== */
const explain = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  const code = m.split(/[ (:]/)[0];
  return ({
    BAD_CREDENTIALS: 'Sai email hoặc mật khẩu.', ACCOUNT_LOCKED: 'Tài khoản tạm khóa do nhập sai nhiều lần. Thử lại sau ít phút.', DENY_ACCOUNT_DISABLED: 'Tài khoản đã bị khóa. Hãy liên hệ quản trị.',
    PASSWORD_WEAK: 'Mật khẩu mới quá yếu: tối thiểu 10 ký tự, có cả chữ và số.', PASSWORD_REUSED: 'Mật khẩu mới phải khác mật khẩu tạm.', DEVICE_LIMIT: 'Tài khoản đã đăng ký đủ số máy tối đa. Nhờ quản trị thu hồi bớt máy cũ.',
    LOGIN_RATE_LIMIT: 'Đăng nhập quá nhiều lần, thử lại sau.', DENY_PENDING_APPROVAL: 'Tài khoản đang chờ một quản trị viên KHÁC duyệt.', DENY_REMOTE_ACCESS: 'Tài khoản này không được dùng qua Internet.',
  } as Record<string, string>)[code] ?? friendly(e);
};

function Login() {
  const [base, setBase] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [n1, setN1] = useState('');
  const [needNew, setNeedNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cfg, setCfg] = useState(false);
  useEffect(() => { void defaultStorageBase().then(setBase); }, []);
  const ok = !!email.trim() && !!pass && (!needNew || n1.length >= 10);
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true); setErr('');
    try { await session.signIn(base, email.trim(), pass, needNew ? n1 : undefined); }
    catch (e) {
      if (e instanceof PasswordChangeRequiredError) { setNeedNew(true); setErr('Đây là mật khẩu TẠM do quản trị cấp. Hãy đặt mật khẩu mới của riêng bạn (≥ 10 ký tự, có chữ và số).'); }
      else setErr(explain(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="login-hero">
        <button className="icon-btn light gear" onClick={() => setCfg(!cfg)} aria-label="Địa chỉ máy chủ"><Icon n="sliders" /></button>
        <div className="login-logo"><Logo size={76} /></div>
        <h1>Tra cứu sức khỏe</h1>
        <p>Đăng nhập bằng tài khoản nhân viên</p>
      </div>
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <label className="fld"><span>Email / tên đăng nhập</span>
          <div className="inp"><Icon n="user" size={19} /><input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@congty.vn" autoComplete="username" autoCapitalize="none" /></div></label>
        <label className="fld"><span>{needNew ? 'Mật khẩu tạm (do quản trị cấp)' : 'Mật khẩu'}</span>
          <div className="inp"><Icon n="lock" size={19} /><input aria-label="Mật khẩu" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></div></label>
        {needNew && <label className="fld"><span>Mật khẩu mới</span>
          <div className="inp"><Icon n="lock" size={19} /><input aria-label="Mật khẩu mới" type="password" value={n1} onChange={(e) => setN1(e.target.value)} autoComplete="new-password" /></div></label>}
        {err && <div className={needNew && err.startsWith('Đây là') ? 'notice' : 'alert'} role="alert">{err}</div>}
        <button className="btn-primary" type="submit" disabled={!ok || busy}>{busy ? <><span className="spinner" /> Đang đăng nhập…</> : needNew ? 'Đặt mật khẩu mới và đăng nhập' : 'Đăng nhập'}</button>
        {cfg && (
          <div className="cfg">
            <label htmlFor="srv">Địa chỉ máy chủ</label>
            <input id="srv" value={base} onChange={(e) => setBase(e.target.value.trim())} placeholder="https://địa-chỉ-máy-chủ:8443" inputMode="url" autoCapitalize="none" />
          </div>
        )}
      </form>
      <div className="login-install"><InstallCard /></div>
      <div className="secure on-login"><Icon n="lock" size={16} /><p>Dữ liệu được mã hoá ABE. Bạn chỉ xem được phần thuộc quyền tài khoản của mình; mọi lần xem đều giải mã ngay trên máy này.</p></div>
    </div>
  );
}

/* ====================================================================== */
function Settings({ theme, onTheme, onClose, say }: { theme: string; onTheme: (t: string) => void; onClose: () => void; say: (m: string) => void }) {
  const c = session.client!;
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Cài đặt" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-h"><h2>Cài đặt</h2><button className="icon-btn" onClick={onClose} aria-label="Đóng"><Icon n="x" /></button></div>
        <h3 className="eyebrow">Tài khoản</h3>
        <div className="card flat"><b>{c.s.name}</b><br /><small className="muted">{c.s.account?.username} · {ROLE[c.s.account?.role ?? ''] ?? ''}</small></div>
        <h3 className="eyebrow">Giao diện</h3>
        <div className="seg" role="radiogroup" aria-label="Giao diện">
          {[['auto', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']].map(([k, l]) => <button key={k} role="radio" aria-checked={theme === k} className={theme === k ? 'on' : ''} onClick={() => onTheme(k)}>{l}</button>)}
        </div>
        <h3 className="eyebrow">Bảo mật</h3>
        <button className="btn-danger" onClick={() => { void session.signOut(); say('Đã đăng xuất và xoá dữ liệu khỏi bộ nhớ'); }}><Icon n="lock" size={18} /> Đăng xuất</button>
        <p className="fine">Phiên bản 2.0 · Chỉ đọc · Không lưu dữ liệu sức khỏe ra đĩa · Tự đăng xuất sau 30 phút không thao tác. Dữ liệu thử nghiệm, không dùng để chẩn đoán.</p>
      </div>
    </div>
  );
}

/** Hình mờ truy vết: tên người xem + CCCD che bớt + giờ. Phủ chéo lặp lại để ảnh chụp bằng camera vẫn truy được nguồn. */
function Watermark({ text }: { text: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const svg = useMemo(() => {
    const esc = (s: string) => s.replace(/[<>&"']/g, '');
    const label = esc(text) + ' · ' + now.toLocaleString('vi-VN');
    return "<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200'><text x='20' y='120' transform='rotate(-24 180 100)' font-family='Arial' font-size='15' font-weight='600' fill='#506070'>" + label + '</text></svg>';
  }, [text, now]);
  return <div className="wm" style={{ backgroundImage: 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")' }} />;
}
