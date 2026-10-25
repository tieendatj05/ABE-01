import { useEffect, useState } from 'react';
import { adm } from './adminApi.js';
import { bridge } from './bridge.js';
import { log, run } from './ui.js';

const ORGS = ['BenhVien', 'SoYTe', 'DienThoai'] as const;

/**
 * Mỗi tổ chức có admin riêng và độc lập: registry chỉ cấp danh tính; mỗi nút tự duyệt quyền của nó. Trên trạm quản trị này, các token
 * nằm trong kho mã hoá của tiến trình chính - màn hình này KHÔNG nhận và KHÔNG hiển thị token.
 */
export function Admin() {
  const [name, setName] = useState('');
  const [role, setRole] = useState('BacSi');
  const [khoa, setKhoa] = useState('Nhi');
  const [useDt, setUseDt] = useState(true);
  const [link, setLink] = useState('');
  const [out, setOut] = useState('');
  const [bumpAttr, setBumpAttr] = useState('MED:Khoa:Nhi');
  const [bgSubject, setBgSubject] = useState('');
  const [org, setOrg] = useState<(typeof ORGS)[number]>('BenhVien');
  const [holders, setHolders] = useState<{ gid: string; name: string; attrs: string[]; disabled: boolean }[]>([]);
  const [openEnr, setOpenEnr] = useState<boolean | null>(null);
  const [defAttrs, setDefAttrs] = useState<string[]>([]);
  const [devices, setDevices] = useState<{ gid: string; name: string; deviceId: string; disabled: boolean; createdAt: string }[]>([]);
  const [oldPw, setOldPw] = useState('');

  const loadEnrollment = async () => {
    try {
      setOpenEnr(!!(await adm('storage', 'GET', '/api/enrollment')).open);
      const cur = await adm('BenhVien', 'GET', '/admin/open-enrollment');
      setDefAttrs((cur.attrs as string[]).map((x) => x.replace(/^MED:/, '')));
    } catch { /* chưa mở khoá hoặc nút chưa chạy */ }
  };
  useEffect(() => { void loadEnrollment(); }, []);
  const toggleAttr = (x: string) => setDefAttrs((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));
  /** Áp cùng một cấu hình đăng ký tự do cho registry và cả 3 nút (để "bật/tắt" có hiệu lực thật). */
  const applyEnrollment = (open: boolean) => run(open ? 'Bật đăng ký tự do' : 'Tắt đăng ký tự do', async () => {
    await adm('storage', 'POST', '/api/admin/enrollment', { open });
    for (const o of ORGS) await adm(o, 'POST', '/admin/open-enrollment', { enabled: open, attrs: defAttrs });
    setOpenEnr(open);
    log(open ? 'Đã BẬT đăng ký tự do: máy mới chỉ cần nhập tên. Nhớ TẮT sau khi nhân viên đã đăng ký xong.' : 'Đã TẮT đăng ký tự do.', open ? 'warn' : 'ok');
  });
  const saveDefaults = () => run('Lưu quyền mặc định', async () => {
    for (const o of ORGS) await adm(o, 'POST', '/admin/open-enrollment', { enabled: !!openEnr, attrs: defAttrs });
    log('Đã lưu quyền mặc định cho máy tự đăng ký (áp dụng cho máy đăng ký SAU lúc này).', 'ok');
  });
  const loadDevices = () => run('Danh sách máy đã đăng ký', async () => { setDevices(await adm('storage', 'GET', '/api/admin/devices')); });
  const disableDevice = (gid: string, nm: string) => run('Khoá máy ' + nm, async () => {
    await adm('storage', 'POST', `/api/admin/devices/${gid}/disable`, {});
    log(`Đã khoá máy của ${nm}: máy này không truy cập được kho dữ liệu nữa.`, 'warn');
    await loadDevices();
  });
  const [newPw, setNewPw] = useState('');

  const onboard = () => run('Cấp nhanh nhân sự', async () => {
    const inv = await adm('storage', 'POST', '/api/admin/invites', { name });
    const attrs = role === 'SoYTe' ? ['Org:SoYTe'] : role === 'TiepDon' ? ['Role:TiepDon'] : role === 'KetLuan' ? ['Role:KetLuan', 'Role:BacSi'] : role === 'KTV' ? ['Role:KTV', 'Khoa:XetNghiem'] : ['Role:BacSi', `Khoa:${khoa}`];
    const parts = [`i=${encodeURIComponent(inv.code)}`];
    for (const o of ORGS) {
      if (o === 'DienThoai' && !useDt) continue;
      const g = await adm(o, 'POST', '/admin/grants', { name, attrs });
      parts.push(`a=${encodeURIComponent(`${o}:${g.code}`)}`);
    }
    setLink(parts.join('&'));
    log(`Đã tạo gói đăng ký cho ${name} (${attrs.join(', ')})`, 'ok');
  });

  const loadHolders = () => run('Danh sách người giữ quyền', async () => { setHolders(await adm(org, 'GET', '/admin/holders')); });
  const revoke = (gid: string, attr: string) => run(`Thu hồi ${attr} tại ${org}`, async () => {
    await adm(org, 'POST', '/admin/revoke', { gid, attr });
    log(`${org} đã thu hồi. Cần thu hồi ở đủ số nút cấp được khoá, rồi tăng epoch (nút bên dưới).`, 'warn');
    await loadHolders();
  });
  const bump = () => run('Tăng epoch ' + bumpAttr, async () => {
    const r = await adm('storage', 'POST', '/api/admin/epochs/bump', { base: bumpAttr });
    log(`Epoch ${bumpAttr} = ${r.counter}. Bản ghi sẽ tự được bọc lại khi người còn quyền mở nó.`, 'ok');
  });
  const closeBg = () => run('Đóng phá-vỡ-kính', async () => {
    const r = await adm('storage', 'POST', '/api/admin/break-glass/close', { subject: bgSubject.trim() });
    log(`Đã đóng phá-vỡ-kính, bộ đếm BG = ${r.counter}`, 'ok');
  });
  const auditOf = (label: string, fetcher: () => Promise<any>) => run(label, async () => {
    const r = await fetcher();
    setOut(`Chuỗi băm: ${r.chain.ok ? 'TOÀN VẸN' : 'BỊ SỬA tại #' + r.chain.brokenAt}\n` +
      r.records.slice(-12).reverse().map((x: any) => `#${x.seq ?? ''} ${x.actor} ${x.action} ${x.detail}`).join('\n'));
  });

  return (
    <>
      <section>
        <h2>Đăng ký máy mới (nhân viên tự đăng ký chỉ bằng tên)</h2>
        <p>Trạng thái: {openEnr === null ? '…' : openEnr ? <b className="warn">ĐANG BẬT</b> : <b className="ok">đang tắt</b>}. Khi BẬT, nhân viên mở ứng dụng, nhập tên là dùng được ngay với bộ quyền mặc định bên dưới. {openEnr && <span className="warn">Lúc này <b>bất kỳ máy nào trong mạng</b> cũng tự đăng ký được - hãy TẮT khi nhân viên đã đăng ký xong.</span>}</p>
        <div className="row">
          <button disabled={openEnr === true} onClick={() => void applyEnrollment(true)}>Bật đăng ký tự do</button>
          <button className="ghost" disabled={openEnr !== true} onClick={() => void applyEnrollment(false)}>Tắt đăng ký tự do</button>
        </div>
        <h3>Quyền mặc định cho máy tự đăng ký</h3>
        <div className="checks" style={{ padding: 0 }}>
          {['Role:TiepDon', 'Role:BacSi', 'Role:KTV', 'Role:KetLuan', 'Khoa:Nhi', 'Khoa:Mat', 'Khoa:TMH', 'Khoa:RHM', 'Khoa:XetNghiem'].map((x) => (
            <label key={x} className="radio"><input type="checkbox" checked={defAttrs.includes(x)} onChange={() => toggleAttr(x)} /> {x}</label>
          ))}
        </div>
        <p className="sub">Chọn tất cả = mọi nhân viên làm được mọi việc nghiệp vụ (không có quyền quản trị). Muốn phân quyền chặt hơn, bỏ bớt quyền ở đây hoặc dùng phần "Nâng cao" để cấp riêng theo vai trò.</p>
        <button className="ghost" onClick={() => void saveDefaults()}>Lưu quyền mặc định</button>
      </section>

      <section>
        <h2>Máy đã đăng ký</h2>
        <button className="ghost" onClick={() => void loadDevices()}>Tải danh sách</button>
        {devices.length > 0 && (
          <table><thead><tr><th>Tên</th><th>Mã máy</th><th>Đăng ký lúc</th><th /></tr></thead><tbody>
            {devices.map((d) => <tr key={d.gid}><td>{d.name}{d.disabled ? ' (đã khoá)' : ''}</td><td><code>{d.deviceId}</code></td><td>{new Date(d.createdAt).toLocaleString('vi-VN')}</td>
              <td>{!d.disabled && <a href="#" className="bad" onClick={(e) => { e.preventDefault(); void disableDevice(d.gid, d.name); }}>khoá máy này</a>}</td></tr>)}
          </tbody></table>
        )}
        <p className="sub">Mất máy hoặc nhân viên nghỉ việc: <b>khoá máy</b> để máy đó không truy cập được kho dữ liệu nữa; sau đó thu hồi thuộc tính và tăng epoch (bên dưới) để dữ liệu mới không mở được bằng khoá cũ.</p>
      </section>

      <details style={{ marginBottom: 12 }}>
        <summary><b>Nâng cao:</b> cấp quyền riêng theo vai trò cho từng người (không bắt buộc)</summary>
      <section>
        <h2>Cấp nhanh nhân sự</h2>
        <p className="sub">Tạo mã mời ở registry và mã cấp quyền ở từng tổ chức, gom thành một gói đăng ký. Cần ít nhất 2 tổ chức đồng thuận thì khoá mới được tạo.</p>
        <div className="row">
          <input placeholder="Tên (vd BS Nguyễn Văn A)" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}><option>TiepDon</option><option>BacSi</option><option>KTV</option><option>KetLuan</option><option>SoYTe</option></select>
          {role === 'BacSi' && <select value={khoa} onChange={(e) => setKhoa(e.target.value)}>{['Nhi', 'Mat', 'TMH', 'RHM'].map((k) => <option key={k}>{k}</option>)}</select>}
          <label style={{ flex: '0 0 auto' }}><input type="checkbox" checked={useDt} onChange={(e) => setUseDt(e.target.checked)} style={{ width: 'auto' }} /> gồm nút Điện thoại</label>
          <button disabled={!name.trim()} onClick={() => void onboard()}>Tạo gói đăng ký</button>
        </div>
        {link && <p>Gói đăng ký (dùng một lần) - gửi cho nhân sự, họ dán vào ô "Dán gói đăng ký" trên máy của họ:<br /><code>{link}</code></p>}
      </section>
      </details>

      <section>
        <h2>Thu hồi quyền / kết thúc cấp cứu</h2>
        <div className="row">
          <select value={org} onChange={(e) => setOrg(e.target.value as (typeof ORGS)[number])}>{ORGS.map((o) => <option key={o}>{o}</option>)}</select>
          <button className="ghost" onClick={() => void loadHolders()}>Người giữ quyền tại nút này</button>
        </div>
        {holders.length > 0 && (
          <table><tbody>
            {holders.map((h) => (
              <tr key={h.gid}><td>{h.name}{h.disabled ? ' (đã khoá)' : ''}</td>
                <td>{h.attrs.map((a) => <span key={a}><span className="tag">{a.replace('MED:', '')}</span><a href="#" onClick={(e) => { e.preventDefault(); void revoke(h.gid, a); }}>thu hồi</a> </span>)}</td></tr>
            ))}
          </tbody></table>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <input value={bumpAttr} onChange={(e) => setBumpAttr(e.target.value)} />
          <button onClick={() => void bump()}>Tăng epoch thuộc tính</button>
        </div>
        <div className="row">
          <input placeholder="Chỉ mục mù của bệnh nhân (cột subject trong cảnh báo)" value={bgSubject} onChange={(e) => setBgSubject(e.target.value)} />
          <button className="danger" disabled={!bgSubject.trim()} onClick={() => void closeBg()}>Đóng phá-vỡ-kính</button>
        </div>
      </section>

      <section>
        <h2>Nhật ký quản trị (chuỗi băm)</h2>
        <div className="row">
          <button className="ghost" onClick={() => void auditOf('Audit registry', () => adm('storage', 'GET', '/api/admin/audit'))}>Registry/Lưu trữ</button>
          {ORGS.map((o) => <button key={o} className="ghost" onClick={() => void auditOf(`Audit ${o}`, () => adm(o, 'GET', '/admin/audit'))}>{o}</button>)}
        </div>
        {out && <pre>{out}</pre>}
      </section>

      <section>
        <h2>Trạm quản trị này</h2>
        <p className="sub">Token quản trị nằm trong kho mã hoá (mật khẩu + DPAPI + buộc phần cứng); tự khoá sau 5 phút không dùng.</p>
        <div className="row">
          <button onClick={() => void bridge?.admin?.lock()}>Khoá ngay</button>
          <input type="password" placeholder="Mật khẩu hiện tại" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
          <input type="password" placeholder="Mật khẩu mới (≥ 10 ký tự, có chữ và số)" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          <button disabled={!oldPw || !newPw} onClick={() => void run('Đổi mật khẩu quản trị', async () => { await bridge!.admin!.changePassword(oldPw, newPw); setOldPw(''); setNewPw(''); log('Đã đổi mật khẩu quản trị.', 'ok'); })}>Đổi mật khẩu</button>
        </div>
        <div className="row">
          <button className="danger" disabled={!oldPw} onClick={() => { if (confirm('Gỡ kích hoạt trạm quản trị trên máy này? Cần kích hoạt lại bằng gói mới.')) void run('Gỡ kích hoạt', async () => { await bridge!.admin!.reset(oldPw); setOldPw(''); log('Đã gỡ kích hoạt trạm quản trị.', 'warn'); }); }}>Gỡ kích hoạt trạm quản trị (nhập mật khẩu hiện tại ở trên)</button>
        </div>
      </section>
    </>
  );
}
