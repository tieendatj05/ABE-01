import { useMemo, useState } from 'react';
import type { RecordRow } from '../../../security/src/index.js';
import readXlsx from 'read-excel-file/universal';
import { DAN_TOC, NGUON_CHI_TRA, UNITS, XET_NGHIEM } from './data/catalog.js';
import { IcdPicker } from './IcdPicker.js';
import { mapHeader, rowsToHanhChinh, type Row } from './excel.js';
import { tuoi, validateHanhChinh, canWrite, type HanhChinh } from './model.js';
import { hardwareInfo, isDesktop, session } from './session.js';
import { log, run } from './ui.js';
import { useEffect } from 'react';

const Page = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="page"><div className="strip">{title}</div><div className="pagebody">{children}</div></div>
);

export function Home({ go }: { go: (p: string) => void }) {
  const c = session.client;
  const [hw, setHw] = useState<{ hash: string; host: string } | null>(null);
  useEffect(() => { void hardwareInfo()?.then(setHw); }, []);
  return (
    <Page title="Trang chủ">
      <h2>Hồ sơ khám sức khoẻ mã hoá</h2>
      {c ? (
        <table className="kv"><tbody>
          <tr><td>Người dùng</td><td>{c.s.name}</td></tr>
          <tr><td>Thuộc tính được cấp</td><td>{c.s.attrs.map((a) => <span key={a} className="tag">{a.replace('MED:', '')}</span>)}</td></tr>
          <tr><td>Thiết bị</td><td><code>{c.s.deviceId}</code> {isDesktop ? '(desktop)' : '(trình duyệt)'}</td></tr>
          {hw && <tr><td>Phần cứng</td><td>{hw.host} · băm <code>{hw.hash.slice(0, 12)}</code></td></tr>}
          <tr><td>Nút cấp khoá đã kết nối</td><td>{c.s.nodes.map((n) => <span key={n.org} className="tag">{n.org}{n.requiresApproval ? ' (cần duyệt điện thoại)' : ''}</span>)}</td></tr>
        </tbody></table>
      ) : <p className="warnbar">Thiết bị đang khoá.</p>}
      <div className="cards">
        {([['exam', 'Khám sức khỏe định kỳ'], ['import', 'Import Excel'], ['manage', 'Quản lý hồ sơ'], ['report', 'Báo cáo'], ['sec-dev', 'Bảo mật: thiết bị & khoá']] as [string, string][]).map(([k, l]) => (
          <button key={k} className="card" onClick={() => go(k)}>{l}</button>
        ))}
      </div>
    </Page>
  );
}

// ---------- Danh mục ----------
export function Catalog() {
  const [t, setT] = useState<'xn' | 'icd' | 'dt'>('xn');
  return (
    <Page title="Danh mục">
      <div className="tabsrow">{([['xn', 'Xét nghiệm'], ['icd', 'Mã ICD'], ['dt', 'Dân tộc']] as const).map(([k, l]) => <a key={k} href="#" className={t === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); setT(k); }}>{l}</a>)}</div>
      <div className="tablewrap tall">
        {t === 'xn' && <table className="grid"><thead><tr><th>Mã</th><th>Tên</th><th>Đơn vị</th><th>Bình thường (nam)</th><th>Bình thường (nữ)</th></tr></thead><tbody>{XET_NGHIEM.map((x) => <tr key={x.ma}><td>{x.ma}</td><td>{x.ten}</td><td>{x.dv}</td><td>{x.tcNam}</td><td>{x.tcNu}</td></tr>)}</tbody></table>}
        {t === 'icd' && <div style={{ padding: 8 }}><IcdPicker placeholder="Tra cứu ICD-10: gõ mã hoặc tên bệnh…" /></div>}
        {t === 'dt' && <table className="grid"><tbody>{DAN_TOC.map((x) => <tr key={x}><td>{x}</td></tr>)}</tbody></table>}
      </div>
    </Page>
  );
}

export function Update() {
  return (
    <Page title="Cập nhật">
      <table className="kv"><tbody>
        <tr><td>Phiên bản</td><td>26.10.13</td></tr>
        <tr><td>Chế độ chạy</td><td>{isDesktop ? 'Desktop' : 'Trình duyệt'}</td></tr>
      </tbody></table>
    </Page>
  );
}
