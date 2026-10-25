import { useMemo, useRef, useState } from 'react';
import readXlsx from 'read-excel-file/universal';
import type { RecordType } from '../../../security/src/index.js';
import { UnitSelect } from './UnitSelect.js';
import { mapHeader, mapResultHeader, rowsToHanhChinh, rowsToResults, type Row } from './excel.js';
import { canWrite, checkMau, tuoi, validateDetailed, type FieldError, type HanhChinh, type Mau } from './model.js';
import { session } from './session.js';
import { log, run } from './ui.js';

type Mode = 'moi' | 'capnhat' | 'xetnghiem';
interface ErrRow { row: number; hoTen: string; col: string; value: string; msg: string }

/** Import dữ liệu từ Excel theo 3 bước: B1 chọn file, B2 kiểm tra thông tin, B3 import (mã hoá từng hồ sơ trên máy này rồi mới lưu). */
export function ImportPage({ unit, setUnit }: { unit: string; setUnit: (u: string) => void }) {
  const c = session.client!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<{ sheet: string; data: Row[] }[]>([]);
  const [mau, setMau] = useState<Mau>('6-18');
  const [mode, setMode] = useState<Mode>('moi');
  const [overall, setOverall] = useState(true);
  const [checked, setChecked] = useState(false);
  const [prog, setProg] = useState<{ d: number; t: number; what: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [selErr, setSelErr] = useState<ErrRow | null>(null);
  const nguon = 'Nhà trường / Doanh nghiệp'; // file không có cột Nguồn chi trả

  // chọn sheet phù hợp với chế độ
  const sheet = useMemo(() => {
    if (mode === 'xetnghiem') return sheets.find((s) => mapResultHeader(s.data) && rowsToResults(s.data, mapResultHeader(s.data)!).length) ?? sheets.find((s) => mapResultHeader(s.data));
    return sheets.find((s) => mapHeader(s.data) && rowsToHanhChinh(s.data, mapHeader(s.data)!, { nguonChiTra: nguon }).length) ?? sheets.find((s) => mapHeader(s.data));
  }, [sheets, mode]);
  const mapped = useMemo(() => (sheet && mode !== 'xetnghiem' ? mapHeader(sheet.data) : null), [sheet, mode]);
  const items = useMemo(() => (mapped && sheet ? rowsToHanhChinh(sheet.data, mapped, { nguonChiTra: nguon }) : []), [mapped, sheet]);
  const rmap = useMemo(() => (sheet && mode === 'xetnghiem' ? mapResultHeader(sheet.data) : null), [sheet, mode]);
  const results = useMemo(() => (rmap && sheet ? rowsToResults(sheet.data, rmap) : []), [rmap, sheet]);
  const total = mode === 'xetnghiem' ? results.length : items.length;

  const errors = useMemo<ErrRow[]>(() => {
    if (!checked || mode === 'xetnghiem') return [];
    const out: ErrRow[] = [];
    const seen = new Map<string, number>();
    for (const it of items) {
      const errs: FieldError[] = validateDetailed(it.data);
      if (overall) {
        const m = checkMau(it.data, mau);
        if (m) errs.push(m);
        const dup = seen.get(it.data.cccd);
        if (dup) errs.push({ col: 'Số CCCD', value: it.data.cccd, msg: `Trùng với dòng ${dup}` }); else if (it.data.cccd) seen.set(it.data.cccd, it.row);
      }
      for (const e of errs) out.push({ row: it.row, hoTen: it.data.hoTen, ...e });
    }
    return out;
  }, [checked, items, mau, overall, mode]);
  const badRows = new Set(errors.map((e) => e.row));
  const okItems = items.filter((it) => !badRows.has(it.row));

  const pick = (f: File) => run('Đọc file Excel', async () => {
    const all = (await readXlsx(await f.arrayBuffer())) as { sheet: string; data: Row[] }[];
    setSheets(all); setFileName(f.name); setChecked(false); setMsg(''); setSelErr(null);
    log(`Đã đọc ${f.name}: ${all.length} sheet.`, 'ok');
  });

  /** CCCD đã có trong đơn vị (giải mã trên máy này: máy chủ không biết). */
  const existingSet = async () => {
    setProg({ d: 0, t: 1, what: 'Đối chiếu với hồ sơ đã có trong đơn vị (giải mã trên máy này)…' });
    const opened = await c.openMany(await c.listGroup(unit));
    return new Set(opened.map((o) => (o?.data as HanhChinh | undefined)?.cccd).filter(Boolean) as string[]);
  };

  const doImport = () => run('Import: mã hoá từng hồ sơ trên máy này rồi lưu', async () => {
    const t0 = performance.now();
    try {
    if (mode === 'xetnghiem') {
      const have = await existingSet();
      const rows = results.filter((r) => r.cccd && have.has(r.cccd));
      const inputs: { patientCode: string; type: RecordType; khoa: string; data: unknown; group: string }[] = [];
      const skipped: string[] = [];
      for (const r of rows) {
        if (r.thecuc) { if (canWrite('thecuc', c.s.attrs)) inputs.push({ patientCode: r.cccd, type: 'thecuc', khoa: 'KSK', data: r.thecuc, group: unit }); else skipped.push('thể lực'); }
        for (const [khoa, d] of Object.entries(r.lamsang)) { if (canWrite('lamsang', c.s.attrs, khoa)) inputs.push({ patientCode: r.cccd, type: 'lamsang', khoa, data: d, group: unit }); else skipped.push('lâm sàng ' + khoa); }
        if (r.ketluan) { if (canWrite('ketluan', c.s.attrs)) inputs.push({ patientCode: r.cccd, type: 'ketluan', khoa: 'KSK', data: r.ketluan, group: unit }); else skipped.push('kết luận'); }
      }
      if (!inputs.length) { setMsg('Không có mục nào để lưu (không có hồ sơ khớp hoặc thiếu quyền ghi).'); setProg(null); return; }
      setProg({ d: 0, t: inputs.length, what: 'Đang mã hoá và lưu kết quả khám…' });
      await c.saveMany(inputs, (d, t) => setProg({ d, t, what: 'Đang mã hoá và lưu kết quả khám…' }));
      const note = skipped.length ? ` Bỏ qua mục không có quyền ghi: ${[...new Set(skipped)].join(', ')}.` : '';
      setMsg(`Đã lưu ${inputs.length} mục kết quả khám cho ${rows.length} hồ sơ (${Math.round(performance.now() - t0)} ms).${note} Không có nhánh phá-vỡ-kính theo bệnh nhân cho dữ liệu nhập lô.`);
    } else {
      let todo = okItems;
      const have = await existingSet();
      const before = todo.length;
      todo = mode === 'moi' ? todo.filter((it) => !have.has(it.data.cccd)) : todo.filter((it) => have.has(it.data.cccd));
      if (!todo.length) { setMsg(mode === 'moi' ? 'Không có hồ sơ mới (tất cả CCCD đã có trong đơn vị).' : 'Không có hồ sơ nào khớp để cập nhật.'); setProg(null); return; }
      setProg({ d: 0, t: todo.length, what: 'Đang mã hoá và lưu…' });
      await c.saveMany(todo.map((it) => ({ patientCode: it.data.cccd, type: 'hanhchinh' as const, khoa: 'KSK', data: it.data, group: unit })), (d, t) => setProg({ d, t, what: 'Đang mã hoá và lưu…' }));
      setMsg(`${mode === 'moi' ? 'Đã thêm mới' : 'Đã cập nhật'} ${todo.length} hồ sơ${before !== todo.length ? ` (bỏ qua ${before - todo.length} dòng ${mode === 'moi' ? 'đã có trong đơn vị' : 'chưa có trong đơn vị'})` : ''} trong ${Math.round(performance.now() - t0)} ms. Chỉ 1 phép ABE cho cả lô.`);
    }
    session.schedulePersist();
    setProg(null);
    } catch (e) { setMsg('Không import được: ' + (e as Error).message); throw e; }
    finally { setProg(null); }
    log('Import xong - sang "Khám sức khỏe định kỳ" và bấm "Tải lại danh sách đã lưu" để xem.', 'ok');
  });

  const can = canWrite('hanhchinh', c.s.attrs) || mode === 'xetnghiem';
  const radio = (name: string, label: string, on: boolean, set: () => void) => (
    <label className="radio"><input type="radio" name={name} checked={on} onChange={set} /> {label}</label>
  );

  return (
    <div className="importpage">
      <div className="imptop">
        <div className="improw">
          <label>Đường dẫn:</label>
          <input readOnly value={fileName} placeholder="Chọn file Excel (.xlsx)…" onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
        </div>
        <div className="improw">
          <label>Tên công ty:</label>
          <UnitSelect value={unit} onChange={setUnit} />
        </div>
        <div className="impbtns">
          <button className="big" onClick={() => fileRef.current?.click()}>📂 B1. Chọn file</button>
          <button className="big" disabled={!sheets.length} onClick={() => { setChecked(true); setSelErr(null); log(`Đã kiểm tra ${total} dòng.`, 'ok'); }}>B2. Kiểm tra thông tin</button>
          <button className="big" disabled={!checked || !can || !!prog || (mode !== 'xetnghiem' && !okItems.length)} onClick={() => void doImport()}>B3. Import</button>
        </div>
        <div className="improw opts">
          {radio('mau', 'Mẫu 18', mau === '18', () => setMau('18'))}
          {radio('mau', 'Mẫu 6 đến 18', mau === '6-18', () => setMau('6-18'))}
          {radio('mau', 'Mẫu dưới 6', mau === 'duoi6', () => setMau('duoi6'))}
          <span className="gap" />
          {radio('mode', 'Thêm mới', mode === 'moi', () => { setMode('moi'); setChecked(false); })}
          {radio('mode', 'Cập nhật', mode === 'capnhat', () => { setMode('capnhat'); setChecked(false); })}
          {radio('mode', 'Thêm xét nghiệm', mode === 'xetnghiem', () => { setMode('xetnghiem'); setChecked(false); })}
          <label className="radio"><input type="checkbox" checked={overall} onChange={(e) => { setOverall(e.target.checked); setChecked(false); }} /> Kiểm tra lỗi tổng thể</label>
          <span>Tổng số dòng: <b>{total || ''}</b></span>
        </div>
      </div>
      {!can && <div className="warnbar">Cần vai trò Tiếp đón để import mục Hành chính.</div>}
      {mode === 'xetnghiem' && <div className="warnbar">Chế độ "Thêm xét nghiệm" nhập kết quả khám (thể lực, nhi, mắt, TMH, RHM, phân loại) cho các hồ sơ ĐÃ CÓ trong đơn vị, từ sheet có các cột kết quả.</div>}
      {prog && <div className="progress"><div style={{ width: `${(prog.d / Math.max(1, prog.t)) * 100}%` }} /><span>{prog.what} {prog.d}/{prog.t}</span></div>}
      {msg && <div className="okbar">{msg}</div>}

      <fieldset className="grp"><legend>Danh sách</legend>
        <div className="tablewrap fill">
          <table className="grid">
            <thead><tr><th>Dòng</th><th>Lớp</th><th>Họ tên</th><th>GT</th><th>Ngày sinh</th><th>Tuổi</th><th>Dân tộc</th><th>Số CCCD</th><th>Ngày cấp</th><th>Điện thoại</th><th>Người giám hộ</th><th>Tỉnh/TP</th></tr></thead>
            <tbody>
              {mode !== 'xetnghiem' && items.slice(0, 500).map((it) => (
                <tr key={it.row} className={badRows.has(it.row) ? 'err' : ''}><td>{it.row}</td><td>{it.data.lop}</td><td>{it.data.hoTen}</td><td>{it.data.gioiTinh === 'nam' ? 1 : 2}</td><td>{it.data.ngaySinh}</td><td>{tuoi(it.data.ngaySinh)}</td><td>{it.data.danToc}</td><td>{it.data.cccd}</td><td>{it.data.ngayCap}</td><td>{it.data.dienThoai}</td><td>{it.data.giamHo.hoTen}</td><td>{it.data.tinh}</td></tr>
              ))}
              {mode === 'xetnghiem' && results.slice(0, 500).map((r) => (
                <tr key={r.row}><td>{r.row}</td><td colSpan={2}>{r.cccd}</td><td colSpan={9}>{[r.thecuc && 'thể lực', ...Object.keys(r.lamsang).map((k) => 'lâm sàng ' + k), r.ketluan && 'kết luận'].filter(Boolean).join(', ')}</td></tr>
              ))}
              {!total && <tr><td colSpan={12} className="muted">Chưa có dữ liệu. Bấm "B1. Chọn file".</td></tr>}
            </tbody>
          </table>
          {total > 500 && <div className="sub" style={{ padding: 6 }}>Hiển thị 500/{total} dòng đầu; toàn bộ dòng hợp lệ đều được import.</div>}
        </div>
      </fieldset>

      {fileName && !sheet && <p className="warnbar" role="alert">Không nhận diện được cột của file. Cần cột Họ tên và Số CCCD/Mã định danh; với kết quả khám cần chọn đúng chế độ Thêm xét nghiệm.</p>}
      {mapped && mapped.missing.length > 0 && <p className="warnbar" role="alert">File thiếu cột: {mapped.missing.join(', ')}. Kiểm tra tiêu đề trước khi import.</p>}
      <fieldset className="grp errs"><legend>Danh sách lỗi {checked && `(${errors.length})`}</legend>
        <div className="errgrid">
          <div className="tablewrap fill">
            <table className="grid">
              <thead><tr><th>Dòng</th><th>Họ tên</th><th>Cột</th><th>Giá trị</th><th>Nội dung lỗi</th></tr></thead>
              <tbody>
                {errors.slice(0, 500).map((e, i) => <tr key={i} className={`err ${selErr === e ? 'sel' : ''}`} onClick={() => setSelErr(e)}><td>{e.row}</td><td>{e.hoTen}</td><td>{e.col}</td><td>{e.value}</td><td>{e.msg}</td></tr>)}
                {checked && !errors.length && <tr><td colSpan={5} className="ok">Không có lỗi. Có thể bấm "B3. Import".</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="errdetail">
            {selErr ? <><b>Dòng {selErr.row}</b> · {selErr.hoTen}<br />Cột: {selErr.col}<br />Giá trị: <code>{selErr.value || '(trống)'}</code><br /><span className="bad">{selErr.msg}</span></> : <span className="muted">Chọn một dòng lỗi để xem chi tiết.</span>}
          </div>
        </div>
      </fieldset>
    </div>
  );
}
