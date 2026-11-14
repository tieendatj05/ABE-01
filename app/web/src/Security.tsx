import { useEffect, useState } from 'react';
import { hardwareInfo, isDesktop, session } from './session.js';
import { log, run } from './ui.js';

const Page = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="page"><div className="strip secstrip">🔒 PHẦN BẢO MẬT · {title}</div><div className="pagebody">{children}</div></div>
);

/** Thiết bị & khoá: trạng thái khoá của máy này và các thao tác khoá. Toàn bộ logic nằm trong gói security/ - màn hình này chỉ hiển thị. */
export function DeviceKeys() {
  const c = session.client;
  const [hw, setHw] = useState<{ hash: string; host: string; macs: string[] } | null>(null);
  const [org, setOrg] = useState('BenhVien');
  const [code, setCode] = useState('');
  useEffect(() => { void hardwareInfo()?.then(setHw); }, []);
  if (!c) return <Page title="Thiết bị & khoá"><p className="warnbar">Thiết bị đang khoá.</p></Page>;
  const keyCount = Object.keys(c.s.keys).length;
  return (
    <Page title="Thiết bị & khoá">
      <table className="kv"><tbody>
        <tr><td>Người dùng</td><td>{c.s.name}</td></tr>
        <tr><td>GID (định danh toàn cục)</td><td><code>{c.s.gid}</code></td></tr>
        <tr><td>Thiết bị</td><td><code>{c.s.deviceId}</code> {isDesktop ? '· desktop' : '· trình duyệt'}</td></tr>
        {hw && <tr><td>Phần cứng</td><td>{hw.host} · băm <code>{hw.hash.slice(0, 16)}</code></td></tr>}
        <tr><td>Thuộc tính</td><td>{c.s.attrs.map((a) => <span key={a} className="tag">{a.replace('MED:', '')}</span>)}</td></tr>
        <tr><td>Khoá đang giữ trong bộ nhớ</td><td>{keyCount} khoá (theo phiên bản epoch)</td></tr>
        <tr><td>Nút cấp khoá</td><td>{c.s.nodes.map((n) => <span key={n.org} className="tag">{n.org}{n.requiresApproval ? ' · cần duyệt điện thoại' : ''}</span>)}</td></tr>
        <tr><td>Phá-vỡ-kính đang hiệu lực</td><td>{Object.entries(c.s.bg).filter(([, t]) => t > Date.now()).map(([i, t]) => <span key={i} className="tag warn">{i.slice(0, 8)}… đến {new Date(t).toLocaleString('vi-VN')}</span>)}{!Object.values(c.s.bg).some((t) => t > Date.now()) && 'Không có'}</td></tr>
      </tbody></table>
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => { c.resetKeys(); session.schedulePersist(); log('Đã làm mới khoá.', 'ok'); }}>Làm mới khoá</button>
        <select value={org} onChange={(e) => setOrg(e.target.value)}>{['BenhVien', 'SoYTe', 'DienThoai'].map((o) => <option key={o}>{o}</option>)}</select>
        <input placeholder="Mã cấp quyền của tổ chức" value={code} onChange={(e) => setCode(e.target.value)} />
        <button disabled={!code.trim()} onClick={() => void run('Nhận thuộc tính', async () => { await session.addNodeCode(org, code.trim()); setCode(''); log(`Đã nhận thuộc tính từ ${org}`, 'ok'); })}>Thêm thuộc tính</button>
        <button className="danger" onClick={() => session.lock()}>Khoá thiết bị</button>
      </div>
    </Page>
  );
}

/** Phá vỡ kính (cấp cứu): chỉ bác sĩ; mọi nút cấp khoá đều ghi log + bắn cảnh báo. */
export function BreakGlass() {
  const c = session.client;
  const [cccd, setCccd] = useState('');
  const [reason, setReason] = useState('');
  if (!c) return <Page title="Phá vỡ kính"><p className="warnbar">Thiết bị đang khoá.</p></Page>;
  const isDoctor = c.s.attrs.includes('MED:Role:BacSi');
  return (
    <Page title="Phá vỡ kính">
      {!isDoctor && <p className="warnbar">Chỉ Bác sĩ được phá vỡ kính.</p>}
      <div className="row"><input placeholder="Số CCCD bệnh nhân" value={cccd} onChange={(e) => setCccd(e.target.value)} /><input placeholder="Lý do (≥ 10 ký tự)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 2 }} />
        <button className="danger" disabled={!isDoctor || !cccd.trim() || reason.trim().length < 10} onClick={() => void run('Phá vỡ kính', async () => {
          const until = await c.breakGlass(cccd, reason);
          session.schedulePersist();
          log(`Đã kích hoạt đến ${new Date(until).toLocaleString('vi-VN')}.`, 'warn');
          setReason('');
        })}>Kích hoạt</button></div>
    </Page>
  );
}

export { Page as SecPage };
