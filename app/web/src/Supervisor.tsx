import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { openImage, type ImageView, type RecordRow } from '../../../security/src/index.js';
import { ViewCanvas } from './ImagesPage.js';
import { session } from './session.js';
import { sachTenAll } from './ten.js';
import { log, run } from './ui.js';

// GIÁM SÁT HỒ SƠ (vai trò đọc TẤT CẢ, KHÔNG ghi, KHÔNG quản trị). Phải qua MFA (mã TOTP trên điện thoại): MFA là THUỘC TÍNH ABE (Auth:MFA), thiếu nó thì không giải mã được. Mọi lần tra cứu phải nhập LÝ DO; máy chủ ghi nhật ký lý do + đối tượng đọc và
// phát cảnh báo nếu đọc dồn dập. Việc giải mã diễn ra trên máy này (máy chủ không có khoá). Phiên tự hết sau 10 phút không thao tác; không dùng qua Internet.
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
const KHOA_LABEL: Record<string, string> = { Nhi: 'Nhi', ThanKinh: 'Thần kinh', Mat: 'Mắt', TMH: 'Tai-Mũi-Họng', RHM: 'Răng-Hàm-Mặt', KSK: 'Khám chung', XetNghiem: 'Xét nghiệm' };
const TYPE_LABEL: Record<string, string> = { hanhchinh: 'Hành chính', lamsang: 'Lâm sàng', lankham: 'Lần khám', tiensu: 'Tiền sử', thecuc: 'Thể lực', canlamsang: 'Cận lâm sàng', ketluan: 'Kết luận', anh: 'Ảnh gốc', vung: 'Vùng ảnh' };

interface Item { row: RecordRow; data: unknown; sig: boolean }
interface Shot { key: string; view: ImageView | null }

export function Supervisor({ unit }: { unit: string }) {
  const c = session.client!;
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<{ hoTen: string; cccd: string }[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [searched, setSearched] = useState('');
  const [hidden, setHidden] = useState(0);
  const reasonOk = reason.trim().length >= 8;

  // ---- MFA (TOTP): thuộc tính ABE Auth:MFA chỉ có sau khi nhập đúng mã, và hết hạn sau mfa.freshMinutes
  const [mfa, setMfa] = useState<{ required: boolean; enrolled: boolean; verified: boolean; freshMinutes: number } | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null);
  const loadMfa = () => run('Kiểm tra MFA', async () => { const m = await c.mfaStatus(); setMfa(m); if (m.verified && verifiedAt === null) setVerifiedAt(Date.now()); });
  useEffect(() => { void loadMfa(); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const leftMin = mfa && verifiedAt ? Math.max(0, mfa.freshMinutes - (now - verifiedAt) / 60000) : 0;
  const mfaOk = !!mfa?.verified && leftMin > 0;
  const startEnroll = () => run('Đăng ký MFA', async () => {
    const e = await c.mfaEnroll(pw); setPw('');
    setEnrol({ secret: e.secret, qr: await QRCode.toDataURL(e.uri, { width: 220, margin: 1 }) });
    log('Quét mã QR bằng ứng dụng xác thực (Google/Microsoft Authenticator) rồi nhập mã 6 số để xác nhận.', 'ok');
  });
  const confirmCode = () => run('Xác thực MFA', async () => {
    await c.mfaVerify(code.trim()); setCode(''); setEnrol(null);
    const m = await c.mfaStatus(); setMfa(m); setVerifiedAt(Date.now());
    log('Đã xác thực MFA: phiên này nhận thuộc tính ABE Auth:MFA trong ' + m.freshMinutes + ' phút.', 'ok');
  });

  const loadPeople = async () => {
    if (people) return people;
    c.accessReason = reason;
    const all = await c.listGroup(unit);
    const latest = new Map<string, (typeof all)[number]>();
    for (const r of all) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
    const opened = sachTenAll(await c.openMany([...latest.values()]));
    const list = opened.flatMap((o) => { const d = o?.data as { hoTen?: string; cccd?: string } | undefined; return d?.cccd && /^\d{12}$/.test(d.cccd) ? [{ hoTen: d.hoTen ?? '', cccd: d.cccd }] : []; });
    setPeople(list); return list;
  };
  const q = fold(query);
  const isCccd = /^\d{12}$/.test(query.trim());
  const matches = !people || q.length < 2 || isCccd ? [] : people.filter((p) => fold(p.hoTen).includes(q) || p.cccd.includes(q)).slice(0, 8);

  const lookup = (code: string) => run('Tra cứu (ghi nhật ký kèm lý do)', async () => {
    if (!mfaOk) throw new Error('Cần xác thực MFA (mã 6 số) trước khi tra cứu');
    if (!reasonOk) throw new Error('Nhập lý do truy cập (tối thiểu 8 ký tự) trước khi tra cứu');
    c.accessReason = reason;
    let rows;
    try { rows = await c.listRecords(code); } catch (e) { if (/MFA_REQUIRED/.test((e as Error).message)) { setVerifiedAt(null); void loadMfa(); throw new Error('MFA đã hết hạn: nhập lại mã 6 số'); } throw e; }
    const plain = rows.filter((r) => r.type !== 'anh' && r.type !== 'vung');
    const opened = sachTenAll(await c.openMany(plain));
    setItems(plain.map((row, i) => ({ row, data: opened[i]?.data ?? null, sig: !!opened[i]?.signatureValid })));
    const by = new Map<string, RecordRow[]>();
    for (const r of rows.filter((x) => (x.type === 'anh' || x.type === 'vung') && x.refId)) (by.get(r.refId!) ?? by.set(r.refId!, []).get(r.refId!)!).push(r);
    const out: Shot[] = [];
    for (const [key, rs] of by) out.push({ key, view: await openImage(c, rs) });
    setShots(out); setSearched(code); setHidden(c.restrictedCount(code));
    log(`Đã đọc ${rows.length} mục của hồ sơ (ghi nhật ký kèm lý do).`, 'ok');
  });

  const onQuery = (v: string) => {
    setQuery(v);
    if (v.trim().length >= 2 && !/^\d{12}$/.test(v.trim()) && !people && reasonOk && mfaOk) void run('Tải danh sách để tra theo tên', async () => { await loadPeople(); });
  };

  return (
    <div className="pagebody">
      <section>
        <h2>🛡 Giám sát hồ sơ (đọc tất cả, không ghi)</h2>
        <p className="warnbar" role="note" style={{ marginTop: 0 }}>Mỗi lần tra cứu <b>bắt buộc nhập lý do</b> và được <b>ghi vào nhật ký</b> kèm tài khoản của bạn; đọc dồn dập sẽ phát cảnh báo. Phiên tự hết sau <b>10 phút</b> không thao tác; tài khoản này <b>không dùng được qua Internet</b>. Bạn xem được cả <b>ảnh gốc</b> — hãy dùng đúng mục đích. Chỉ đọc được dữ liệu <b>mới</b> (đã có nhánh Giám sát trong bản mã); bản ghi cũ hiện chưa mở được.</p>
        <div role="region" aria-label="Xác thực hai lớp" style={{ margin: '8px 0', padding: 10, border: `1px solid ${mfaOk ? '#7fbf7f' : '#d9a441'}`, background: mfaOk ? '#f3faf3' : '#fff8e6', borderRadius: 6 }}>
          <b>🔐 Xác thực hai lớp (MFA)</b> <small>— là một <b>thuộc tính ABE</b> (Auth:MFA): chính sách của Giám sát là <code>Role:GiamSat AND Auth:MFA</code>; thiếu nó thì có khoá Giám sát cũng không giải mã được.</small>
          {!mfa && <div><small>Đang kiểm tra…</small></div>}
          {mfa && mfaOk && <div className="ok">✔ Đã xác thực — còn khoảng <b>{Math.ceil(leftMin)}</b> phút (hết hạn thì phải nhập lại mã).</div>}
          {mfa && !mfaOk && !mfa.enrolled && !enrol && <div className="row" style={{ alignItems: 'center' }}>
            <span style={{ flex: 'none' }}>Chưa đăng ký MFA. Nhập lại mật khẩu để tạo mã QR:</span>
            <input type="password" aria-label="Mật khẩu để đăng ký MFA" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ maxWidth: 260 }} />
            <button disabled={!pw} onClick={() => void startEnroll()}>Tạo mã QR</button>
          </div>}
          {enrol && <div>
            <div className="row" style={{ alignItems: 'center' }}>
              <img src={enrol.qr} alt="Mã QR đăng ký MFA" width={220} height={220} style={{ flex: 'none' }} />
              <div>Quét bằng Google/Microsoft Authenticator. Không quét được thì nhập tay mã bí mật:<br /><code aria-label="Bí mật MFA" style={{ userSelect: 'all', fontSize: 15 }}>{enrol.secret}</code><br /><small>Mã bí mật chỉ hiện <b>một lần</b>. Máy chủ lưu nó đã mã hoá; quản trị không thấy.</small></div>
            </div>
          </div>}
          {mfa && !mfaOk && (mfa.enrolled || enrol) && <div className="row" style={{ alignItems: 'center' }}>
            <span style={{ flex: 'none' }}>{enrol ? 'Nhập mã 6 số để xác nhận đăng ký:' : 'Nhập mã 6 số trong ứng dụng xác thực:'}</span>
            <input inputMode="numeric" maxLength={6} aria-label="Mã MFA 6 số" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void confirmCode(); }} style={{ maxWidth: 140 }} />
            <button disabled={code.length !== 6} onClick={() => void confirmCode()}>Xác nhận</button>
          </div>}
        </div>
        <div className="row">
          <input style={{ minWidth: 420 }} disabled={!mfaOk} placeholder="Lý do truy cập (bắt buộc, ≥ 8 ký tự) — ví dụ: kiểm tra tuân thủ quý 4" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Lý do truy cập" />
        </div>
        <div className="row">
          <input style={{ minWidth: 340 }} placeholder="Họ tên hoặc số CCCD (12 số)" value={query} disabled={!reasonOk || !mfaOk} onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && isCccd) void lookup(query.trim()); }} aria-label="Tra cứu bệnh nhân" />
          <button disabled={!reasonOk || !mfaOk || !isCccd} onClick={() => void lookup(query.trim())}>Tra cứu hồ sơ</button>
        </div>
        {!mfaOk ? <p className="hint">Hoàn tất xác thực MFA ở trên trước.</p> : !reasonOk && <p className="hint">Nhập lý do truy cập trước để mở ô tra cứu.</p>}
        {matches.length > 0 && <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, border: '1px solid #cfd7df', borderRadius: 6, maxWidth: 520 }}>
          {matches.map((p) => <li key={p.cccd}><button className="mini2" style={{ width: '100%', textAlign: 'left' }} onClick={() => { setQuery(`${p.hoTen} · ${p.cccd}`); void lookup(p.cccd); }}>{p.hoTen || '(không tên)'} · {p.cccd}</button></li>)}</ul>}
      </section>

      {searched && (
        <section>
          <h2>Hồ sơ {searched} — {items.length} mục dữ liệu, {shots.length} ảnh</h2>
          {hidden > 0 && <p className="warnbar" role="status">Còn {hidden} mục mà tài khoản này không xem được (bản ghi cũ chưa có nhánh Giám sát).</p>}
          <table className="grid">
            <thead><tr><th>Loại</th><th>Khoa</th><th>Tác giả (mã tài khoản)</th><th>Ngày</th><th>Chữ ký</th><th>Nội dung (giải mã trên máy này)</th></tr></thead>
            <tbody>{items.map(({ row, data, sig }) => (
              <tr key={row.id}>
                <td>{TYPE_LABEL[row.type] ?? row.type}</td>
                <td>{row.khoa.split(',').map((k) => KHOA_LABEL[k] ?? k).join(', ')}</td>
                <td>{(row.authorUserId ?? '—').slice(0, 10)}</td>
                <td>{new Date(row.createdAt).toLocaleString('vi-VN')}</td>
                <td>{data === null ? '—' : sig ? <span className="ok">✔ hợp lệ</span> : <span className="bad">✗ sai</span>}</td>
                <td>{data === null ? <span className="lock">🔒 không giải mã được</span> : <details><summary>Xem</summary><pre style={{ maxWidth: 560, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(data, null, 2)}</pre></details>}</td>
              </tr>))}</tbody>
          </table>
          {shots.map((s, n) => (
            <div key={s.key} style={{ margin: '12px 0', padding: 10, border: '1px solid #cfd7df', borderRadius: 6 }}>
              <b>Ảnh {n + 1}{s.view?.series ? ` · lát ${s.view.series.index + 1}/${s.view.series.count}` : ''}</b>{' '}
              {s.view && s.view.width > 0 ? <>
                <span className={s.view.limited ? 'warn' : 'ok'}>{s.view.limited ? '⚠ chỉ các vùng được cấp' : '✔ Ảnh gốc đầy đủ'}</span>
                <div style={{ margin: '8px 0' }}><ViewCanvas view={s.view} /></div>
                <small>Vùng: {s.view.regions.length ? s.view.regions.map((r, i) => `#${i + 1} [${r.khoas.map((k) => KHOA_LABEL[k] ?? k).join(' + ')}] ${r.rect.w}x${r.rect.h}`).join(' · ') : 'không có'}</small>
                {s.view.tampered > 0 && <p className="bad">⚠ {s.view.tampered} phần ảnh bị phát hiện can thiệp/sai chữ ký.</p>}
              </> : <span className="bad">Không mở được ảnh này.</span>}
            </div>))}
        </section>
      )}
    </div>
  );
}
