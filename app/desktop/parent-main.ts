// Ứng dụng PHỤ HUYNH trên máy tính (Windows): một cửa sổ kích thước điện thoại chỉ để tra cứu kết quả khám bằng số CCCD.
// Không có khoá thiết bị, không có phần quản trị, không Node trong giao diện. Địa chỉ máy chủ đặt trong biểu tượng bánh răng của màn hình đầu.
import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 460, height: 900, minWidth: 360, minHeight: 600, title: 'Tra cứu khám sức khỏe', backgroundColor: '#dfe5ec', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false, spellcheck: false },
  });
  // Chặn chụp/ghi màn hình: TẮT theo mặc định (đang demo/báo lỗi bằng ảnh chụp). Bật lại: đặt MEDABE_BLOCK_CAPTURE=1.
  if (process.env.MEDABE_BLOCK_CAPTURE) win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  void win.loadFile(join(__dirname, '..', '..', 'parent', 'dist', 'index.html'));
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
