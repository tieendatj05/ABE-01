import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordRow, RecordType } from '../../../security/src/index.js';
import { LAM_SANG, MAU_NHANH, TEMPLATES, UNITS, type LamSangData } from './data/catalog.js';
import {
  blank, canWrite, validateHanhChinh, type CanLamSang, type HanhChinh, type KetLuan, type LanKham, type TheLuc, type TienSu,
} from './model.js';
import { PanelCanLamSang, PanelHanhChinh, PanelKetLuan, PanelLamSang, PanelLanKham, PanelTheLuc, PanelTienSu, type SignMeta } from './Sections.js';
import { focusPatient } from './focus.js';
import { docMau, luuMau, xoaMau, type Mau } from './mau.js';
import { session } from './session.js';
import { sachTenAll } from './ten.js';
import { log, run } from './ui.js';
import { backfillLienThong, fetchReceipts, receiptText, submitPatient, type ReceiptMap } from './byt.js';

type Sec = 'hanhchinh' | 'lankham' | 'tiensu' | 'thecuc' | 'lamsang' | 'canlamsang' | 'ketluan';
const NAV: [Sec, string][] = [
  ['hanhchinh', 'Thông tin Hành chính'], ['lankham', 'Thông tin lần khám'], ['tiensu', 'Tiền sử bệnh tật'],
  ['thecuc', 'Khám thể lực'], ['lamsang', 'Khám lâm sàng'], ['canlamsang', 'Cận lâm sàng'], ['ketluan', 'Kết luận'],
];
interface Row { rec: RecordRow; data: HanhChinh | null }
type Tab = 'all' | 'chua' | 'da' | 'loi' | 'loidl';

const defaultLs = (): Record<string, LamSangData> =>
  Object.fromEntries(LAM_SANG.map((k) => [k.khoa, MAU_NHANH['Bình thường'](k.muc)]));

/** Màn hình Khám sức khoẻ định kỳ: danh sách theo đơn vị + phiếu khám nhiều mục. Mỗi mục là một bản ghi mã hoá riêng. */
export function Exam({ unit, templateId }: { unit: string; templateId: string }) {
  const c = session.client!;
  const child = TEMPLATES.find((t) => t.id === templateId)?.child ?? false;
  const attrs = c.s.attrs;

  const [rows, setRows] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [prog, setProg] = useState<{ d: number; t: number } | null>(null);
  const [progLabel, setProgLabel] = useState('Đang giải mã');
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [hide, setHide] = useState(false);
  const [sel, setSel] = useState<Row | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('new');
  const [sec, setSec] = useState<Sec>('hanhchinh');
  const panelRef = useRef<HTMLDivElement>(null);
  /** Bấm menu trái: cuộn tới mục tương ứng trong trang (cả phiếu là một trang cuộn liên tục từ Hành chính đến Kết luận). */
  const goSec = (k: Sec) => { setSec(k); panelRef.current?.querySelector<HTMLElement>(`#sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const onScroll = () => {
    const p = panelRef.current; if (!p) return;
    const top = p.getBoundingClientRect().top + 24;
    let cur: Sec = NAV[0][0];
    for (const [k] of NAV) { const el = p.querySelector<HTMLElement>(`#sec-${k}`); if (el && el.getBoundingClientRect().top <= top) cur = k; }
    setSec((o) => (o === cur ? o : cur));
  };
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [denied, setDenied] = useState<Record<string, boolean>>({});
  const [info, setInfo] = useState('');
  const [meta, setMeta] = useState<Record<string, SignMeta | undefined>>({});

  const [hc, setHc] = useState<HanhChinh>(blank.hanhchinh());
  const [lk, setLk] = useState<LanKham>(blank.lankham());
  const [ts, setTs] = useState<TienSu>(blank.tiensu());
  const [tl, setTl] = useState<TheLuc>(blank.thecuc());
  const [ls, setLsAll] = useState<Record<string, LamSangData>>(defaultLs());
  const [cls, setCls] = useState<CanLamSang>(blank.canlamsang());
  const [kl, setKl] = useState<KetLuan>(blank.ketluan());

  const [customMau, setCustomMau] = useState<Record<string, Mau>>(() => docMau());       // mẫu mặc định do người dùng tự lưu (khám lâm sàng)
  const mark = (k: string) => setDirty((s) => new Set(s).add(k));
  const off = (type: RecordType, khoa?: string) => mode === 'view' || !canWrite(type, attrs, khoa);

  /** Áp một mẫu cho các chuyên khoa mà người dùng được ghi (Điền giá trị bình thường / Xóa / Load). */
  const applyLs = (make: (k: (typeof LAM_SANG)[number]) => LamSangData) => {
    if (mode === 'view') { log('Bấm Mới hoặc Sửa trước khi thay đổi.', 'warn'); return; }
    const next = { ...ls };
    for (const k of LAM_SANG) if (canWrite('lamsang', attrs, k.khoa) && (child || k.khoa !== 'Nhi')) { next[k.khoa] = make(k); mark(`ls:${k.khoa}`); }
    setLsAll(next);
  };

  const reset = () => {
    setHc(blank.hanhchinh()); setLk(blank.lankham()); setTs(blank.tiensu()); setTl(blank.thecuc()); setLsAll(defaultLs());
    setCls(blank.canlamsang()); setKl(blank.ketluan()); setDirty(new Set()); setDenied({}); setInfo(''); setMeta({});
    panelRef.current?.scrollTo({ top: 0 });
  };

  // Bản đã giải mã của từng bản ghi (theo id): tải lại chỉ giải mã phần MỚI, nên cập nhật khi người khác nhập rất nhanh.
  const decrypted = useRef(new Map<string, HanhChinh | null>());
  const lastVersion = useRef('');
  const loading = useRef(false);
  const [liveAt, setLiveAt] = useState<Date | null>(null);
  const [rcpt, setRcpt] = useState<ReceiptMap>(new Map());    // biên nhận của cổng Bộ Y tế theo id bản ghi (nguồn của trạng thái liên thông)
  const [bytErr, setBytErr] = useState('');
  const lt = (r: Row) => rcpt.has(r.rec.id);

  const load = useCallback(async (silent = false) => {
    loading.current = true; setIsLoading(true); setLoadError('');
    if (!silent) decrypted.current.clear();
    try {
      if (!silent) { setRows([]); setSel(null); }
      lastVersion.current = await c.groupVersion(unit).catch(() => lastVersion.current);   // lấy dấu vân tay TRƯỚC khi tải: thay đổi trong lúc tải sẽ bị bắt ở lần hỏi kế tiếp
      const all = await c.listGroup(unit);
      const latest = new Map<string, RecordRow>();
      for (const r of all) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
      const recs = [...latest.values()];
      const todo = recs.filter((r) => !decrypted.current.has(r.id));
      if (!silent && todo.length > 20) setProg({ d: 0, t: todo.length });
      const res = sachTenAll(await c.openMany(todo, silent ? undefined : (d, t) => setProg({ d, t })));
      todo.forEach((r, i) => decrypted.current.set(r.id, (res[i]?.data as HanhChinh) ?? null));
      const built: Row[] = recs.map((rec) => ({ rec, data: decrypted.current.get(rec.id) ?? null }));
      setRows(built);
      const st = await fetchReceipts(c, recs.map((r) => r.id));
      setRcpt(st.map); setBytErr(st.error);
      setProg(null);
      setLiveAt(new Date());
      if (!silent) log(`Đã tải ${recs.length} hồ sơ của đơn vị và giải mã trên máy này.`, 'ok');
      return built;
    } catch (e) { setLoadError((e as Error).message); throw e; }
    finally { loading.current = false; setIsLoading(false); setProg(null); }
  }, [c, unit]);

  // Nhiều người cùng nhập: cứ 4 giây hỏi "có dữ liệu mới chưa" (rất nhẹ); có người khác lưu thì tự tải lại, số liệu các tab cập nhật ngay.
  useEffect(() => {
    const t = setInterval(() => {
      if (loading.current) return;
      void c.groupVersion(unit).then((v) => { if (lastVersion.current && v !== lastVersion.current && !loading.current) return load(true); }).catch((e: Error) => setLoadError(e.message));
    }, 4000);
    return () => clearInterval(t);
  }, [c, unit, load]);

  // Vào màn hình (hoặc màn hình bị dựng lại: đổi trang, mất kết nối thoáng qua): nếu trước đó đang làm với một bệnh nhân thì mở lại đúng người đó,
  // không để phiếu trống trơn như chưa chọn ai.
  useEffect(() => {
    reset(); setMode('new'); setSec('hanhchinh'); decrypted.current.clear(); lastVersion.current = '';
    void run('Tải danh sách đơn vị', async () => {
      const built = await load();
      const want = focusPatient.get(c.s.deviceId);
      const row = want ? built?.find((r) => r.data?.cccd === want) : undefined;
      if (row) await select(row);
    });
  }, [unit]);

  /** Lý do một dòng trong danh sách không mở được (thay cho phiếu trắng khó hiểu). */
  const lockedWhy = attrs.includes('MED:Role:NhapLieu')
    ? 'Hồ sơ này do tài khoản khác nhập. Tài khoản Nhập liệu chỉ đọc lại được những hồ sơ do chính mình nhập (nhập liệu 02 không đọc được hồ sơ của nhập liệu 01). Muốn xem, hãy đăng nhập bằng tài khoản Tiếp đón hoặc Bác sĩ; hoặc import/nhập lại bằng tài khoản này.'
    : 'Tài khoản của bạn không giải mã được hồ sơ này (thuộc phạm vi khoa/quyền khác, hoặc dữ liệu lỗi).';

  const select = (row: Row) => run('Mở phiếu khám (giải mã từng mục)', async () => {
    focusPatient.set(c.s.deviceId, row.data?.cccd);
    reset(); setSel(row); setMode('view'); setSec('hanhchinh');
    if (!row.data) { setInfo(lockedWhy); return; }
    setHc(row.data);
    const recs = await c.listRecords(row.data.cccd);
    const latest = new Map<string, RecordRow>();
    for (const r of recs) { if (r.type === 'hanhchinh') continue; const k = `${r.type}|${r.khoa}`; const p = latest.get(k); if (!p || r.createdAt >= p.createdAt) latest.set(k, r); }
    const nd: Record<string, boolean> = {};
    for (const r of latest.values()) {
      const res = await c.openRecord(r).catch(() => null);
      const key = r.type === 'lamsang' ? `ls:${r.khoa}` : r.type;
      if (!res) { nd[key] = true; continue; }
      const d = res.data as never;
      setMeta((m) => ({ ...m, [r.type === 'lamsang' ? r.khoa : r.type]: { name: res.author.name, ok: res.signatureValid, deviceId: res.author.deviceId } }));
      if (r.type === 'lankham') setLk(d); else if (r.type === 'tiensu') setTs(d); else if (r.type === 'thecuc') setTl(d);
      else if (r.type === 'lamsang') setLsAll((s) => ({ ...s, [r.khoa]: d }));
      else if (r.type === 'canlamsang') setCls(d); else if (r.type === 'ketluan') setKl(d);
      if (!res.signatureValid) log(`CẢNH BÁO: chữ ký số của mục ${r.type} không hợp lệ`, 'bad');
    }
    // AN TOÀN CHẨN ĐOÁN: mục không có bản ghi nào trong phạm vi được xem VÀ tài khoản không có quyền ghi mục đó => KHÔNG hiện biểu mẫu trống (dễ hiểu nhầm là "bình thường"),
    // mà báo rõ "không thuộc phạm vi xem / chưa có dữ liệu".
    const have = new Set([...latest.values()].map((r) => (r.type === 'lamsang' ? `ls:${r.khoa}` : r.type)));
    for (const k of LAM_SANG) if (!have.has(`ls:${k.khoa}`) && !canWrite('lamsang', attrs, k.khoa)) nd[`ls:${k.khoa}`] = true;
    for (const t of ['lankham', 'tiensu', 'thecuc', 'canlamsang', 'ketluan'] as RecordType[]) if (!have.has(t) && !canWrite(t, attrs, 'KSK')) nd[t] = true;
    setDenied(nd);
    session.schedulePersist();
  });

  const save = () => run('Mã hoá từng mục rồi lưu', async () => {
    const todo: [RecordType, string, unknown, string?][] = [];
    if (mode === 'new' || dirty.has('hanhchinh')) {
      if (!canWrite('hanhchinh', attrs)) throw new Error('Tài khoản của bạn không có quyền tạo/sửa mục Hành chính (cần vai trò Tiếp đón).');
      const errs = validateHanhChinh(hc);
      if (errs.length) { alert('Chưa lưu được:\n- ' + errs.join('\n- ')); return; }
      if (mode === 'new' && dupOf && !confirm(`Số định danh ${hc.cccd} đã có trong đơn vị (hồ sơ "${dupOf.data!.hoTen}").\nLưu sẽ ghi thêm một phiên bản mới cho chính người đó. Vẫn lưu?`)) return;
      todo.push(['hanhchinh', 'KSK', hc, unit]);
    }
    if (dirty.has('lankham')) todo.push(['lankham', 'KSK', lk]);
    if (dirty.has('tiensu')) todo.push(['tiensu', 'KSK', ts]);
    if (dirty.has('thecuc')) todo.push(['thecuc', 'KSK', tl]);
    for (const k of LAM_SANG) if (dirty.has(`ls:${k.khoa}`)) todo.push(['lamsang', k.khoa, ls[k.khoa]]);
    if (dirty.has('canlamsang')) todo.push(['canlamsang', 'XetNghiem', { ...cls, gioiTinh: hc.gioiTinh }]);
    if (dirty.has('ketluan')) todo.push(['ketluan', 'KSK', kl]);
    if (!todo.length) { log('Không có thay đổi nào để lưu.', 'warn'); return; }
    if (!hc.cccd) throw new Error('Cần số định danh cá nhân (mã hồ sơ) trước khi lưu.');
    const t0 = performance.now();
    for (const [type, khoa, data, group] of todo) {
      if (!canWrite(type, attrs, khoa)) throw new Error(`Bạn không có quyền ghi mục "${type}${type === 'lamsang' ? ' - ' + khoa : ''}".`);
      await c.saveRecord({ patientCode: hc.cccd, type, khoa, data, group: unit, name: hc.hoTen });
    }
    log(`Đã lưu ${todo.length} mục (mã hoá ${Math.round(performance.now() - t0)} ms). Mỗi mục có chính sách truy cập riêng, tự sinh.`, 'ok');
    session.schedulePersist();
    const cccd = hc.cccd;
    // Lưu bất kỳ mục nào (kể cả chỉ sửa thông tin hành chính) -> tự động liên thông Bộ Y tế NGAY, không cần qua Quản lý hồ sơ bấm nút riêng.
    // Bắt buộc gửi cả khi chỉ sửa hành chính: mỗi lần lưu tạo bản ghi MỚI chưa có biên nhận, nếu không gửi thì người đã liên thông sẽ tụt về "Chưa liên thông".
    // Gửi lại toàn bộ hồ sơ hiện có của người này (không chỉ mục vừa sửa) để cổng có bản đầy đủ.
    try {
      const out = await submitPatient(c, cccd);
      log(`Đã tự động liên thông Bộ Y tế (cơ sở ${out.ma})${out.rejected ? `, cổng từ chối ${out.rejected} mục` : ''}.`, out.rejected ? 'warn' : 'ok');
    } catch (e) { log(`Đã lưu, nhưng chưa liên thông được: ${(e as Error).message}`, 'warn'); }
    await load();
    setDirty(new Set());
    // select() tự đưa về chế độ xem (an toàn) sau khi nạp lại dữ liệu mới lưu; bấm "Sửa" nếu muốn sửa tiếp.
    setRows((cur) => { const r = cur.find((x) => x.data?.cccd === cccd); if (r) void select(r); return cur; });
  });

  const del = () => run('Xoá phiếu', async () => {
    if (!sel?.data) return;
    if (!confirm(`Xoá các mục do thiết bị này đã tạo cho hồ sơ ${sel.data.hoTen}? Không hoàn tác được.`)) return;
    const mine = (await c.listRecords(sel.data.cccd)).filter((r) => r.authorDevice === c.s.deviceId);
    if (!mine.length) { log('Không có mục nào do thiết bị này tạo - không được phép xoá (chỉ thiết bị đã tạo mới xoá được).', 'warn'); return; }
    for (const r of mine) await c.deleteRecord(r.id);
    log(`Đã xoá ${mine.length} mục.`, 'ok');
    focusPatient.clear(); reset(); setMode('new'); await load();
  });

  /** Dò những hồ sơ ĐÃ CÓ mục khám (vd đã nhập Thể lực từ trước) nhưng chưa liên thông (nhập trước khi có tính năng tự động) - liên
   * thông từng người một, số đếm "Chưa liên thông"/"Đã liên thông" nhảy liên tục ngay trong lúc chạy. */
  const backfill = () => run('Dò và liên thông các hồ sơ đã có mục khám', async () => {
    const list = rows.filter((r) => r.data).map((r) => ({ rec: r.rec, cccd: r.data!.cccd }));
    setProgLabel('Đang liên thông'); setProg({ d: 0, t: 1 });
    try {
      const out = await backfillLienThong(c, unit, list, rcpt, (d, t, receipts) => { setProg({ d, t }); setRcpt(receipts); });
      log(out.total ? `Đã liên thông thêm ${out.ok}/${out.total} hồ sơ đã có mục khám từ trước.` : 'Không có hồ sơ nào cần liên thông thêm.', out.total ? 'ok' : 'warn');
    } finally { setProg(null); setProgLabel('Đang giải mã'); }
  });

  /** Kiểm tra trùng CCCD (như nút "Check trùng CCCD" của app cũ): đang nhập người MỚI mà số định danh đã có trong đơn vị. */
  const dupOf = useMemo(() => (mode === 'new' && hc.cccd.length === 12 ? rows.find((r) => r.data?.cccd === hc.cccd) : undefined), [mode, hc.cccd, rows]);
  const dupMsg = dupOf ? `Số định danh này đã có trong đơn vị (hồ sơ "${dupOf.data!.hoTen}"). Lưu sẽ ghi thêm phiên bản mới cho chính người đó, không tạo người mới — bấm vào dòng trong danh sách bên dưới rồi "Sửa" nếu muốn sửa hồ sơ cũ.` : '';

  const counts = useMemo(() => ({
    all: rows.length,
    chua: rows.filter((r) => r.data && !rcpt.has(r.rec.id)).length,
    da: rows.filter((r) => r.data && rcpt.has(r.rec.id)).length,
    loi: rows.filter((r) => r.data && validateHanhChinh(r.data).length).length,
    loidl: rows.filter((r) => !r.data).length,
  }), [rows, rcpt]);
  const shown = rows.filter((r) => {
    if (tab === 'chua' && !(r.data && !lt(r))) return false;
    if (tab === 'da' && !(r.data && lt(r))) return false;
    if (tab === 'loi' && !(r.data && validateHanhChinh(r.data).length)) return false;
    if (tab === 'loidl' && r.data) return false;
    const s = q.trim().toLowerCase();
    return !s || [r.data?.hoTen, r.data?.cccd, r.data?.dienThoai].some((v) => v?.toLowerCase().includes(s));
  });

  const body = {
    hanhchinh: <PanelHanhChinh d={hc} set={(v) => { setHc(v); mark('hanhchinh'); }} off={off('hanhchinh')} child={child} lockCccd={mode === 'edit'} dup={dupMsg} />,
    lankham: <PanelLanKham d={lk} set={(v) => { setLk(v); mark('lankham'); }} off={off('lankham')} />,
    tiensu: <PanelTienSu d={ts} set={(v) => { setTs(v); mark('tiensu'); }} off={off('tiensu')} />,
    thecuc: <PanelTheLuc d={tl} set={(v) => { setTl(v); mark('thecuc'); }} off={off('thecuc')} />,
    lamsang: <PanelLamSang ls={ls} meta={meta}
      setLs={(k, v) => { setLsAll({ ...ls, [k]: v }); mark(`ls:${k}`); }}
      can={(k) => mode !== 'view' && canWrite('lamsang', attrs, k)}
      denied={Object.fromEntries(LAM_SANG.map((k) => [k.khoa, !!denied[`ls:${k.khoa}`]]))} child={child}
      onNormal={() => applyLs((k) => MAU_NHANH['Bình thường'](k.muc))}
      onClear={() => applyLs((k) => Object.fromEntries(k.muc.map((m) => [m, { kq: '', loai: '' }])))}
      onLoad={(name) => applyLs((k) => (customMau[name] ? customMau[name][k.khoa] ?? MAU_NHANH['Bình thường'](k.muc) : MAU_NHANH[name](k.muc)))}
      custom={Object.keys(customMau)}
      onSaveMau={(name) => {
        const m: Mau = {};
        for (const k of LAM_SANG) if (ls[k.khoa] && (child || k.khoa !== 'Nhi')) m[k.khoa] = ls[k.khoa];
        setCustomMau(luuMau(name, m)); log(`Đã lưu mẫu mặc định "${name}" (trên máy này).`, 'ok');
      }}
      onDeleteMau={(name) => { setCustomMau(xoaMau(name)); log(`Đã xóa mẫu "${name}".`, 'ok'); }} />,
    canlamsang: <PanelCanLamSang d={cls} set={(v) => { setCls(v); mark('canlamsang'); }} off={off('canlamsang', 'XetNghiem')} sex={hc.gioiTinh} child={child} />,
    ketluan: <PanelKetLuan d={kl} set={(v) => { setKl(v); mark('ketluan'); }} off={off('ketluan')} />,
  };
  const isDenied = (k: Sec) => denied[k] && k !== 'lamsang';

  return (
    <div className="exam">
      <aside className="side">
        <div className="sidehead">THAO TÁC</div>
        <div className="ops">
          <button className="op" onClick={() => { focusPatient.clear(); reset(); setSel(null); setMode('new'); setSec('hanhchinh'); }}>＋ Mới</button>
          <button className="op" disabled={mode === 'view'} onClick={() => void save()}>💾 Lưu</button>
          <button className="op" disabled={!sel?.data || mode !== 'view'} onClick={() => setMode('edit')}>✎ Sửa</button>
          <button className="op" disabled={!sel?.data} onClick={() => void del()}>✕ Xóa</button>
        </div>
        <div className="sidehead">NỘI DUNG PHIẾU</div>
        {Object.keys(denied).length > 0 && <div style={{ fontSize: 12, color: '#5d6b79', padding: '0 14px 6px' }}>🔒 không hiển thị với tài khoản của bạn · ◐ chỉ hiển thị một phần</div>}
        <nav>
          {NAV.map(([k, label]) => (
            <a key={k} href="#" className={sec === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); goSec(k); }}>
              {label}{k === 'lamsang' ? (Object.keys(denied).filter((x) => x.startsWith('ls:')).length >= LAM_SANG.length ? ' 🔒' : Object.keys(denied).some((x) => x.startsWith('ls:')) ? ' ◐' : '') : denied[k] ? ' 🔒' : ''}
              {dirty.has(k) || [...dirty].some((x) => k === 'lamsang' && x.startsWith('ls:')) ? ' •' : ''}
            </a>
          ))}
        </nav>
        <div className="sidefoot">
          <button className="wide" onClick={() => {
            const bad = rows.filter((r) => r.data && validateHanhChinh(r.data).length);
            alert(bad.length ? `Có ${bad.length} hồ sơ lỗi dữ liệu:\n` + bad.slice(0, 15).map((r) => `- ${r.data!.hoTen}: ${validateHanhChinh(r.data!).join('; ')}`).join('\n') : 'Dữ liệu hợp lệ.');
          }}>Kiểm tra dữ liệu import</button>
          <button className="wide" disabled={!!prog} onClick={() => void backfill()}>📤 Liên thông hồ sơ đã có mục khám</button>
          <button className="wide" onClick={() => setHide(!hide)}>{hide ? 'Hiện danh sách' : 'Ẩn danh sách'}</button>
        </div>
      </aside>

      <section className="main">
        <div className="panel" ref={panelRef} onScroll={onScroll}>
          {info && !(sel && !sel.data) && <div className="warnbar">{info}</div>}
          {sel && !sel.data && <div className="denied" role="alert"><b>🔒 Không mở được hồ sơ này</b><br />{lockedWhy}</div>}
          {sel?.data && mode !== 'new' && lt(sel) && <div className="okbar">Liên thông Bộ Y tế: {receiptText(rcpt.get(sel.rec.id))}</div>}
          {!(sel && !sel.data) && NAV.map(([k, label]) => (
            <section key={k} id={`sec-${k}`} className="examsec">
              <div className="examsechead">{label}{isDenied(k) ? ' 🔒' : ''}</div>
              {isDenied(k)
                ? <div className="denied"><b>🔒 Mục này không hiển thị với tài khoản của bạn</b> (thuộc khoa/quyền khác, hoặc chưa có dữ liệu). <u>Không suy ra là bình thường.</u> Nếu cần cho chẩn đoán, hãy liên hệ khoa phụ trách hoặc người nhập hồ sơ.</div>
                : body[k]}
            </section>
          ))}
        </div>

        {!hide && (
          <div className="listbox">
            <div className="tabsrow">
              {([['all', 'Import excel'], ['chua', 'Chưa liên thông'], ['da', 'Đã liên thông'], ['loi', 'Hồ sơ lỗi'], ['loidl', 'Lỗi dữ liệu']] as [Tab, string][]).map(([k, l]) => (
                <a key={k} href="#" className={tab === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab(k); }}>{l} ({counts[k]})</a>
              ))}
              <input className="search" placeholder="Tìm kiếm" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="reload" onClick={() => void run('Tải lại danh sách', () => load())}>⟳ Tải lại danh sách đã lưu</button>
              <span className="livepill">● trực tiếp{liveAt ? ' · ' + liveAt.toLocaleTimeString('vi-VN') : ''}</span>
            </div>
            {loadError && <div className="warnbar" role="alert">Không tải được hồ sơ: {loadError}</div>}
            {prog && <div className="progress"><div style={{ width: `${(prog.d / Math.max(1, prog.t)) * 100}%` }} /><span>{progLabel} {prog.d}/{prog.t} hồ sơ…</span></div>}
            <div className="tablewrap">
              <table className="grid">
                <thead><tr><th>id</th><th>ma_cskcb</th><th>ngay_vao</th><th>lop</th><th>ho_ten</th><th>gioi_tinh</th><th>ngay_sinh</th><th>dan_toc</th><th>dien_thoai</th><th>so_cccd</th><th>nguoi_giam_ho</th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.rec.id} className={sel?.rec.id === r.rec.id ? 'sel' : ''} onClick={() => void select(r)}>
                      <td>{r.rec.id.slice(0, 6)}</td><td>{UNITS.find((u) => u.ma === unit)?.ma}</td><td>{new Date(r.rec.createdAt).toLocaleDateString('vi-VN')}</td>
                      {r.data ? <>
                        <td>{r.data.lop}</td><td>{r.data.hoTen}</td><td>{r.data.gioiTinh === 'nam' ? 1 : 2}</td><td>{r.data.ngaySinh}</td><td>{r.data.danToc}</td>
                        <td>{r.data.dienThoai}</td><td>{r.data.cccd}</td><td>{r.data.giamHo.hoTen}</td></> : <td colSpan={8} className="lock">🔒 mã hoá - không đủ quyền đọc</td>}
                    </tr>
                  ))}
                  {!shown.length && !prog && <tr><td colSpan={10} className="muted">{isLoading ? 'Đang tải hồ sơ…' : loadError ? 'Chưa tải được danh sách.' : rows.length ? 'Không có hồ sơ khớp.' : 'Chưa có hồ sơ.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
