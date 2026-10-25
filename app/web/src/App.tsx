import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useAdminStatus } from './adminApi.js';
import { TEMPLATES, UNITS } from './data/catalog.js';
import { UnitSelect } from './UnitSelect.js';
import { ConnectionPanel } from './ConnectionPanel.js';
import { UpdateBanner } from './UpdateBanner.js';
import { Exam } from './Exam.js';
import { Gate } from './Gate.js';
import { ImportPage } from './ImportPage.js';
import { ListPage } from './ListPage.js';
import { Catalog, Home, Update } from './Pages.js';
import { ByTPage } from './ByTPage.js';
import { ReportPage } from './ReportPage.js';
import { BreakGlass, DeviceKeys } from './Security.js';
import { bridge } from './bridge.js';
import { session } from './session.js';
import { useConnection, useLog, useSession } from './ui.js';

type Page = 'home' | 'exam' | 'byt' | 'import' | 'catalog' | 'manage' | 'report' | 'update' | 'sec-dev' | 'sec-bg' | 'sec-admin' | 'sec-siem' | 'sec-phone' | 'sec-setup';
const MENU: [Page, string][] = [
  ['home', '⌂ Trang chủ'], ['exam', '🩺 Khám sức khỏe định kỳ'], ['import', '▤ Import Excel'], ['catalog', '▤ Danh mục'],
  ['manage', '▤ Quản lý hồ sơ'], ['report', '▤ Báo cáo'], ['byt', '▤ Cổng Bộ Y tế'], ['update', '▤ Cập nhật'],
];
// Dành cho MỌI người dùng (khoá của chính họ, phá-vỡ-kính cấp cứu của bác sĩ).
const USER_SEC: [Page, string][] = [['sec-dev', 'Thiết bị & khoá của tôi'], ['sec-bg', 'Phá vỡ kính (cấp cứu)']];
// CHỈ có trên trạm quản trị đã kích hoạt (và luôn đòi mật khẩu quản trị). Trên máy khác menu này không tồn tại.
const ADMIN_SEC: [Page, string][] = [['sec-admin', 'Quản trị cấp quyền'], ['sec-siem', 'Giám sát an ninh'], ['sec-phone', 'App điện thoại (nút 3/3)']];
const NEEDS_DEVICE: Page[] = ['exam', 'import', 'manage', 'report', 'byt'];

// Toàn bộ màn hình quản trị nằm trong AdminArea và chỉ được nạp bằng import động ở bản "admin". Ở bản "user" biểu thức này là
// hằng số (build thay __EDITION__ bằng "user") nên import bị loại: mã quản trị KHÔNG có trong gói (xem app/test-ui/user-edition-check.mjs).
const AdminArea = __EDITION__ === 'user' ? null : lazy(() => import('./AdminArea.js'));


/** Hình mờ truy vết: tên người dùng + giờ. Phủ chéo lặp lại để ảnh chụp bằng camera vẫn truy được nguồn. */
function Watermark({ text }: { text: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const esc = (s: string) => s.replace(/[<>&"']/g, '');
  const label = esc(text) + ' · ' + now.toLocaleString('vi-VN');
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200'><text x='20' y='120' transform='rotate(-24 180 100)' font-family='Segoe UI,Arial' font-size='15' font-weight='600' fill='#506070'>" + label + "</text></svg>";
  return <div className="wm" style={{ backgroundImage: 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")' }} />;
}

export function App() {
  const unlocked = useSession();
  const online = useConnection();
  const [connectionVersion, setConnectionVersion] = useState(0);
  const connected = useCallback(() => setConnectionVersion((v) => v + 1), []);
  useEffect(() => { if (!unlocked) setConnectionVersion(0); }, [unlocked]);
  const lines = useLog();
  const [page, setPage] = useState<Page>('exam');
  const [tpl, setTpl] = useState<string>('child');
  const [unit, setUnit] = useState<string>(UNITS[0].ma);
  const [menu, setMenu] = useState<'' | 'user' | 'admin'>('');
  const [adm, refreshAdm] = useAdminStatus();
  const c = session.client;

  useEffect(() => { document.title = (__EDITION__ === 'user' ? 'MedABE-NHÂN VIÊN' : 'MedABE-ADMIN') + ' - Version:[26.10.13] - [Khám sức khỏe toàn dân]'; /* tiêu đề phân biệt rõ bản quản trị và bản nhân viên */ }, []);

  // Menu quản trị chỉ tồn tại khi: bản build có phần quản trị VÀ máy này đã kích hoạt (hoặc đang ở chế độ kích hoạt --admin-setup).
  const showAdmin = !!AdminArea && !!adm && (adm.enrolled || adm.setupMode);
  const go = (p: string) => { if (__EDITION__ === 'user' && !online) return; setPage(p as Page); setMenu(''); };
  const showPick = NEEDS_DEVICE.includes(page) && page !== 'import' && page !== 'manage' && page !== 'report' && page !== 'byt';
  const userSec = page === 'sec-dev' || page === 'sec-bg';
  const adminSec = page === 'sec-admin' || page === 'sec-siem' || page === 'sec-phone' || page === 'sec-setup';

  const adminPage = (key: 'sec-admin' | 'sec-siem' | 'sec-phone' | 'sec-setup') =>
    showAdmin && AdminArea
      ? <Suspense fallback={null}><AdminArea page={key} adm={adm} refresh={() => void refreshAdm()} /></Suspense>
      : <div className="gatewrap"><section><h2>Không có quyền</h2><p className="sub">Phần này không khả dụng trên thiết bị này.</p></section></div>;

  let body: React.ReactNode;
  if (!unlocked && (__EDITION__ === 'user' || NEEDS_DEVICE.includes(page))) body = <div className="gatewrap"><Gate /></div>;
  else if (!online && (__EDITION__ === 'user' || NEEDS_DEVICE.includes(page))) body = <div className="gatewrap" role="alert"><section><h2>Chưa kết nối máy chủ KSK</h2><p>Ứng dụng đã khóa nhập liệu, xem hồ sơ và báo cáo. Hãy kết nối cùng Wi-Fi/LAN với máy KSK Admin và bật máy chủ.</p><p>Ứng dụng sẽ tự tìm và tải lại khi kết nối được đúng máy chủ.</p></section></div>;
  else if (page === 'home') body = <Home go={go} />;
  else if (page === 'exam') body = <Exam unit={unit} templateId={tpl} key={unit + tpl} />;
  else if (page === 'import') body = <ImportPage unit={unit} setUnit={setUnit} />;
  else if (page === 'catalog') body = <Catalog />;
  else if (page === 'manage') body = <ListPage unit={unit} setUnit={setUnit} key={unit} />;
  else if (page === 'report') body = <ReportPage unit={unit} setUnit={setUnit} key={unit} />;
  else if (page === 'byt') body = <ByTPage unit={unit} setUnit={setUnit} key={unit} />;
  else if (page === 'update') body = <Update />;
  else if (page === 'sec-dev') body = unlocked ? <DeviceKeys /> : <div className="gatewrap"><Gate /></div>;
  else if (page === 'sec-bg') body = unlocked ? <BreakGlass /> : <div className="gatewrap"><Gate /></div>;
  else body = adminPage(page as 'sec-admin' | 'sec-siem' | 'sec-phone' | 'sec-setup');

  return (
    <div className="app">
      {unlocked && c && <Watermark text={c.s.name} />}
      <div className="menubar">
        <img className="brand" src="ksk-logo.png" alt="KSK" />
        {MENU.filter(([k]) => k !== 'byt' || !!c?.s.attrs.includes('MED:Org:SoYTe')).map(([k, l]) => <a key={k} href="#" className={page === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(k); }}>{l}</a>)}
        <span className="dropdown">
          <a href="#" className={userSec ? 'on' : ''} onClick={(e) => { e.preventDefault(); setMenu(menu === 'user' ? '' : 'user'); }}>🔑 Khoá của tôi ▾</a>
          {menu === 'user' && <div className="dropmenu">{USER_SEC.map(([k, l]) => <a key={k} href="#" onClick={(e) => { e.preventDefault(); go(k); }}>{l}</a>)}</div>}
        </span>
        {showAdmin && (
          <span className="dropdown">
            <a href="#" className={adminSec ? 'on sec' : 'sec'} onClick={(e) => { e.preventDefault(); setMenu(menu === 'admin' ? '' : 'admin'); }}>🔒 Quản trị bảo mật ▾</a>
            {menu === 'admin' && (
              <div className="dropmenu">
                {adm?.setupMode && !adm.enrolled && <a href="#" onClick={(e) => { e.preventDefault(); go('sec-setup'); }}>Kích hoạt trạm quản trị</a>}
                {adm?.enrolled && ADMIN_SEC.map(([k, l]) => <a key={k} href="#" onClick={(e) => { e.preventDefault(); go(k); }}>{l}</a>)}
                {adm?.enrolled && adm.unlocked && <a href="#" onClick={(e) => { e.preventDefault(); void bridge?.admin?.lock().then(refreshAdm); setMenu(''); }}>Khoá phần quản trị ngay</a>}
              </div>
            )}
          </span>
        )}
        <a href="#" onClick={(e) => { e.preventDefault(); if (bridge) void bridge.quit(); else window.close(); }}>▤ Thoát</a>
        {unlocked && c && <span className="who">{c.s.name}{!session.autoMode && <> · <a href="#" onClick={(e) => { e.preventDefault(); session.lock(); }}>khoá</a></>}</span>}
      </div>

      {showPick && online && (
        <div className="pickbar">
          <label>Chọn mẫu:</label>
          <select value={tpl} onChange={(e) => setTpl(e.target.value)}>{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.ten}</option>)}</select>
          <label>Công ty:</label>
          <UnitSelect value={unit} onChange={setUnit} style={{ flex: 1 }} />
        </div>
      )}

      {unlocked && online && c && <UpdateBanner storageBase={c.s.storageBase} />}
      {unlocked && <ConnectionPanel onConnected={connected} />}
      <div key={String(online) + connectionVersion} className="content" onClick={() => menu && setMenu('')}>{body}</div>

      <div className="statusbar" title="Nhật ký thao tác">
        {lines.slice(0, 3).map((l, i) => <span key={i} className={l.cls}>{l.t} {l.msg}</span>)}
      </div>
    </div>
  );
}
