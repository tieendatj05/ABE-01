import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OpenResult, RecordRow } from '../../../security/src/index.js';
import { UnitSelect } from './UnitSelect.js';
import { fetchReceipts, receiptText, submitPatients, type ReceiptMap } from './byt.js';
import { canWrite, checkMau, tuoi, validateDetailed, type HanhChinh, type Mau } from './model.js';
import { session } from './session.js';
import { log, run } from './ui.js';

interface Row { rec: RecordRow; res: OpenResult | null; data: HanhChinh | null }
type Filter = 'all' | 'da' | 'chua' | 'loi';
type Tab = 'data' | 'header' | 'sig' | 'raw';

const KV = ({ rows }: { rows: [string, string][] }) => (
  <table className="grid small"><thead><tr><th style={{ width: 170 }}>Field</th><th>Value</th></tr></thead>
    <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>{v}</td></tr>)}</tbody></table>
);

/** Danh sách hồ sơ của đơn vị + hai khung chi tiết: bản đã giải mã TRÊN MÁY NÀY và những gì MÁY CHỦ thấy (ciphertext). */
export function ListPage({ unit, setUnit }: { unit: string; setUnit: (u: string) => void }) {
  const c = session.client!;
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [prog, setProg] = useState<{ d: number; t: number } | null>(null);
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState<Filter>('all');
  const [mau, setMau] = useState<Mau | 'all'>('all');
  const [sel, setSel] = useState<Row | null>(null);
  const [tabL, setTabL] = useState<Tab>('data');
  const [tabR, setTabR] = useState<Tab>('data');
  const [policy, setPolicy] = useState('');
  const [rcpt, setRcpt] = useState<ReceiptMap>(new Map());    // biên nhận của cổng Bộ Y tế theo id bản ghi
  const [bytErr, setBytErr] = useState('');
  const isLt = (r: Row) => rcpt.has(r.rec.id);

  const load = useCallback(async () => {
    setLoadError('');
    try {
    setRows([]); setSel(null);
    const all = await c.listGroup(unit);
    const latest = new Map<string, RecordRow>();
    for (const r of all) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
    const recs = [...latest.values()];
    setProg({ d: 0, t: recs.length });
    const res = await c.openMany(recs, (d, t) => setProg({ d, t }));
    setRows(recs.map((rec, i) => ({ rec, res: res[i], data: (res[i]?.data as HanhChinh) ?? null })));
    const st = await fetchReceipts(c, recs.map((r) => r.id));
    setRcpt(st.map); setBytErr(st.error);
    } catch (e) { setLoadError((e as Error).message); throw e; }
    finally { setProg(null); }
  }, [c, unit]);
  useEffect(() => { void run('Tải danh sách hồ sơ', load); }, [unit]);

  const bad = (r: Row) => !!r.data && validateDetailed(r.data).length > 0;
  const stats = useMemo(() => ({
    saved: rows.length,
    readable: rows.filter((r) => r.data).length,
    denied: rows.filter((r) => !r.data).length,
    da: rows.filter((r) => r.data && rcpt.has(r.rec.id)).length,
    chua: rows.filter((r) => r.data && !rcpt.has(r.rec.id)).length,
    loi: rows.filter(bad).length,
  }), [rows, rcpt]);
  const shown = rows.filter((r) => {
    if (flt === 'da' && !(r.data && isLt(r))) return false;
    if (flt === 'chua' && !(r.data && !isLt(r))) return false;
    if (flt === 'loi' && !bad(r)) return false;
    if (mau !== 'all' && r.data && checkMau(r.data, mau)) return false;
    const s = q.trim().toLowerCase();
    return !s || [r.data?.hoTen, r.data?.cccd, r.data?.dienThoai, r.data?.lop].some((v) => v?.toLowerCase().includes(s));
  });

  const choose = async (r: Row) => { setSel(r); setPolicy(await c.policyOf(r.rec, true).catch(() => '')); };

  /**
   * Liên thông: gửi phiếu khám (mọi mục, bản mới nhất) của các dòng đang lọc lên cổng Bộ Y tế (mô phỏng). Nội dung gửi là bản ĐÃ MÃ HOÁ; cổng trả
   * biên nhận có chữ ký cho từng bản ghi. Hồ sơ nào sửa sau lần gửi sẽ tự quay về "Chưa liên thông" cho đến khi gửi lại.
   */
  const send = () => run('Liên thông Bộ Y tế', async () => {
    const todo = shown.filter((r) => r.data && !isLt(r) && !bad(r));
    if (!todo.length) { log('Không có hồ sơ hợp lệ nào cần gửi (hoặc đã liên thông hết).', 'warn'); return; }
    setProg({ d: 0, t: todo.length });
    const out = await submitPatients(c, unit, new Set(todo.map((r) => r.rec.patientIdx)), (d, t) => setProg({ d, t }));
    const rej = out.rejected ? ` Cổng từ chối ${out.rejected} bản ghi (${out.firstError}).` : '';
    log(`Đã gửi ${out.sent} bản ghi mã hoá của ${todo.length} hồ sơ lên cổng Bộ Y tế (cơ sở ${out.ma}), nhận ${out.receipts.size} biên nhận có chữ ký.${rej}`, out.rejected ? 'warn' : 'ok');
    await load();
  });

  /**
   * Phụ huynh tra cứu bằng CCCD + ngày sinh của học sinh (không cần mã). Hồ sơ lưu trước khi đổi cách tra cứu (hoặc vừa sửa ngày sinh) cần bọc lại
   * khoá cho phụ huynh: máy này mở khoá bằng ABE rồi bọc thêm, dữ liệu mã hoá giữ nguyên. Hồ sơ đã liên thông được gửi lại để cổng Bộ Y tế cũng cập nhật.
   */
  const refreshParent = () => run('Cập nhật tra cứu của phụ huynh', async () => {
    setProg({ d: 0, t: 1 });
    const out = await c.refreshParentAccess(unit, (d, t) => setProg({ d, t }));
    const lt = new Set(rows.filter((r) => out.patients.has(r.rec.patientIdx) && isLt(r)).map((r) => r.rec.patientIdx));
    if (lt.size) { setProg({ d: 0, t: lt.size }); await submitPatients(c, unit, lt, (d, t) => setProg({ d, t })); }
    log(`Đã cập nhật đường tra cứu (CCCD + ngày sinh) cho ${out.updated} bản ghi của ${out.patients.size} học sinh${lt.size ? `, gửi lại ${lt.size} hồ sơ lên cổng Bộ Y tế` : ''}.${out.noDob ? ` Bỏ qua ${out.noDob} bản ghi vì hồ sơ chưa có ngày sinh hợp lệ.` : ''}`, 'ok');
    await load();
  });

  const left = sel?.res;
  const d = sel?.data;
  const leftRows: Record<Tab, [string, string][]> = {
    data: d ? [['Họ tên', d.hoTen], ['Lớp', d.lop ?? ''], ['Giới tính', d.gioiTinh === 'nam' ? 'Nam' : 'Nữ'], ['Ngày sinh', `${d.ngaySinh} (${tuoi(d.ngaySinh)} tuổi)`], ['Số CCCD', d.cccd], ['Phụ huynh tra cứu bằng', 'Số CCCD + ngày sinh của học sinh'], ['Ngày cấp / Nơi cấp', `${d.ngayCap} / ${d.noiCap}`], ['Dân tộc', d.danToc], ['Điện thoại', d.dienThoai], ['Địa chỉ', [d.diaChi, d.phuongXa, d.tinh].filter(Boolean).join(', ')], ['Người giám hộ', `${d.giamHo.hoTen} (${d.giamHo.cccd})`], ['Liên thông Bộ Y tế', receiptText(rcpt.get(sel!.rec.id))]] : [],
    header: left ? [['Người lập', left.author.name], ['Thiết bị tạo', left.author.deviceId], ['Đã bọc lại khoá phiên này', left.rewrapped ? 'Có' : 'Không']] : [],
    sig: left ? [['Biên nhận Bộ Y tế (Ed25519)', rcpt.get(sel!.rec.id) ? '✔ chữ ký cổng hợp lệ, băm ' + rcpt.get(sel!.rec.id)!.contentHash.slice(0, 16) + '…' : 'chưa có'], ['Chữ ký số (ECDSA P-256)', left.signatureValid ? '✔ hợp lệ' : '✘ KHÔNG hợp lệ'], ['Chứng chỉ thiết bị', 'ký Ed25519 bởi registry (đã kiểm tra)'], ['Thiết bị ký', left.author.deviceId]] : [],
    raw: d ? [['JSON', JSON.stringify(d)]] : [],
  };
  const rec = sel?.rec;
  const rightRows: Record<Tab, [string, string][]> = {
    data: rec ? [['id', rec.id], ['loại mục', rec.type], ['khoa', rec.khoa], ['thời điểm', rec.createdAt], ['thiết bị tạo', rec.authorDevice], ['chỉ mục bệnh nhân (HMAC)', rec.patientIdx], ['chỉ mục đơn vị (HMAC)', rec.groupIdx ?? ''], ['kích thước ciphertext', `${(rec.envelope.ciphertext.length / 2).toLocaleString()} byte`]] : [],
    header: rec ? [['phiên bản phong bì', String(rec.envelope.v)], ['header khoá chung', rec.envelope.v === 3 ? rec.envelope.headerId : '(riêng cho bản ghi)'], ['chính sách truy cập (công khai)', policy.replace(/#\d{4}W\d{2}\.\d+/g, '').replace(/MED:/g, '')]] : [],
    sig: rec ? [['chữ ký số', 'nằm BÊN TRONG ciphertext - máy chủ không thấy, không sửa được']] : [],
    raw: rec ? [['phong bì (cắt ngắn)', JSON.stringify(rec.envelope).slice(0, 700) + '…']] : [],
  };
  const tabs = (cur: Tab, set: (t: Tab) => void) => (
    <div className="tabsrow small">{([['data', 'Data'], ['header', 'Header'], ['sig', 'Signature'], ['raw', 'Raw JSON']] as [Tab, string][]).map(([k, l]) => <a key={k} href="#" className={cur === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); set(k); }}>{l}</a>)}</div>
  );

  return (
    <div className="listpage">
      <h2 className="ltitle">DANH SÁCH HỒ SƠ [{stats.saved}]</h2>
      <div className="lfilters">
        <div>
          <div className="improw"><label>Công ty:</label>
            <UnitSelect value={unit} onChange={setUnit} />
            <label>Tìm kiếm:</label><input className="qsearch" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="improw opts">
            {([['all', 'Tất cả'], ['da', 'Đã gửi'], ['chua', 'Chưa gửi'], ['loi', 'Lỗi']] as [Filter, string][]).map(([k, l]) => <label key={k} className="radio"><input type="radio" name="flt" checked={flt === k} onChange={() => setFlt(k)} /> {l}</label>)}
            <span className="gap" />
            {([['18', 'Mẫu 18'], ['6-18', 'Mẫu 6 đến 18'], ['duoi6', 'Mẫu dưới 6'], ['all', 'Mọi mẫu']] as [Mau | 'all', string][]).map(([k, l]) => <label key={k} className="radio"><input type="radio" name="mau" checked={mau === k} onChange={() => setMau(k)} /> {l}</label>)}
          </div>
        </div>
        <div className="lstats">
          <div>▮ <b>TỔNG đã lưu (mã hoá):</b> {stats.saved} | <b>đọc được trên máy này:</b> {stats.readable}{stats.denied > 0 && <> | <b className="bad">không đủ quyền: {stats.denied}</b></>}</div>
          <div>▮ <b>Cổng Bộ Y tế (mô phỏng)</b> → <span className="ok">✔ Đã gửi: {stats.da}</span> | ⏳ Chưa gửi: {stats.chua} | <span className="bad">✕ Lỗi dữ liệu: {stats.loi}</span></div>
          <div><button className="mini2" disabled={!canWrite('hanhchinh', c.s.attrs) || !!prog} onClick={() => void send()}>Gửi liên thông các dòng đang lọc</button> <button className="mini2" onClick={() => void run('Tải lại', load)}>⟳ Tải lại</button> <button className="mini2" disabled={!rows.some((r) => r.data) || !!prog} onClick={() => void refreshParent()} title="Phụ huynh tra cứu bằng số CCCD + ngày sinh của học sinh. Bấm để cập nhật cho hồ sơ lưu từ trước hoặc vừa sửa ngày sinh.">Cập nhật tra cứu phụ huynh</button></div>
        </div>
      </div>
      {loadError && <div className="warnbar" role="alert">Không tải được hồ sơ: {loadError}</div>}
      {bytErr && <div className="warnbar" role="alert">Cổng liên thông Bộ Y tế chưa kết nối: {bytErr}. Trạng thái liên thông chưa xác định và nút gửi sẽ báo lỗi.</div>}
      {prog && <div className="progress"><div style={{ width: `${(prog.d / Math.max(1, prog.t)) * 100}%` }} /><span>Đang giải mã {prog.d}/{prog.t} hồ sơ trên máy này…</span></div>}
      <div className="tablewrap lgrid">
        <table className="grid">
          <thead><tr><th>id</th><th>lop</th><th>ngay_vao</th><th>ho_ten</th><th>gioi_tinh</th><th>ngay_sinh</th><th>ma_dan_toc</th><th>dien_thoai</th><th>so_cccd</th><th>ngaycap_cccd</th><th>noicap_cccd</th><th>nguoi_giam_ho</th><th>lien_thong</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.rec.id} className={sel?.rec.id === r.rec.id ? 'sel' : bad(r) ? 'err' : ''} onClick={() => void choose(r)}>
                <td>{r.rec.id.slice(0, 6)}</td><td>{r.data?.lop}</td><td>{new Date(r.rec.createdAt).toLocaleDateString('vi-VN')}</td>
                {r.data ? <><td>{r.data.hoTen}</td><td>{r.data.gioiTinh === 'nam' ? 1 : 2}</td><td>{r.data.ngaySinh}</td><td>{r.data.danToc}</td><td>{r.data.dienThoai}</td><td>{r.data.cccd}</td><td>{r.data.ngayCap}</td><td>{r.data.noiCap}</td><td>{r.data.giamHo.hoTen}</td><td>{isLt(r) ? 'Đã gửi' : 'Chưa gửi'}</td></>
                  : <td colSpan={10} className="lock">🔒 mã hoá - không đủ quyền đọc</td>}
              </tr>
            ))}
            {!shown.length && !prog && <tr><td colSpan={13} className="muted">{loadError ? 'Danh sách chưa tải được. Kiểm tra kết nối rồi bấm Tải lại.' : 'Chưa có hồ sơ phù hợp. Kiểm tra Công ty và các bộ lọc.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="lpanels">
        <div className="lpanel"><h3>DỮ LIỆU ĐÃ GIẢI MÃ (trên máy này)</h3>{tabs(tabL, setTabL)}<div className="tablewrap"><KV rows={leftRows[tabL]} /></div></div>
        <div className="lpanel"><h3>MÁY CHỦ THẤY GÌ (ciphertext)</h3>{tabs(tabR, setTabR)}<div className="tablewrap"><KV rows={rightRows[tabR]} /></div></div>
      </div>
    </div>
  );
}
