import { useState } from 'react';
import type { BytRow } from '../../../security/src/index.js';
import { UNITS } from './data/catalog.js';
import { UnitSelect } from './UnitSelect.js';
import { when } from './byt.js';
import { tuoi, type HanhChinh } from './model.js';
import { session } from './session.js';
import { sachTenAll } from './ten.js';
import { log, run } from './ui.js';

interface Row { rec: BytRow; data: HanhChinh | null }
interface Section { type: string; khoa: string; data: unknown | null; ok: boolean; at: string }
type Stats = Awaited<ReturnType<NonNullable<typeof session.client>['bytStats']>>;

const TEN: Record<string, string> = { hanhchinh: 'Hành chính', lankham: 'Lần khám', tiensu: 'Tiền sử', thecuc: 'Thể lực', lamsang: 'Lâm sàng', canlamsang: 'Cận lâm sàng', ketluan: 'Kết luận' };

/**
 * Màn hình của CÁN BỘ BỘ Y TẾ (thuộc tính Org:SoYTe): xem những gì cổng đã nhận. Cổng chỉ giữ ciphertext; việc giải mã diễn ra ngay trên máy này bằng khoá
 * ABE mà ≥ 2/3 nút cấp. Thiết bị không có thuộc tính phù hợp vẫn tải được ciphertext nhưng không mở được (hiện 🔒).
 */
export function ByTPage({ unit, setUnit }: { unit: string; setUnit: (u: string) => void }) {
  const c = session.client!;
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [prog, setProg] = useState('');
  const [sel, setSel] = useState<Row | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [err, setErr] = useState('');

  const load = () => run('Tải từ cổng Bộ Y tế và giải mã trên máy này', async () => {
    setErr(''); setSel(null); setSections([]);
    try {
      setStats(await c.bytStats());
      const recs = await c.bytRecords({ group: unit, type: 'hanhchinh' });
      const res = sachTenAll(await c.openMany(recs, (d, t) => setProg(`${d}/${t}`)));
      setRows(recs.map((rec, i) => ({ rec, data: (res[i]?.data as HanhChinh) ?? null })));
      log(`Cổng Bộ Y tế: ${recs.length} hồ sơ của đơn vị, đọc được ${res.filter(Boolean).length}.`, 'ok');
    } catch (e) { setErr((e as Error).message); throw e; }
    finally { setProg(''); }
  });

  const open = (r: Row) => run('Mở đầy đủ phiếu khám từ cổng', async () => {
    setSel(r);
    if (!r.data) { setSections([]); return; }
    const recs = await c.bytRecords({ patientCode: r.data.cccd });
    const res = sachTenAll(await c.openMany(recs));
    setSections(recs.map((rec, i) => ({ type: rec.type, khoa: rec.khoa, data: res[i]?.data ?? null, ok: !!res[i]?.signatureValid, at: rec.createdAt })));
  });

  return (
    <div className="listpage">
      <h2 className="ltitle">CỔNG BỘ Y TẾ (MÔ PHỎNG)</h2>
      <div className="lfilters">
        <div className="improw"><label>Công ty:</label><UnitSelect value={unit} onChange={setUnit} />
          <button className="mini2" disabled={!!prog} onClick={() => void load()}>⟳ Tải từ cổng {prog && `(${prog})`}</button></div>
      </div>
      {err && <div className="warnbar" role="alert">Lỗi cổng: {err}</div>}
      {stats && (
        <table className="grid small" style={{ margin: '0 8px 8px', width: 'auto' }}>
          <thead><tr><th>Mã cơ sở</th><th>Tên cơ sở</th><th>Số bệnh nhân</th><th>Số bản ghi mã hoá</th><th>Theo loại mục</th></tr></thead>
          <tbody>{stats.facilities.map((f) => <tr key={f.ma}><td>{f.ma}</td><td>{f.ten}</td><td>{f.patients}</td><td>{f.records}</td><td>{Object.entries(f.types).map(([t, n]) => `${TEN[t] ?? t}: ${n}`).join(' · ')}</td></tr>)}</tbody>
        </table>
      )}
      <div className="tablewrap lgrid">
        <table className="grid">
          <thead><tr><th>ho_ten</th><th>lop</th><th>ngay_sinh</th><th>so_cccd</th><th>ma_bien_nhan</th><th>ma_cskcb</th><th>nhan_luc</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.rec.id} className={sel?.rec.id === r.rec.id ? 'sel' : ''} onClick={() => void open(r)}>
                {r.data ? <><td>{r.data.hoTen}</td><td>{r.data.lop}</td><td>{r.data.ngaySinh} ({tuoi(r.data.ngaySinh)})</td><td>{r.data.cccd}</td></>
                  : <td colSpan={4} className="lock">🔒 mã hoá - thiết bị này không đủ thuộc tính để đọc</td>}
                <td>{r.rec.receipt?.receiptId ?? '(biên nhận không hợp lệ)'}</td><td>{r.rec.receipt?.maCskcb}</td><td>{r.rec.receipt ? when(r.rec.receipt.receivedAt) : ''}</td>
              </tr>
            ))}
            {!rows && <tr><td colSpan={7} className="muted">Bấm "Tải từ cổng" để xem các hồ sơ cơ sở đã liên thông (đơn vị đang chọn: {UNITS.find((u) => u.ma === unit)?.ten ?? unit}).</td></tr>}
            {rows && !rows.length && <tr><td colSpan={7} className="muted">Cổng chưa nhận hồ sơ nào của đơn vị này. Cơ sở khám cần bấm "Gửi liên thông" ở Quản lý hồ sơ.</td></tr>}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="lpanels">
          <div className="lpanel" style={{ flex: 1 }}>
            <h3>PHIẾU KHÁM ĐẦY ĐỦ (giải mã trên máy này) {sel.data ? '· ' + sel.data.hoTen : ''}</h3>
            <div className="tablewrap">
              <table className="grid small"><thead><tr><th style={{ width: 120 }}>Mục</th><th>Nội dung</th><th style={{ width: 110 }}>Chữ ký số</th></tr></thead>
                <tbody>
                  {sections.map((s, i) => (
                    <tr key={i}><td>{TEN[s.type] ?? s.type}{s.type === 'lamsang' ? ' · ' + s.khoa : ''}</td>
                      <td style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>{s.data ? JSON.stringify(s.data) : '🔒 không đủ thuộc tính để đọc mục này'}</td>
                      <td>{s.data ? (s.ok ? '✔ hợp lệ' : '✘ không hợp lệ') : ''}</td></tr>
                  ))}
                  {!sections.length && <tr><td colSpan={3} className="muted">{sel.data ? 'Đang tải…' : 'Không đọc được hồ sơ này.'}</td></tr>}
                </tbody></table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
