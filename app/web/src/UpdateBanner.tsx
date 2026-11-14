import { useEffect, useState } from 'react';
import { bridge, cleanIpcError } from './bridge.js';

declare const __EDITION__: string;
const CHECK_MS = 5 * 60_000; // không cần gấp: kiểm tra mỗi 5 phút là đủ

/**
 * Báo có bản cập nhật mới (so hash app.asar đang chạy với bản máy chủ đang giữ) và cho áp dụng ngay: tải app.asar mới,
 * tự khởi động lại - không cần gỡ/cài lại, không cần tải file thủ công. Chỉ chạy trong app desktop (có bridge.update).
 */
export function UpdateBanner({ storageBase }: { storageBase: string }) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!bridge) return;
    let stop = false;
    const check = async () => {
      try {
        const [local, res] = await Promise.all([
          bridge!.update.localHash(),
          fetch(`${storageBase.replace(/\/+$/, '')}/api/app/version?edition=${__EDITION__}`, { signal: AbortSignal.timeout(4000) }),
        ]);
        if (stop || !local || !res.ok) return;
        const info = (await res.json()) as { hash: string };
        if (!stop && info.hash !== local) setAvailable(true);
      } catch { /* máy chủ chưa bật tính năng này hoặc đang mất kết nối: im lặng, thử lại ở chu kỳ sau */ }
    };
    void check();
    const t = setInterval(() => void check(), CHECK_MS);
    return () => { stop = true; clearInterval(t); };
  }, [storageBase]);

  if (!bridge || !available) return null;
  const apply = async () => {
    setBusy(true); setErr('');
    try { await bridge!.update.apply(storageBase); /* app tự khởi động lại sau khi áp dụng xong */ }
    catch (e) { setErr(cleanIpcError((e as Error).message)); setBusy(false); }
  };
  return (
    <div className="okbar" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 16px 6px' }}>
      <span>🔄 Có bản cập nhật mới.</span>
      <button className="mini2" disabled={busy} onClick={() => void apply()}>{busy ? 'Đang cập nhật…' : 'Cập nhật ngay'}</button>
      {err && <span className="bad">{err}</span>}
    </div>
  );
}
