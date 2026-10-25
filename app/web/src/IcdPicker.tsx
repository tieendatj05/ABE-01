import { useState } from 'react';
import { loadIcd, searchIcd, type IcdEntry } from './data/catalog.js';

/** Tìm mã bệnh ICD-10 (hơn 12.000 mã) theo mã hoặc tên. Danh mục chỉ được nạp lần đầu khi người dùng bấm vào ô. */
export function IcdPicker({ off, onPick, placeholder }: { off?: boolean; onPick?: (e: IcdEntry) => void; placeholder?: string }) {
  const [all, setAll] = useState<IcdEntry[] | null>(null);
  const [q, setQ] = useState('');
  const res = all ? searchIcd(all, q, onPick ? 30 : 100) : [];
  return (
    <div className="picker">
      <input disabled={off} value={q} placeholder={placeholder ?? 'Gõ mã hoặc tên bệnh (vd J00, viêm phổi)…'}
        onFocus={() => { if (!all) void loadIcd().then(setAll); }} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && !all && <small>Đang nạp danh mục ICD-10…</small>}
      {q.trim().length >= 2 && all && !res.length && <small>Không có mã phù hợp.</small>}
      {res.length > 0 && (
        <ul className="pickres">
          {res.map(([ma, ten]) => (
            <li key={ma}>{onPick
              ? <a href="#" onClick={(e) => { e.preventDefault(); onPick([ma, ten]); setQ(''); }}>{ma} · {ten}</a>
              : <span>{ma} · {ten}</span>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
