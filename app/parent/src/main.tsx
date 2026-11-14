import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/be-vietnam-pro/latin-800.css';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-800.css';
import { createRoot } from 'react-dom/client';
import { App, applyTheme } from './App.js';
import './parent.css';

// Áp giao diện sáng/tối đã chọn TRƯỚC khi vẽ để không bị nháy màu.
try { applyTheme(localStorage.getItem('ksk.theme')); } catch { applyTheme(null); }

createRoot(document.getElementById('root')!).render(<App />);

// App cài được (PWA): chỉ đăng ký service worker khi trang chạy trên HTTPS (hoặc localhost) — nơi trình duyệt cho phép.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => undefined); });
}
