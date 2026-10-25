import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { addUnit, subscribeUnits, unitsSnapshot, UNITS } from './data/catalog.js';

/** Chọn trường/công ty, kèm nút thêm trường mới (lưu trên máy này; nhập cùng tên trên máy khác sẽ ra cùng mã đơn vị). */
export function UnitSelect({ value, onChange, style }: { value: string; onChange: (ma: string) => void; style?: CSSProperties }) {
  useSyncExternalStore(subscribeUnits, unitsSnapshot);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const add = () => {
    try { onChange(addUnit(name).ma); setName(''); setErr(''); setAdding(false); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
        {UNITS.map((u) => <option key={u.ma} value={u.ma}>{u.ten}</option>)}
      </select>
      <button type="button" className="mini2" title="Thêm trường / công ty mới" onClick={() => { setAdding(!adding); setErr(''); }}>＋ Thêm trường</button>
      {adding && (
        <>
          <input autoFocus placeholder="Tên trường/công ty, ví dụ TRƯỜNG THCS LÊ LỢI" value={name} style={{ minWidth: 260 }}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} />
          <button type="button" className="mini2" disabled={!name.trim()} onClick={add}>Thêm</button>
          {err && <span className="bad">{err}</span>}
        </>
      )}
    </>
  );
}
