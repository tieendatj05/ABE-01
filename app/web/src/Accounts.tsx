import { useCallback, useEffect, useState } from 'react';
import { session } from './session.js';
import { log, run } from './ui.js';

// Quản trị TÀI KHOẢN nhân viên: công ty cấp email + mật khẩu TẠM; nhân viên tự đổi ở lần đăng nhập đầu. Chỉ tài khoản Quản trị thấy trang này;
// quyền thật do máy chủ kiểm (vai trò Quản trị KHÔNG có quyền đọc/ghi hồ sơ và không có thuộc tính mã hoá nào).
interface User { attributes?: string[]; restrictReason?: string; restrictedBy?: string; restrictedAt?: string; userId: string; username: string; displayName: string; phone: string | null; role: string; khoa: string | null; status: string; mustChangePassword: boolean; requestedBy?: string | null }
type Day = { open?: string; close?: string; closed?: boolean };
/** Yêu cầu "quên mật khẩu" nhân viên gửi từ màn đăng nhập, đang chờ quản trị xác minh. */
/** Thiết bị (máy) đã đăng ký của một tài khoản: mỗi tài khoản chỉ được số máy tối đa; quản trị thu hồi máy cũ/mất để nhân viên đăng ký máy mới. */
interface Dev { deviceId: string; userId: string; label: string; status: string; createdAt: string }
interface PwReq { id: string; userId: string; username: string; displayName: string; role: string; phone: string | null; createdAt: string; fromIp: string | null }
const ROLES: [string, string][] = [['TIEP_DON', 'Tiếp đón (nhập danh sách)'], ['NHAP_LIEU', 'Nhập liệu (từ hồ sơ giấy, tải ảnh)'], ['BAC_SI', 'Bác sĩ (theo khoa)'], ['KTV', 'Kỹ thuật viên xét nghiệm'], ['KET_LUAN', 'Bác sĩ kết luận (theo khoa)'], ['GIAM_SAT', 'Giám sát (đọc TẤT CẢ, không ghi; cần quản trị khác duyệt)'], ['QUAN_TRI', 'Quản trị']];
// Vai trò được cấp chuyên khoa (nhiều khoa). Bác sĩ chỉ đọc phần thuộc khoa được cấp; "Khám chung" và "Xét nghiệm" cũng là mục cấp tường minh.
const WITH_KHOA = ['BAC_SI', 'KET_LUAN'];
const ROLE_LABEL = Object.fromEntries(ROLES);
const KHOAS: [string, string][] = [['Nhi', 'Nhi'], ['ThanKinh', 'Thần kinh'], ['Mat', 'Mắt'], ['TMH', 'Tai - Mũi - Họng'], ['RHM', 'Răng - Hàm - Mặt'], ['KSK', 'Khám chung (KSK)'], ['XetNghiem', 'Xét nghiệm']];
const khoaLabel = (csv: string | null) => csv ? csv.split(',').map((k) => KHOAS.find(([c]) => c === k)?.[1] ?? k).join(', ') : '—';
function KhoaPick({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return <span className="khoapick">{KHOAS.map(([k, l]) => <label key={k} style={{ flex: 'none', marginRight: 10 }}><input type="checkbox" style={{ minWidth: 0 }} checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} /> {l}</label>)}</span>;
}
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_LABEL: Record<string, string> = { MON: 'Thứ 2', TUE: 'Thứ 3', WED: 'Thứ 4', THU: 'Thứ 5', FRI: 'Thứ 6', SAT: 'Thứ 7', SUN: 'Chủ nhật' };
const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

export function Accounts() {
  const c = session.client!;
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<{ email: string; name: string; role: string; khoas: string[]; password: string }>({ email: '', name: '', role: 'TIEP_DON', khoas: ['Nhi'], password: '' });
  const [edit, setEdit] = useState<{ id: string; khoas: string[] } | null>(null);
  const [temp, setTemp] = useState<{ who: string; pw: string } | null>(null);
  const [sched, setSched] = useState<{ version: number; days: Record<string, Day> } | null>(null);
  const [reason, setReason] = useState('');
  const [audit, setAudit] = useState<{ ts: string; actor: string; action: string; detail: string }[]>([]);
  const [chain, setChain] = useState<boolean | null>(null);
  const [remote, setRemote] = useState<{ enabled: boolean; publicUrl: string | null } | null>(null);
  const [reqs, setReqs] = useState<PwReq[]>([]);
  const [devs, setDevs] = useState<Dev[]>([]);
  const [epoch, setEpoch] = useState<{ tag: string; counters: Record<string, number> } | null>(null);   // phiên bản thuộc tính hiện hành (tăng khi gỡ khoa / hạn chế tài khoản)
  const [adminMfa, setAdminMfa] = useState(false);       // máy chủ bắt buộc MFA cho Quản trị => có nút Đặt lại MFA cho quản trị khác

  const refresh = useCallback(async () => {
    setUsers(await c.api<User[]>('GET', '/api/v2/admin/users'));
    setSched(await c.api('GET', '/api/v2/admin/schedule'));
    const a = await c.api<{ chain: { ok: boolean }; records: typeof audit }>('GET', '/api/v2/admin/audit?limit=40');
    setAudit(a.records.slice().reverse()); setChain(a.chain.ok);
    setRemote(await c.api('GET', '/api/v2/admin/remote'));
    setReqs(await c.api<PwReq[]>('GET', '/api/v2/admin/password-requests'));
    setDevs(await c.api<Dev[]>('GET', '/api/v2/admin/devices'));
    setAdminMfa((await c.mfaStatus()).required);
    setEpoch(await c.epochs());
  }, [c]);
  // Có người vừa bấm "Quên mật khẩu": cập nhật danh sách sau vài giây, không bắt quản trị tải lại trang.
  useEffect(() => {
    const t = setInterval(() => { void c.api<PwReq[]>('GET', '/api/v2/admin/password-requests').then(setReqs).catch(() => undefined); }, 8000);
    return () => clearInterval(t);
  }, [c]);
  // Đang bật mà chưa có địa chỉ: hỏi lại vài giây một lần cho đến khi đường hầm báo địa chỉ.
  useEffect(() => {
    if (!remote?.enabled || remote.publicUrl) return;
    const t = setInterval(() => { void c.api<{ enabled: boolean; publicUrl: string | null }>('GET', '/api/v2/admin/remote').then(setRemote).catch(() => undefined); }, 3000);
    return () => clearInterval(t);
  }, [c, remote]);
  const toggleRemote = () => {
    const on = !remote?.enabled;
    if (on && !confirm('BẬT truy cập từ xa?\n\nNhân viên ở ngoài mạng nội bộ sẽ đăng nhập được qua Internet (địa chỉ https công khai, có mã hóa). Dữ liệu vẫn được bảo vệ bằng tài khoản, phân quyền, giờ làm việc và mã hóa ABE, nhưng hệ thống sẽ có thể bị thử đăng nhập từ Internet. Chỉ bật khi cần và nhớ dùng mật khẩu mạnh.')) return;
    void run(on ? 'Bật truy cập từ xa' : 'Tắt truy cập từ xa', async () => { setRemote(await c.api('PUT', '/api/v2/admin/remote', { enabled: on })); });
  };
  useEffect(() => { void run('Tải danh sách tài khoản', refresh); }, [refresh]);

  const create = () => run('Tạo tài khoản', async () => {
    setTemp(null);
    const r = await c.api<{ username: string; displayName: string; temporaryPassword?: string }>('POST', '/api/v2/admin/users', {
      username: form.email.trim(), displayName: form.name.trim(), role: form.role, khoa: WITH_KHOA.includes(form.role) && form.khoas.length ? form.khoas.join(',') : undefined, password: form.password || undefined });
    setTemp({ who: `${r.displayName} <${r.username}>`, pw: r.temporaryPassword ?? form.password });
    setForm({ email: '', name: '', role: 'TIEP_DON', khoas: ['Nhi'], password: '' });
    log('Đã tạo tài khoản ' + r.username, 'ok'); await refresh();
  });
  const reset = (u: User) => { if (!confirm(`Cấp lại mật khẩu tạm cho ${u.displayName}? Mọi phiên đăng nhập của họ sẽ bị đăng xuất.`)) return; void run('Cấp lại mật khẩu', async () => {
    const r = await c.api<{ temporaryPassword: string }>('POST', `/api/v2/admin/users/${u.userId}/reset-password`, {});
    setTemp({ who: `${u.displayName} <${u.username}>`, pw: r.temporaryPassword }); await refresh();
  }); };
  const fulfillReq = (r: PwReq) => { if (!confirm(`Cấp mật khẩu tạm cho ${r.displayName} <${r.username}>?

Chỉ cấp SAU KHI bạn đã xác minh đúng người này: gọi lại số điện thoại đã đăng ký hoặc gặp trực tiếp. Đừng cấp chỉ vì một cuộc gọi/tin nhắn lạ. Mọi phiên đăng nhập của họ sẽ bị đăng xuất.`)) return; void run('Cấp mật khẩu tạm theo yêu cầu', async () => {
    const out = await c.api<{ temporaryPassword: string }>('POST', `/api/v2/admin/password-requests/${r.id}/fulfill`, {});
    setTemp({ who: `${r.displayName} <${r.username}>`, pw: out.temporaryPassword }); log('Đã cấp mật khẩu tạm cho ' + r.username, 'ok'); await refresh();
  }); };
  const rejectReq = (r: PwReq) => run('Từ chối yêu cầu', async () => { await c.api('POST', `/api/v2/admin/password-requests/${r.id}/reject`, {}); log('Đã từ chối yêu cầu của ' + r.username, 'ok'); await refresh(); });
  const revokeDev = (d: Dev, u: User) => { if (!confirm(`Thu hồi máy này của ${u.displayName}? Máy đó bị đăng xuất ngay và muốn dùng lại phải đăng ký lại (tính vào số máy tối đa). Dùng khi nhân viên mất máy, cài lại máy, hoặc đã đủ số máy.`)) return; void run('Thu hồi thiết bị', async () => {
    await c.api('POST', `/api/v2/admin/devices/${d.deviceId}/revoke`, {}); log(`Đã thu hồi một máy của ${u.username}`, 'ok'); await refresh();
  }); };
  const riskSignal = (u: User) => { const note = window.prompt('GHI TÍN HIỆU RỦI RO (giả lập) cho ' + u.username + '. Mô tả ngắn (ví dụ: đọc 300 hồ sơ trong 5 phút từ máy lạ):', ''); if (note === null) return; void run('Ghi tín hiệu rủi ro', async () => {
    await c.api('POST', `/api/v2/admin/users/${u.userId}/risk-signal`, { kind: 'ANOMALOUS_READ_VOLUME', detail: note, simulated: true }); log('Đã ghi tín hiệu rủi ro (giả lập) của ' + u.username + ' vào nhật ký. Chưa đổi quyền: bạn quyết định có hạn chế hay không.', 'warn'); await refresh();
  }); };
  const restrict = (u: User) => { const why = window.prompt('HẠN CHẾ tài khoản ' + u.displayName + ' <' + u.username + '>?\n\nChỉ còn đọc được dữ liệu do CHÍNH tài khoản này nhập; mất vai trò, khoa, MFA; không ghi; phiên bị đăng xuất; phiên bản thuộc tính (epoch) tăng.\nNhập lý do (≥ 8 ký tự):', ''); if (!why) return; void run('Hạn chế tài khoản', async () => {
    await c.api('POST', `/api/v2/admin/users/${u.userId}/restrict`, { reason: why, rotateKeys: true, revokeSessions: true }); log('Đã hạn chế ' + u.username + ' (ghi nhật ký).', 'ok'); await refresh();
  }); };
  const restore = (u: User) => { const why = window.prompt('KHÔI PHỤC quyền của ' + u.displayName + ' <' + u.username + '> sau khi đã xác minh. Nhập lý do (≥ 8 ký tự):', ''); if (!why) return; void run('Khôi phục tài khoản', async () => {
    await c.api('POST', `/api/v2/admin/users/${u.userId}/restore`, { reason: why }); log('Đã khôi phục ' + u.username + ' (ghi nhật ký).', 'ok'); await refresh();
  }); };
  const approve = (u: User) => { if (!confirm(`DUYỆT tài khoản Giám sát "${u.displayName}"?\n\nTài khoản này sẽ đọc được TẤT CẢ hồ sơ mới (kể cả ảnh gốc). Chỉ duyệt khi bạn đã xác minh người này và lý do cấp quyền. Việc duyệt được ghi nhật ký.`)) return;
    void run('Duyệt tài khoản', async () => { await c.api('POST', `/api/v2/admin/users/${u.userId}/approve`, {}); log('Đã duyệt ' + u.username, 'ok'); await refresh(); }); };
  const resetMfa = (u: User) => { if (!confirm(`ĐẶT LẠI MFA của ${u.displayName}?

Xoá bí mật xác thực hai lớp, đăng xuất mọi phiên. Tài khoản sẽ ở trạng thái CHỜ DUYỆT: một quản trị viên KHÁC phải duyệt, rồi người dùng tự đăng ký lại MFA (cần mật khẩu của họ). Việc này được ghi nhật ký.`)) return;
    void run('Đặt lại MFA', async () => { await c.api('POST', `/api/v2/admin/users/${u.userId}/mfa-reset`, {}); log('Đã đặt lại MFA của ' + u.username + ' (chờ quản trị khác duyệt)', 'ok'); await refresh(); }); };
  const toggle = (u: User) => run(u.status === 'ACTIVE' ? 'Khóa tài khoản' : 'Mở khóa', async () => { await c.api('PUT', `/api/v2/admin/users/${u.userId}`, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); await refresh(); });
  const saveKhoa = (u: User) => { if (!edit) return; if (!confirm(`Đổi chuyên khoa của ${u.displayName}?\n\nĐây là THAY ĐỔI QUYỀN: được ghi nhật ký; khoa bị gỡ sẽ không còn được cấp khoá mới và phiên hiện tại bị đăng xuất.`)) return; void run('Đổi chuyên khoa', async () => { await c.api('PUT', `/api/v2/admin/users/${u.userId}`, { khoa: edit.khoas.join(',') }); setEdit(null); log('Đã đổi chuyên khoa của ' + u.username, 'ok'); await refresh(); }); };
  const setDay = (d: string, patch: Day) => setSched((s) => s && { ...s, days: { ...s.days, [d]: { ...s.days[d], ...patch } } });
  const saveSched = () => run('Lưu lịch giờ làm việc', async () => {
    await c.api('PUT', '/api/v2/admin/schedule', { expectedVersion: sched!.version, days: sched!.days, reason });
    setReason(''); log('Đã lưu lịch (phiên bản mới, có nhật ký). Phiên đang dùng chịu lịch mới ngay.', 'ok'); await refresh();
  });

  return (
    <div className="pagebody">
      <section>
        <h2>Cấp tài khoản cho nhân viên mới</h2>
        <p style={{ marginTop: 0 }}>Công ty cấp <b>email + mật khẩu tạm</b>. Nhân viên đăng nhập, <b>tự đặt mật khẩu mới</b> ở lần đầu — sau đó quản trị không còn biết mật khẩu. Vai trò và khoa do quản trị chọn tại đây; nhân viên không tự chọn quyền.</p>
        <div className="row">
          <input type="email" placeholder="Email (vd ten@congty.vn)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Họ tên hiển thị" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input placeholder="Mật khẩu tạm (để trống = tự sinh)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button disabled={!form.email.trim() || (form.role === 'BAC_SI' && !form.khoas.length)} onClick={() => void create()}>Tạo tài khoản</button>
        </div>
        {WITH_KHOA.includes(form.role) && <div className="row" style={{ alignItems: 'center' }}><b style={{ flex: 'none' }}>Chuyên khoa được đọc/ghi:</b><KhoaPick value={form.khoas} onChange={(v) => setForm({ ...form, khoas: v })} /></div>}
        {form.role === 'GIAM_SAT' && <p className="warnbar" role="note">⚠ Vai trò <b>Giám sát đọc được TẤT CẢ hồ sơ mới</b> (kể cả ảnh gốc) nên bị siết chặt: mật khẩu tối thiểu <b>14 ký tự</b>, chỉ <b>1 thiết bị</b>, phiên tự hết sau <b>10 phút</b> không thao tác, <b>không dùng qua Internet</b>, mỗi lần tra cứu phải <b>nhập lý do</b> và được ghi nhật ký. Tài khoản chỉ dùng được sau khi <b>một quản trị viên KHÁC</b> bấm Duyệt (kể cả khi cấp lại mật khẩu hay mở khóa). Chỉ tạo khi thật cần.</p>}
        {form.role === 'NHAP_LIEU' && <p className="hint">Người nhập liệu <b>đọc lại được mọi thứ do chính tài khoản này nhập</b> (kể cả nhiều khoa, kể cả đăng nhập ở máy khác) nhưng không đọc dữ liệu người khác nhập.</p>}
        {temp && <p className="warnbar" role="status"><b>Mật khẩu tạm của {temp.who}:</b> <code style={{ userSelect: 'all', fontSize: 16 }}>{temp.pw}</code><br /><small>Chỉ hiển thị MỘT lần. Hãy đưa cho nhân viên ngay.</small></p>}
      </section>

      <section>
        <h2>Truy cập từ xa (Internet)</h2>
        <p style={{ marginTop: 0 }}>Mặc định <b>TẮT</b>: chỉ dùng được trong mạng nội bộ. Khi bật, máy chủ mở một đường hầm HTTPS ra Internet; nhân viên ở bất cứ đâu nhập <b>địa chỉ bên dưới</b> vào mục "Máy chủ" ở màn đăng nhập. Chỉ người ngồi ở máy chủ/mạng nội bộ mới bật/tắt được. Cần cài sẵn <code>cloudflared</code> trên máy chủ; địa chỉ tạm thời <b>đổi mỗi lần bật</b>.</p>
        <div className="row" style={{ alignItems: 'center' }}>
          <b>{remote?.enabled ? (remote.publicUrl ? '● ĐANG BẬT' : '… đang mở đường hầm') : '○ Đang tắt'}</b>
          <button onClick={toggleRemote}>{remote?.enabled ? 'Tắt truy cập từ xa' : 'Bật truy cập từ xa'}</button>
        </div>
        {remote?.publicUrl && <p className="warnbar"><b>Địa chỉ cho nhân viên ở ngoài:</b> <code style={{ userSelect: 'all', fontSize: 15 }}>{remote.publicUrl}</code></p>}
      </section>

      {reqs.length > 0 && (
        <section>
          <h2>Yêu cầu cấp lại mật khẩu ({reqs.length})</h2>
          <p className="warnbar" style={{ marginTop: 0 }}>Nhân viên bấm "Quên mật khẩu" ở màn đăng nhập. <b>Hãy xác minh đúng người</b> (gọi lại số điện thoại đã đăng ký, hoặc gặp trực tiếp) trước khi cấp mật khẩu tạm. Không thể tự cấp cho chính mình — quản trị quên mật khẩu phải nhờ quản trị khác.</p>
          <table className="grid">
            <thead><tr><th>Email</th><th>Họ tên</th><th>Vai trò</th><th>Điện thoại đã đăng ký</th><th>Gửi lúc</th><th /></tr></thead>
            <tbody>{reqs.map((r) => (
              <tr key={r.id}>
                <td>{r.username}</td><td>{r.displayName}</td><td>{ROLE_LABEL[r.role] ?? r.role}</td><td>{r.phone ?? '—'}</td><td>{fmt(r.createdAt)}</td>
                <td><button className="mini2" disabled={r.userId === c.s.account?.userId} title={r.userId === c.s.account?.userId ? 'Không tự cấp cho chính mình; nhờ quản trị khác' : ''} onClick={() => fulfillReq(r)}>Cấp mật khẩu tạm</button> <button className="mini2" onClick={() => void rejectReq(r)}>Từ chối</button></td>
              </tr>))}</tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Tài khoản ({users.length})</h2>
        <table className="grid">
          <thead><tr><th>Email</th><th>Họ tên</th><th>Vai trò</th><th>Khoa</th><th>Thuộc tính ABE</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.userId}>
              <td>{u.username}</td><td>{u.displayName}</td><td>{ROLE_LABEL[u.role] ?? u.role}</td><td>{edit?.id === u.userId ? <><KhoaPick value={edit.khoas} onChange={(v) => setEdit({ id: u.userId, khoas: v })} /> <button className="mini2" onClick={() => void saveKhoa(u)}>Lưu</button> <button className="mini2" onClick={() => setEdit(null)}>Hủy</button></> : khoaLabel(u.khoa)}</td>
              <td style={{ maxWidth: 230 }}>{(u.attributes ?? []).length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{(u.attributes ?? []).map((a) => { const n = a.replace('MED:', ''); const own = n.startsWith('Author:'); return <span key={a} className="tag" title={own ? 'Thuộc tính TÁC GIẢ: chỉ của chính tài khoản này (' + n.slice(7) + ')' : 'Phiên bản hiện hành: #' + (epoch?.tag ?? '?') + '.' + (epoch?.counters[a] ?? 0)}>{own ? 'Author' : n}</span>; })}</div> : <small className="muted">không có (không giải mã được gì)</small>}</td>
              <td>{u.status === 'ACTIVE' ? 'Đang hoạt động' : u.status === 'PENDING_APPROVAL' ? <span className="warn">⏳ Chờ quản trị KHÁC duyệt</span> : u.status === 'RESTRICTED' ? <span className="bad" style={{ display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }} title={`Hạn chế bởi ${u.restrictedBy ?? '?'} lúc ${u.restrictedAt ?? '?'}${u.restrictReason ? ` — Lý do: ${u.restrictReason}` : ''}`}>⛔ Bị hạn chế{u.restrictReason ? `: ${u.restrictReason}` : ''}</span> : <span className="bad">Đã khóa</span>}{u.mustChangePassword && <span className="warn"> · chờ nhân viên đổi mật khẩu tạm</span>}</td>
              <td>{u.status === 'PENDING_APPROVAL'
                ? <><button className="mini2" disabled={u.requestedBy === c.s.account?.userId} title={u.requestedBy === c.s.account?.userId ? 'Bạn là người đã yêu cầu; cần một quản trị viên khác duyệt' : ''} onClick={() => approve(u)}>Duyệt</button> <button className="mini2" onClick={() => void toggle({ ...u, status: 'ACTIVE' })}>Từ chối (khóa)</button></>
                : u.status === 'RESTRICTED' ? null   /* bị hạn chế: chỉ "Khôi phục" (có lý do), không "Mở khóa" thẳng */
                : <button className="mini2" onClick={() => void toggle(u)}>{u.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}</button>}{u.status === 'ACTIVE' &&u.userId !== c.s.account?.userId && <> <button className="mini2" title="Nghi tài khoản bị chiếm: giảm xuống chỉ còn quyền tác giả" onClick={() => restrict(u)}>Hạn chế</button> <button className="mini2" title="Ghi một tín hiệu rủi ro vào nhật ký (giả lập), chưa đổi quyền" onClick={() => riskSignal(u)}>Báo rủi ro</button></>}{u.status === 'RESTRICTED' && <> <button className="mini2" onClick={() => restore(u)}>Khôi phục</button></>} <button className="mini2" onClick={() => reset(u)}>Cấp lại mật khẩu</button>{(u.role === 'GIAM_SAT' || (adminMfa && u.role === 'QUAN_TRI' && u.userId !== c.s.account?.userId)) && <> <button className="mini2" onClick={() => resetMfa(u)}>Đặt lại MFA</button></>}{WITH_KHOA.includes(u.role) && <> <button className="mini2" onClick={() => setEdit({ id: u.userId, khoas: u.khoa ? u.khoa.split(',') : [] })}>Sửa khoa</button></>}</td>
            </tr>))}</tbody>
        </table>
      </section>

      <section>
        <h2>Phiên bản thuộc tính (epoch) hiện hành{epoch ? ' — tuần ' + epoch.tag : ''}</h2>
        <p style={{ marginTop: 0 }}>Mỗi thuộc tính ABE có phiên bản <code>#tuần.bộ đếm</code>. Khoá giải mã gắn với phiên bản. <b>Bộ đếm tăng</b> khi gỡ khoa của một bác sĩ hoặc hạn chế một tài khoản: dữ liệu mới và dữ liệu được bọc lại sau đó dùng phiên bản mới nên <b>khoá cũ không mở được</b>. Bản mã đã sao chép từ trước kèm khoá cũ thì vẫn mở được (ABE không rút lại khoá đã cấp).</p>
        {epoch && Object.keys(epoch.counters).length > 0
          ? <table className="grid small"><thead><tr><th>Thuộc tính</th><th>Bộ đếm</th></tr></thead><tbody>{Object.entries(epoch.counters).sort().map(([k, v]) => <tr key={k}><td>{k.replace('MED:', '')}</td><td>{v}</td></tr>)}</tbody></table>
          : <p className="muted">Chưa có thu hồi nào: mọi thuộc tính ở bộ đếm 0.</p>}
      </section>

      <section>
        <h2>Máy (thiết bị) đã đăng ký</h2>
        <p style={{ marginTop: 0 }}>Mỗi tài khoản chỉ đăng ký được số máy tối đa (Giám sát: 1 máy). Nhân viên báo <b>"đã đủ số máy"</b> khi đăng nhập trên máy mới: thu hồi máy cũ/mất của họ ở đây.</p>
        {users.filter((u) => devs.some((d) => d.userId === u.userId && d.status === 'ACTIVE')).map((u) => {
          const mine = devs.filter((d) => d.userId === u.userId && d.status === 'ACTIVE').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          return (
            <details key={u.userId} style={{ marginBottom: 6 }}>
              <summary><b>{u.displayName}</b> &lt;{u.username}&gt; — {mine.length} máy đang dùng</summary>
              <table className="grid small"><thead><tr><th>Mã máy</th><th>Tên</th><th>Đăng ký lúc</th><th /></tr></thead>
                <tbody>{mine.map((d) => <tr key={d.deviceId}><td>{d.deviceId.slice(0, 8)}</td><td>{d.label}</td><td>{fmt(d.createdAt)}</td><td><button className="mini2" onClick={() => revokeDev(d, u)}>Thu hồi</button></td></tr>)}</tbody></table>
            </details>);
        })}
        {!devs.some((d) => d.status === 'ACTIVE') && <p className="muted">Chưa có máy nào đăng ký.</p>}
      </section>

      <section>
        <h2>Lịch giờ làm việc (giờ Asia/Ho_Chi_Minh){sched && ` — phiên bản ${sched.version}`}</h2>
        <p style={{ marginTop: 0 }}>Ngoài khung giờ: đọc, ghi, import và xin khóa bị chặn ở máy chủ (cả phiên đang đăng nhập). Quản trị vẫn chỉnh được lịch. Mở: mở ≤ giờ &lt; đóng.</p>
        {sched && DAYS.map((d) => { const x = sched.days[d]; return (
          <div className="row" key={d} style={{ alignItems: 'center' }}>
            <b style={{ width: 70 }}>{DAY_LABEL[d]}</b>
            <label style={{ flex: 'none' }}><input type="checkbox" style={{ minWidth: 0 }} checked={!!x.closed} onChange={(e) => setDay(d, e.target.checked ? { closed: true } : { closed: false, open: '07:00', close: '17:30' })} /> đóng cả ngày</label>
            {!x.closed && <><input type="time" style={{ flex: 'none', width: 130, minWidth: 0 }} value={x.open ?? ''} onChange={(e) => setDay(d, { open: e.target.value })} /> → <input type="time" style={{ flex: 'none', width: 130, minWidth: 0 }} value={x.close ?? ''} onChange={(e) => setDay(d, { close: e.target.value })} /></>}
          </div>); })}
        <div className="row"><input placeholder="Lý do thay đổi (bắt buộc, ≥5 ký tự)" value={reason} onChange={(e) => setReason(e.target.value)} /><button disabled={reason.trim().length < 5} onClick={() => void saveSched()}>Lưu lịch</button></div>
      </section>

      <section>
        <h2>Nhật ký (chuỗi băm {chain === null ? '…' : chain ? <span className="ok">TOÀN VẸN</span> : <span className="bad">BỊ SỬA</span>})</h2>
        <div style={{ maxHeight: 240, overflow: 'auto', font: '12px Consolas, monospace' }}>
          {audit.map((a, i) => <div key={i}><span style={{ color: '#5d6b79' }}>{fmt(a.ts)}</span> <b>{a.actor.slice(0, 10)}</b> {a.action} — {a.detail}</div>)}
        </div>
      </section>
    </div>
  );
}
