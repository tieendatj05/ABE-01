// Toàn bộ màn hình QUẢN TRỊ nằm trong module này và chỉ được nạp bằng import động ở bản "admin".
// Bản "user" không đóng gói module này (xem App.tsx và app/desktop/build.mjs).
import { Admin } from './Admin.js';
import { AdminGate, AdminSetup } from './AdminGate.js';
import { Monitor } from './Monitor.js';
import { Phone } from './Phone.js';
import { SecPage } from './Security.js';
import type { AdminStatus } from './bridge.js';

export type AdminPageKey = 'sec-admin' | 'sec-siem' | 'sec-phone' | 'sec-setup';

const Msg = ({ title, text }: { title: string; text: React.ReactNode }) => <div className="gatewrap"><section><h2>{title}</h2><p className="sub">{text}</p></section></div>;

export default function AdminArea({ page, adm, refresh }: { page: AdminPageKey; adm: AdminStatus | null; refresh: () => void }) {
  if (!adm) return <Msg title="Không có quyền" text="Phần này không khả dụng trên thiết bị này." />;
  if (page === 'sec-setup') {
    return adm.setupMode && !adm.enrolled ? <AdminSetup onDone={refresh} /> : <Msg title="Đã kích hoạt" text="Hãy khởi động lại ứng dụng bình thường để dùng phần quản trị." />;
  }
  if (!adm.enrolled) return <Msg title="Chưa kích hoạt" text={<>Máy này chưa phải trạm quản trị. Mở ứng dụng bằng tham số <code>--admin-setup</code> để kích hoạt.</>} />;
  if (!adm.unlocked) return <AdminGate status={adm} onDone={refresh} />;
  if (page === 'sec-admin') return <SecPage title="Quản trị cấp quyền (mỗi tổ chức một admin riêng)"><Admin /></SecPage>;
  if (page === 'sec-siem') return <SecPage title="Giám sát an ninh (SIEM)"><Monitor /></SecPage>;
  return <SecPage title="App xác thực trên điện thoại"><Phone /></SecPage>;
}
