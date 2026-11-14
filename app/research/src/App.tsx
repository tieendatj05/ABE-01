import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError, BusinessClosedError, fakePatients, PasswordChangeRequiredError, ResearchClient, SECTIONS,
  type Me, type Mode, type SectionKey, type SectionView, type Status,
} from '../../../security/src/research/index.js';
import { DraftStore, initialBusiness, lockMessage, nextBusiness } from './drafts.js';
import { IdbDeviceKeyStore } from './idb-store.js';

// Giao diện nghiên cứu: MỘT giao diện cho hai chế độ. Quyền thật nằm ở backend (+CP-ABE); giao diện chỉ ẩn/hiện cho dễ dùng.
const FIELDS: Record<SectionKey, { key: string; label: string }[]> = {
  hanhchinh: [{ key: 'hoTen', label: 'Họ tên' }, { key: 'ngaySinh', label: 'Ngày sinh' }, { key: 'gioiTinh', label: 'Giới tính' }, { key: 'cccd', label: 'CCCD (giả)' }, { key: 'diaChi', label: 'Địa chỉ' }, { key: 'dienThoai', label: 'Điện thoại' }],
  'lamsang.Nhi': [{ key: 'chieuCao', label: 'Chiều cao (cm)' }, { key: 'canNang', label: 'Cân nặng (kg)' }, { key: 'tinhTrang', label: 'Tình trạng' }, { key: 'ketLuan', label: 'Kết luận Nhi' }],
  'lamsang.Mat': [{ key: 'thiLucPhai', label: 'Thị lực phải' }, { key: 'thiLucTrai', label: 'Thị lực trái' }, { key: 'tatKhucXa', label: 'Tật khúc xạ' }, { key: 'ketLuan', label: 'Kết luận Mắt' }],
};
const TITLE: Record<SectionKey, string> = { hanhchinh: 'Hành chính', 'lamsang.Nhi': 'Lâm sàng Nhi', 'lamsang.Mat': 'Lâm sàng Mắt' };
const ROLE_LABEL: Record<string, string> = { TIEP_DON: 'Tiếp đón', BAC_SI: 'Bác sĩ', QUAN_TRI: 'Quản trị' };
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_LABEL: Record<string, string> = { MON: 'Thứ 2', TUE: 'Thứ 3', WED: 'Thứ 4', THU: 'Thứ 5', FRI: 'Thứ 6', SAT: 'Thứ 7', SUN: 'Chủ nhật' };
const REASONS: Record<string, string> = {
  DENY_ROLE_NOT_ALLOWED: 'Vai trò của bạn không được phép xem mục này (backend).', DENY_KHOA_MISMATCH: 'Mục này thuộc khoa khác (backend).',
  DENY_ACCOUNT_DISABLED: 'Tài khoản đã bị khóa.', DENY_NO_ATTRIBUTES: 'Tài khoản không có thuộc tính khóa ABE nào.',
  BAD_CREDENTIALS: 'Sai tên đăng nhập hoặc mật khẩu.', ACCOUNT_LOCKED: 'Tài khoản tạm khóa do nhập sai nhiều lần; thử lại sau.', STEP_UP_FAILED: 'Mật khẩu hiện tại không đúng.',
  PASSWORD_WEAK: 'Mật khẩu mới quá yếu: tối thiểu 10 ký tự, có cả chữ và số.', PASSWORD_REUSED: 'Mật khẩu mới phải khác mật khẩu tạm.',
  PHONE_INVALID: 'Số điện thoại không hợp lệ (dạng 0901234567).', PHONE_EXISTS: 'Số điện thoại này đã có tài khoản.', USERNAME_EXISTS: 'Tên đăng nhập đã tồn tại.',
  KHOA_INVALID: 'Bác sĩ phải chọn khoa (Nhi hoặc Mắt).', DEVICE_LIMIT: 'Đã đạt số thiết bị tối đa của tài khoản này.',
};
const explain = (code: string) => REASONS[code] ?? REASONS[code.split(':')[0]] ?? code;
const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

/** Quyền GHI hiển thị trên giao diện (chỉ để ẩn nút; backend mới là nơi quyết định). */
function canWrite(me: Me, s: SectionKey): boolean {
  if (me.role === 'TIEP_DON') return s === 'hanhchinh';
  if (me.role === 'BAC_SI') return s === `lamsang.${me.khoa}`;
  return false;
}

export function App() {
  const store = useMemo(() => new IdbDeviceKeyStore(), []);
  const [server, setServer] = useState(localStorage.getItem('research.server') ?? `https://${location.hostname || 'localhost'}:8443`);
  const [pin, setPin] = useState(localStorage.getItem('research.pin') ?? '');
  const [mode, setMode] = useState<Mode>('abe');
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [biz, setBiz] = useState(initialBusiness);
  const [tab, setTab] = useState<'records' | 'admin'>('records');
  const [err, setErr] = useState('');
  const [needNew, setNeedNew] = useState(false);
  const clientRef = useRef<ResearchClient | null>(null);

  const makeClient = useCallback(() => new ResearchClient({
    baseUrl: server.replace(/\/$/, ''), store, pin: pin ? { registryPk: pin } : undefined,
    onBusinessClosed: (st) => setBiz((v) => nextBusiness(v, { businessOpen: false, nextOpenAt: st.nextOpenAt })),
  }), [server, store, pin]);

  // Thăm dò trạng thái nghiệp vụ (công khai, được phép cả ngoài giờ) để banner cập nhật; KHÔNG tự thực hiện thao tác nào khi mở cửa lại.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const c = clientRef.current ?? makeClient();
        const st = await c.status();
        if (stop) return;
        setStatus(st); setBiz((v) => nextBusiness(v, st));
      } catch { /* chưa kết nối */ }
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => { stop = true; clearInterval(id); };
  }, [makeClient, me]);

  const login = async (username: string, password: string, newPassword?: string) => {
    setErr('');
    try {
      localStorage.setItem('research.server', server); localStorage.setItem('research.pin', pin);
      const c = makeClient(); clientRef.current = c;
      setMe(await c.signIn(username, password, { newPassword })); setNeedNew(false); setTab('records');
    } catch (e) {
      if (e instanceof PasswordChangeRequiredError) { setNeedNew(true); setErr('Đây là mật khẩu TẠM do quản trị cấp. Hãy đặt mật khẩu mới của riêng bạn (quản trị sẽ không biết mật khẩu này).'); }
      else setErr(e instanceof ApiError ? explain(e.code) : String((e as Error).message));
    }
  };
  const logout = async () => { await clientRef.current?.signOut(); clientRef.current = null; setMe(null); setTab('records'); };    // không giữ tab của người trước

  return (
    <div className="app">
      <header>
        <b>MedABE · Nghiên cứu CP-ABE</b>
        <span className="tag">DỮ LIỆU GIẢ</span>
        <span className="sp" />
        <label>Chế độ&nbsp;
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="abe">B · ABE (khóa nội dung bọc bằng CP-ABE)</option>
            <option value="baseline">A · Nền (backend mã hóa khi lưu)</option>
          </select>
        </label>
        {me && <span className="who">{me.displayName} · {ROLE_LABEL[me.role]}{me.khoa ? ` ${me.khoa}` : ''} · thiết bị {me.deviceId?.slice(0, 6)} · vùng mạng {me.networkZone ?? '?'} <button onClick={logout}>Đăng xuất</button></span>}
      </header>
      {status && <div className={`bar ${status.businessOpen ? 'open' : 'closed'}`}>
        {status.businessOpen ? `Đang trong giờ làm việc (đến ${status.closesAt ? fmt(status.closesAt) : '?'})` : 'NGOÀI GIỜ LÀM VIỆC'} · lịch v{status.scheduleVersion} · policy v{status.policyVersion} · giờ máy chủ {fmt(status.now)}
      </div>}
      {lockMessage(biz, fmt) && <div className={`banner ${biz.open ? 'info' : 'lock'}`} role="alert">{lockMessage(biz, fmt)}</div>}
      {!me ? <Login server={server} setServer={setServer} pin={pin} setPin={setPin} onLogin={login} err={err} needNew={needNew} /> : (
        <>
          <nav>
            <button className={tab === 'records' ? 'on' : ''} onClick={() => setTab('records')}>Hồ sơ</button>
            {me.role === 'QUAN_TRI' && <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>Quản trị</button>}
          </nav>
          {tab === 'records' && <Records client={clientRef.current!} me={me} mode={mode} biz={biz} />}
          {tab === 'admin' && me.role === 'QUAN_TRI' && <Admin client={clientRef.current!} />}
        </>
      )}
    </div>
  );
}

function Login(p: { server: string; setServer: (s: string) => void; pin: string; setPin: (s: string) => void; onLogin: (u: string, pw: string, newPw?: string) => void; err: string; needNew: boolean }) {
  const [u, setU] = useState(''), [pw, setPw] = useState(''), [n1, setN1] = useState(''), [n2, setN2] = useState('');
  const mismatch = p.needNew && n1 !== n2;
  return (
    <form className="card login" onSubmit={(e) => { e.preventDefault(); if (!mismatch) p.onLogin(u, pw, p.needNew ? n1 : undefined); }}>
      <h3>Đăng nhập tài khoản cá nhân</h3>
      <label>Địa chỉ dịch vụ (HTTPS, cấu hình cố định)<input value={p.server} onChange={(e) => p.setServer(e.target.value)} /></label>
      <label>Khóa registry đã ghim (tùy chọn, hex)<input value={p.pin} onChange={(e) => p.setPin(e.target.value)} placeholder="64 ký tự hex" /></label>
      <label>Tên đăng nhập<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" /></label>
      <label>{p.needNew ? 'Mật khẩu tạm (do quản trị cấp)' : 'Mật khẩu'}<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
      {p.needNew && <>
        <label>Mật khẩu mới (≥10 ký tự, có chữ và số)<input type="password" value={n1} onChange={(e) => setN1(e.target.value)} autoComplete="new-password" /></label>
        <label>Nhập lại mật khẩu mới<input type="password" value={n2} onChange={(e) => setN2(e.target.value)} autoComplete="new-password" /></label>
        {mismatch && <p className="bad">Hai lần nhập mật khẩu mới chưa khớp.</p>}
      </>}
      <button type="submit">{p.needNew ? 'Đặt mật khẩu mới và đăng nhập' : 'Đăng nhập'}</button>
      {p.err && <p className="bad">Lỗi: {p.err}</p>}
      <p className="muted">Máy lạ sẽ tự đăng ký thiết bị (nhập lại mật khẩu, backend cấp chứng chỉ khóa ký). IP/VLAN chỉ là ngữ cảnh mạng, không thay thế tài khoản. Trình duyệt cần tin CA nội bộ của máy chủ.</p>
    </form>
  );
}

function Records({ client, me, mode, biz }: { client: ResearchClient; me: Me; mode: Mode; biz: ReturnType<typeof nextBusiness> }) {
  const patients = useMemo(() => fakePatients(8), []);
  const [code, setCode] = useState(patients[0].code);
  const [views, setViews] = useState<SectionView[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const drafts = useMemo(() => new DraftStore(window.localStorage, me.userId), [me.userId]);
  const [, bump] = useState(0);

  const load = useCallback(async () => {
    setMsg(''); setBusy(true);
    try { setViews(await client.readPatient(mode, code)); }
    catch (e) { setViews(null); setMsg(e instanceof BusinessClosedError ? 'Đã khóa nghiệp vụ ngoài giờ.' : e instanceof ApiError ? e.code : (e as Error).message); }
    finally { setBusy(false); }
  }, [client, mode, code]);
  useEffect(() => { void load(); }, [load]);

  const save = async (s: SectionKey, values: Record<string, string>, supersedes?: string) => {
    setMsg(''); setBusy(true);
    drafts.save(code, s, values);                                   // luôn giữ bản nháp TRƯỚC khi gửi
    try {
      await client.saveSection(mode, { patientCode: code, section: s, data: values, supersedes });
      drafts.clear(code, s);                                         // chỉ xoá sau khi backend xác nhận đã lưu
      await load();
      setMsg(`Đã lưu ${TITLE[s]} (đã ký bởi ${me.displayName}).`);
    } catch (e) {
      setMsg(e instanceof BusinessClosedError ? 'Không lưu được: ngoài giờ làm việc. Bản nháp được giữ trên máy này.' : `Không lưu được: ${e instanceof ApiError ? (REASONS[e.code] ?? e.code) : (e as Error).message}`);
    } finally { setBusy(false); bump((n) => n + 1); }
  };

  const importDemo = async () => {
    setBusy(true); setMsg('');
    try { const n = await client.importMany(mode, patients.map((p) => ({ patientCode: p.code, section: 'hanhchinh' as const, data: p.hanhchinh }))); setMsg(`Đã import ${n} hồ sơ hành chính giả.`); await load(); }
    catch (e) { setMsg(e instanceof ApiError ? (REASONS[e.code] ?? e.code) : (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <main>
      <div className="row">
        <label>Bệnh nhân (giả)&nbsp;
          <select value={code} onChange={(e) => setCode(e.target.value)}>{patients.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.hanhchinh.hoTen}</option>)}</select>
        </label>
        <button onClick={() => void load()} disabled={busy}>Tải lại</button>
        {me.role === 'TIEP_DON' && <button onClick={importDemo} disabled={busy || !biz.open}>Import {patients.length} hồ sơ hành chính giả</button>}
        {drafts.pending().length > 0 && <span className="warn">Có {drafts.pending().length} bản nháp chưa lưu trên máy này</span>}
      </div>
      {msg && <p className="msg">{msg}</p>}
      <div className="grid">
        {SECTIONS.map((s) => <Section key={s} s={s} view={views?.find((v) => v.section === s)} me={me} draft={drafts.load(code, s)?.values} locked={!biz.open || busy}
          onDraft={(vals) => { drafts.save(code, s, vals); bump((n) => n + 1); }} onSave={(vals, sup) => save(s, vals, sup)} onDiscard={() => { drafts.clear(code, s); bump((n) => n + 1); }} />)}
      </div>
      <p className="muted">Chế độ {mode === 'abe' ? 'ABE: máy chủ chỉ lưu bản mã + header CP-ABE; giải mã tại máy này bằng khóa thuộc tính của bạn.' : 'Nền: máy chủ nhận bản rõ qua HTTPS, kiểm quyền rồi mã hóa khi lưu bằng khóa của máy chủ và tự giải mã khi bạn được phép đọc.'}</p>
    </main>
  );
}

function Section(p: { s: SectionKey; view?: SectionView; me: Me; draft?: Record<string, string>; locked: boolean; onDraft: (v: Record<string, string>) => void; onSave: (v: Record<string, string>, supersedes?: string) => void; onDiscard: () => void }) {
  const { s, view, me } = p;
  const base: Record<string, string> = Object.fromEntries(FIELDS[s].map((f) => [f.key, String((view?.data as Record<string, unknown> | undefined)?.[f.key] ?? '')]));
  const values = p.draft ?? base;
  const writable = canWrite(me, s);
  return (
    <section className={`card sec ${view?.status ?? 'EMPTY'}`}>
      <h4>{TITLE[s]}{view && <small> · {view.versions} phiên bản</small>}</h4>
      {!view && <p className="muted">Chưa có dữ liệu.</p>}
      {view?.status === 'DENIED_BACKEND' && <p className="bad">🔒 Backend từ chối: {REASONS[view.reason ?? ''] ?? view.reason}</p>}
      {view?.status === 'DENIED_CRYPTO' && <p className="bad">🔒 Có bản mã nhưng khóa ABE của bạn không thỏa policy nên không giải mã được.</p>}
      {view?.status === 'INTEGRITY_ERROR' && <p className="bad">⚠ Dữ liệu không toàn vẹn: {view.reason}</p>}
      {view?.status === 'OPEN' && <p className={view.signature?.ok ? 'ok' : 'bad'}>{view.signature?.ok ? `✔ Chữ ký của ${view.signature.signerName} (${view.signature.signerUserId?.slice(0, 10)}…) hợp lệ` : '✘ Chữ ký không hợp lệ'}</p>}
      {(view?.status === 'OPEN' || (!view && writable)) && (
        <div className="form">
          {FIELDS[s].map((f) => (
            <label key={f.key}>{f.label}
              <input value={values[f.key] ?? ''} readOnly={!writable} onChange={(e) => p.onDraft({ ...values, [f.key]: e.target.value })} />
            </label>
          ))}
          {writable && <div className="row">
            <button disabled={p.locked} onClick={() => p.onSave(values, (view?.record as { id?: string } | undefined)?.id)}>Lưu (ký và gửi)</button>
            {p.draft && <button className="ghost" onClick={p.onDiscard}>Bỏ bản nháp</button>}
            {p.draft && <span className="warn">bản nháp chưa lưu</span>}
          </div>}
        </div>
      )}
    </section>
  );
}

function Admin({ client }: { client: ResearchClient }) {
  const [sched, setSched] = useState<{ version: number; days: Record<string, { open?: string; close?: string; closed?: boolean }> } | null>(null);
  const [reason, setReason] = useState('');
  const [users, setUsers] = useState<{ userId: string; username: string; displayName: string; phone: string | null; role: string; khoa: string | null; status: string; mustChangePassword: boolean }[]>([]);
  const [nu, setNu] = useState({ phone: '', displayName: '', role: 'TIEP_DON', khoa: 'Nhi', password: '' });
  const [temp, setTemp] = useState<{ who: string; password: string } | null>(null);
  const [audit, setAudit] = useState<{ ts: string; actor: string; action: string; detail: string }[]>([]);
  const [chain, setChain] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSched(await client.call('GET', '/api/v2/admin/schedule'));
      setUsers(await client.call('GET', '/api/v2/admin/users'));
      const a = await client.call<{ chain: { ok: boolean }; records: typeof audit }>('GET', '/api/v2/admin/audit?limit=40');
      setAudit(a.records.slice().reverse()); setChain(a.chain.ok);
    } catch (e) { setMsg(e instanceof ApiError ? e.code : (e as Error).message); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);
  const saveSchedule = async () => {
    if (!sched) return;
    try {
      await client.call('PUT', '/api/v2/admin/schedule', { expectedVersion: sched.version, days: sched.days, reason });
      setMsg('Đã lưu lịch (phiên bản mới, có nhật ký). Phiên đang hoạt động chịu lịch mới ngay.'); setReason(''); await refresh();
    } catch (e) { setMsg(e instanceof ApiError ? `${e.code}: ${String((e.body as { error?: string }).error ?? '')}` : (e as Error).message); }
  };
  const setDay = (d: string, patch: object) => setSched((s) => s && { ...s, days: { ...s.days, [d]: { ...s.days[d], ...patch } } });
  const createUser = async () => {
    setMsg(''); setTemp(null);
    try {
      const r = await client.call<{ username: string; displayName: string; temporaryPassword?: string }>('POST', '/api/v2/admin/users', {
        phone: nu.phone, displayName: nu.displayName, role: nu.role, khoa: nu.role === 'BAC_SI' ? nu.khoa : undefined, password: nu.password || undefined });
      setTemp({ who: `${r.displayName} (${r.username})`, password: r.temporaryPassword ?? nu.password });
      setNu({ phone: '', displayName: '', role: 'TIEP_DON', khoa: 'Nhi', password: '' }); await refresh();
    } catch (e) { setMsg(e instanceof ApiError ? explain(e.code) : (e as Error).message); }
  };
  const resetPassword = async (u: { userId: string; username: string; displayName: string }) => {
    if (!window.confirm(`Cấp lại mật khẩu tạm cho ${u.displayName}? Mọi phiên đăng nhập của họ sẽ bị đăng xuất.`)) return;
    setMsg(''); setTemp(null);
    try { const r = await client.call<{ temporaryPassword: string }>('POST', `/api/v2/admin/users/${u.userId}/reset-password`, {}); setTemp({ who: `${u.displayName} (${u.username})`, password: r.temporaryPassword }); await refresh(); }
    catch (e) { setMsg(e instanceof ApiError ? explain(e.code) : (e as Error).message); }
  };
  const patchUser = async (id: string, body: object) => { try { await client.call('PUT', `/api/v2/admin/users/${id}`, body); await refresh(); } catch (e) { setMsg(e instanceof ApiError ? e.code : (e as Error).message); } };
  return (
    <main>
      <p className="muted">Quản trị KHÔNG có quyền đọc/ghi hồ sơ và KHÔNG có thuộc tính ABE nào. Quyền quản trị lịch được dùng ngay cả ngoài giờ.</p>
      {msg && <p className="msg">{msg}</p>}
      <section className="card"><h4>Lịch giờ làm việc (giờ Asia/Ho_Chi_Minh){sched && ` — phiên bản ${sched.version}`}</h4>
        {sched && DAYS.map((d) => { const x = sched.days[d]; return (
          <div className="row" key={d}><b className="day">{DAY_LABEL[d]}</b>
            <label><input type="checkbox" checked={!!x.closed} onChange={(e) => setDay(d, e.target.checked ? { closed: true } : { closed: false, open: '07:00', close: '17:30' })} /> đóng cả ngày</label>
            {!x.closed && <><input type="time" value={x.open ?? ''} onChange={(e) => setDay(d, { open: e.target.value })} /> → <input type="time" value={x.close ?? ''} onChange={(e) => setDay(d, { close: e.target.value })} /> <small className="muted">mở: mở ≤ t &lt; đóng</small></>}
          </div>); })}
        <div className="row"><input className="wide" placeholder="Lý do thay đổi (bắt buộc, ≥5 ký tự)" value={reason} onChange={(e) => setReason(e.target.value)} /><button onClick={saveSchedule}>Lưu lịch</button></div>
      </section>
      <section className="card"><h4>Cấp tài khoản cho nhân viên mới</h4>
        <p className="muted">Nhân viên đưa số điện thoại → quản trị tạo tài khoản (tên đăng nhập mặc định = số điện thoại). Mật khẩu do hệ thống sinh (hoặc quản trị nhập) chỉ là mật khẩu TẠM: nhân viên phải tự đổi ở lần đăng nhập đầu, sau đó quản trị không còn biết mật khẩu.</p>
        <div className="row">
          <label>Số điện thoại<input value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} placeholder="0901234567" /></label>
          <label>Họ tên hiển thị<input value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} /></label>
          <label>Vai trò<select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}><option value="TIEP_DON">Tiếp đón</option><option value="BAC_SI">Bác sĩ</option><option value="QUAN_TRI">Quản trị</option></select></label>
          {nu.role === 'BAC_SI' && <label>Khoa<select value={nu.khoa} onChange={(e) => setNu({ ...nu, khoa: e.target.value })}><option value="Nhi">Nhi</option><option value="Mat">Mắt</option></select></label>}
          <label>Mật khẩu tạm (để trống = tự sinh)<input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></label>
          <button onClick={createUser} disabled={!nu.phone}>Tạo tài khoản</button>
        </div>
        {temp && <div className="tempbox" role="status"><b>Mật khẩu tạm của {temp.who}:</b> <code className="temppw">{temp.password}</code><br /><small>Chỉ hiển thị MỘT lần — hãy đưa cho nhân viên ngay. Họ sẽ phải đặt mật khẩu mới khi đăng nhập lần đầu.</small></div>}
      </section>
      <section className="card"><h4>Người dùng (vai trò/khoa do backend quản lý)</h4>
        <table><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Số điện thoại</th><th>Vai trò</th><th>Khoa</th><th>Trạng thái</th><th /></tr></thead><tbody>
          {users.map((u) => <tr key={u.userId}><td>{u.username}</td><td>{u.displayName}</td><td>{u.phone ?? '—'}</td><td>{ROLE_LABEL[u.role]}</td><td>{u.khoa ?? '—'}</td>
            <td>{u.status}{u.mustChangePassword && <span className="warn"> · chờ đổi mật khẩu tạm</span>}</td>
            <td><button className="ghost" onClick={() => void patchUser(u.userId, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>{u.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}</button> <button className="ghost" onClick={() => void resetPassword(u)}>Cấp lại mật khẩu</button></td></tr>)}
        </tbody></table>
      </section>
      <section className="card"><h4>Nhật ký (chuỗi băm {chain === null ? '…' : chain ? <span className="ok">TOÀN VẸN</span> : <span className="bad">BỊ SỬA</span>})</h4>
        <div className="log">{audit.map((a, i) => <div key={i}><span className="muted">{fmt(a.ts)}</span> <b>{a.actor.slice(0, 10)}</b> {a.action} — {a.detail}</div>)}</div>
      </section>
    </main>
  );
}
