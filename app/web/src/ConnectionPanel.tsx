import { useEffect, useRef, useState } from 'react';
import { defaultStorageBase, session } from './session.js';
import { allowedServer, discoverServers } from './network.js';

/** Kiểm tra LAN liên tục; không để màn hình nghiệp vụ giữ plaintext sau khi mất kết nối. */
export function ConnectionPanel({ onConnected }: { onConnected: () => void }) {
  const [address, setAddress] = useState(session.client!.s.storageBase);
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const connected = useRef(onConnected); connected.current = onConnected;

  const establish = async (base: string) => {
    if (!(await allowedServer(base))) throw new Error('Máy chủ không thuộc mạng nội bộ hiện tại.');
    await session.reconnect(base);
    if (!alive.current) return;
    setAddress(session.client!.s.storageBase); setStatus('ready'); setMessage(''); setEditing(false);
    connected.current();
  };
  const recover = async (preferred?: string) => {
    if (busy.current) return;
    busy.current = true; setStatus('checking');
    try {
      const known = preferred ?? session.client?.s.storageBase;
      if (known) { try { await establish(known); return; } catch { session.suspendNetwork(); } }
      const candidates = await discoverServers();
      for (const server of candidates) {
        try { await establish(server.url); return; } catch { session.suspendNetwork(); }
      }
      throw new Error('Không tìm thấy máy chủ KSK đã đăng ký trên mạng nội bộ. Hãy bật KSK Admin và kết nối hai máy vào cùng Wi-Fi/LAN.');
    } catch (e) {
      session.suspendNetwork();
      if (alive.current) { setMessage((e as Error).message); setStatus('error'); }
    } finally { busy.current = false; }
  };
  useEffect(() => {
    alive.current = true;
    void defaultStorageBase().then((base) => recover(base));
    const timer = setInterval(() => {
      if (busy.current) return;
      if (!session.connectionReady) { void recover(); return; }
      busy.current = true;
      void (async () => {
        try {
          if (!(await allowedServer(session.client!.s.storageBase))) throw new Error('Đã rời mạng của máy chủ.');
          await session.checkConnection();
        } catch (e) {
          session.suspendNetwork();
          if (alive.current) { setStatus('error'); setMessage((e as Error).message); }
        } finally { busy.current = false; }
      })();
    }, 3000);
    return () => { alive.current = false; clearInterval(timer); session.suspendNetwork(); };
  }, []);
  return <div className="connectionbar" role="status">
    <span>{status === 'ready' ? '● Đã kết nối: ' + session.client!.s.storageBase : status === 'checking' ? 'Đang tìm máy chủ KSK trong Wi-Fi/LAN…' : message}</span>
    <button onClick={() => setEditing(!editing)}>Đổi máy chủ</button>
    <button disabled={status === 'checking'} onClick={() => void recover()}>Tìm máy chủ trong mạng</button>
    {(editing || status === 'error') && <div className="row">
      <input aria-label="Địa chỉ máy chủ" placeholder="http://IP-máy-quản-trị:8090" value={address} onChange={(e) => setAddress(e.target.value)} />
      <button disabled={status === 'checking' || !address.trim()} onClick={() => void recover(address)}>Kết nối và tải lại</button>
      <small>Không cần Internet. Mạng Wi-Fi phải cho phép hai máy liên lạc; máy chủ và thiết bị vẫn cần đúng quyền đăng ký.</small>
    </div>}
  </div>;
}
