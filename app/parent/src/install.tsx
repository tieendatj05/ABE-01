// Thẻ "Cài app lên màn hình chính": Android (Chrome) cài bằng MỘT nút; iPhone (Safari) không có nút cài nên hướng dẫn từng bước.
// Nếu mở trong trình duyệt của Zalo/Facebook/Messenger... (không cài được app từ đó) thì nhắc mở bằng Safari/Chrome.
// Tự ẩn khi app đã chạy như ứng dụng (đã cài) hoặc nằm trong vỏ Capacitor, hoặc khi người dùng bấm đóng.
import { useEffect, useState } from 'react';
import { Icon } from './icons.js';

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const KEY = 'ksk.install.dismiss';

export function InstallCard() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const done = () => setHidden(true);
    addEventListener('beforeinstallprompt', on); addEventListener('appinstalled', done);
    return () => { removeEventListener('beforeinstallprompt', on); removeEventListener('appinstalled', done); };
  }, []);

  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const secure = window.isSecureContext && location.protocol !== 'file:';
  const inApp = /zalo|fban|fbav|fb_iab|messenger|instagram|tiktok|line\/|\bwv\b/i.test(ua);
  if (hidden || standalone || native || !secure) return null;

  const close = () => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* không có localStorage */ } };
  const install = async () => { if (!evt) return; await evt.prompt(); await evt.userChoice.catch(() => undefined); setEvt(null); };

  if (inApp) {
    const b = ios ? 'Safari' : 'Chrome';
    return (
      <aside className="install warn" aria-label={`Hãy mở bằng ${b}`}>
        <span className="install-ico"><Icon n="share" size={22} /></span>
        <div className="install-t">
          <b>Hãy mở bằng {b} để cài app</b>
          <p>Bạn đang mở trong ứng dụng khác (Zalo, Facebook…) nên chưa cài được. Bấm <b>⋯</b> (hoặc biểu tượng trình duyệt) ở góc màn hình, chọn <b>Mở bằng {ios ? 'Safari' : 'trình duyệt'}</b>, rồi cài app.</p>
        </div>
        <button className="icon-btn" onClick={close} aria-label="Đóng"><Icon n="x" size={18} /></button>
      </aside>
    );
  }
  return (
    <aside className="install" aria-label="Cài app lên màn hình chính">
      <span className="install-ico"><Icon n="download" size={22} /></span>
      <div className="install-t">
        <b>Cài app lên màn hình chính</b>
        {evt ? <p>Mở nhanh như một ứng dụng, xem được cả khi mất mạng.</p>
          : ios ? <p>Trong Safari: bấm <span className="inl"><Icon n="share" size={15} /> Chia sẻ</span> rồi chọn <b>Thêm vào MH chính</b>.</p>
          : <p>Bấm menu <b>⋮</b> của trình duyệt rồi chọn <b>Cài đặt ứng dụng</b>.</p>}
        {evt && <button className="btn-install" onClick={() => void install()}>Cài đặt</button>}
      </div>
      <button className="icon-btn" onClick={close} aria-label="Đóng"><Icon n="x" size={18} /></button>
    </aside>
  );
}
