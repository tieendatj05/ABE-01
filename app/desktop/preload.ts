// Cầu nối hẹp giữa giao diện (cô lập) và tiến trình chính: chỉ các hàm dưới đây, không lộ Node/ipcRenderer.
import { contextBridge, ipcRenderer } from 'electron';

declare const __EDITION__: string;
const call = (c: string, a?: unknown) => ipcRenderer.invoke(c, a);

contextBridge.exposeInMainWorld('medabe', {
  desktop: true,
  network: {
    allowed: (base: string) => call('network:allowed', base),
    discover: () => call('network:discover'),
    probe: (base: string) => call('network:probe', base),
  },
  hardware: () => call('hw:info'),
  loadDevice: () => call('device:load'),
  saveDevice: (d: unknown) => call('device:save', d),
  getVault: () => call('vault:get'),
  setVault: (v: string) => call('vault:set', v),
  wipe: () => call('vault:wipe'),
  autoPass: { get: () => call('autounlock:get'), set: (p: string) => call('autounlock:set', p), clear: () => call('autounlock:clear') },
  getSetting: (k: string) => call('setting:get', k),
  setSetting: (k: string, v: string) => call('setting:set', { k, v }),
  quit: () => call('app:quit'),
  update: {
    localHash: () => call('update:localHash'),
    apply: (storageBase: string) => call('update:apply', storageBase),
  },
  // Chỉ bản admin mới có cầu nối quản trị; bản user không có gì để gọi.
  ...(__EDITION__ === 'admin' ? {
    admin: {
      status: () => call('admin:status'),
      pending: () => call('admin:pending'),
      enroll: (pkg: string, password: string) => call('admin:enroll', { pkg, password }),
      unlock: (password: string) => call('admin:unlock', password),
      lock: () => call('admin:lock'),
      changePassword: (oldPw: string, newPw: string) => call('admin:changePassword', { oldPw, newPw }),
      reset: (password: string) => call('admin:reset', password),
      call: (target: string, method: 'GET' | 'POST', path: string, body?: unknown) => call('admin:call', { target, method, path, body }),
      netScan: () => call('net:scan'),
    },
  } : {}),
});
