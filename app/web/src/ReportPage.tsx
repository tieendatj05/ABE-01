import { useMemo, useState } from 'react';
import type { OpenResult, RecordRow } from '../../../security/src/index.js';
import { LAM_SANG, UNITS, type LamSangData } from './data/catalog.js';
import { UnitSelect } from './UnitSelect.js';
import { bmi, checkMau, type HanhChinh, type KetLuan, type Mau, type TheLuc } from './model.js';
import { session } from './session.js';
import { sachTenAll } from './ten.js';
import { log, run } from './ui.js';

interface Line {
  id: string; ngay: string; lop: string; hoTen: string; gioiTinh: string; ngaySinh: string; cccd: string;
  cao: string; nang: string; bmi: string; mach: string; ha: string; nhi: string; mat: string; tmh: string; rhm: string; loai: string; hc: HanhChinh;
}
const day = (iso: string) => iso.slice(0, 10);
const kqOf = (d?: LamSangData) => (d ? [...new Set(Object.values(d).map((x) => x.kq).filter(Boolean))].join('; ') : '');

/** Báo cáo tổng hợp kết quả khám của đơn vị: giải mã và ghép các mục NGAY TRÊN MÁY NÀY (máy chủ không thấy số liệu). */
export function ReportPage({ unit, setUnit }: { unit: string; setUnit: (u: string) => void }) {
  const c = session.client!;
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [mau, setMau] = useState<Mau | 'all'>('all');
  const [lines, setLines] = useState<Line[] | null>(null);
  const [prog, setProg] = useState('');

  const build = () => run('Tổng hợp báo cáo (giải mã trên máy này)', async () => {
    const latest = (all: RecordRow[], key: (r: RecordRow) => string) => {
      const m = new Map<string, RecordRow>();
      for (const r of all) { const k = key(r); const p = m.get(k); if (!p || r.createdAt >= p.createdAt) m.set(k, r); }
      return [...m.values()];
    };
    const open = async (type: 'hanhchinh' | 'thecuc' | 'lamsang' | 'ketluan', key: (r: RecordRow) => string) => {
      const recs = latest(await c.listGroup(unit, type), key);
      const res = sachTenAll(await c.openMany(recs, (d, t) => setProg(`${type} ${d}/${t}`)));
      return recs.map((rec, i) => ({ rec, res: res[i] as OpenResult | null }));
    };
    const hc = await open('hanhchinh', (r) => r.patientIdx);
    const tl = new Map((await open('thecuc', (r) => r.patientIdx)).map((x) => [x.rec.patientIdx, x.res?.data as TheLuc | undefined]));
    const ls = new Map<string, Record<string, LamSangData>>();
    for (const x of await open('lamsang', (r) => `${r.patientIdx}|${r.khoa}`)) if (x.res) ls.set(x.rec.patientIdx, { ...(ls.get(x.rec.patientIdx) ?? {}), [x.rec.khoa]: x.res.data as LamSangData });
    const kl = new Map((await open('ketluan', (r) => r.patientIdx)).map((x) => [x.rec.patientIdx, x.res?.data as KetLuan | undefined]));
    const out: Line[] = [];
    for (const { rec, res } of hc) {
      const h = res?.data as HanhChinh | undefined;
      if (!h) continue;
      const t = tl.get(rec.patientIdx), l = ls.get(rec.patientIdx), k = kl.get(rec.patientIdx);
      out.push({
        id: rec.id.slice(0, 6), ngay: day(rec.createdAt), lop: h.lop ?? '', hoTen: h.hoTen, gioiTinh: h.gioiTinh === 'nam' ? 'Nam' : 'Nữ', ngaySinh: h.ngaySinh, cccd: h.cccd,
        cao: t?.chieuCao ?? '', nang: t?.canNang ?? '', bmi: t ? bmi(t.chieuCao, t.canNang) : '', mach: t?.mach ?? '', ha: t && t.huyetApTT ? `${t.huyetApTT}/${t.huyetApTTr}` : '',
        nhi: kqOf(l?.Nhi), mat: kqOf(l?.Mat), tmh: kqOf(l?.TMH), rhm: kqOf(l?.RHM), loai: k ? String(k.loai) : '', hc: h,
      });
    }
    setLines(out); setProg('');
    log(`Báo cáo: ${out.length} hồ sơ (đã giải mã trên máy này).`, 'ok');
  });

  const shown = useMemo(() => (lines ?? []).filter((l) => l.ngay >= from && l.ngay <= to && (mau === 'all' || !checkMau(l.hc, mau))), [lines, from, to, mau]);

  const exportCsv = () => {
    const head = ['id', 'ten_congty', 'ngay_kham', 'lop', 'ho_ten', 'gioi_tinh', 'ngay_sinh', 'so_cccd', 'chieu_cao', 'can_nang', 'chi_so_bmi', 'mach', 'huyet_ap', 'nhikhoa', 'mat', 'tmh', 'rhm', 'phan_loai'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const unitName = UNITS.find((u) => u.ma === unit)?.ten ?? unit;
    const body = shown.map((l) => [l.id, unitName, l.ngay, l.lop, l.hoTen, l.gioiTinh, l.ngaySinh, l.cccd, l.cao, l.nang, l.bmi, l.mach, l.ha, l.nhi, l.mat, l.tmh, l.rhm, l.loai].map(esc).join(','));
    const url = URL.createObjectURL(new Blob(['﻿' + [head.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: `bao-cao-${unit}.csv` }).click();
    URL.revokeObjectURL(url);
    log(`Đã xuất ${shown.length} dòng (dữ liệu rõ).`, 'warn');
  };
  void LAM_SANG;

  return (
    <div className="reportpage">
      <div className="rpttop">
        <div>
          <div className="improw"><label>Tên công ty</label>
            <UnitSelect value={unit} onChange={(u) => { setUnit(u); setLines(null); }} /></div>
          <div className="improw"><label>Từ ngày :</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><label>Đến ngày :</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <span>Tổng số dòng: <b>{lines ? shown.length : ''}</b></span></div>
        </div>
        <div className="rptmau">
          {([['18', 'Mẫu 18'], ['6-18', 'Mẫu 6 đến 18'], ['duoi6', 'Mẫu dưới 6'], ['all', 'Mọi mẫu']] as [Mau | 'all', string][]).map(([k, l]) => <label key={k} className="radio"><input type="radio" name="rmau" checked={mau === k} onChange={() => setMau(k)} /> {l}</label>)}
        </div>
        <button className="big" onClick={() => void build()}>⟳ Tổng hợp {prog && `(${prog})`}</button>
        <button className="big" disabled={!shown.length} onClick={exportCsv}>Xuất Excel</button>
      </div>
      <div className="tablewrap rptgrid">
        <table className="grid">
          <thead><tr><th>id</th><th>ngay_kham</th><th>lop</th><th>ho_ten</th><th>gioi_tinh</th><th>ngay_sinh</th><th>so_cccd</th><th>chieu_cao</th><th>can_nang</th><th>chi_so_bmi</th><th>mach</th><th>huyet_ap</th><th>nhikhoa</th><th>mat</th><th>tmh</th><th>rhm</th><th>phan_loai</th></tr></thead>
          <tbody>
            {shown.map((l) => <tr key={l.id + l.cccd}><td>{l.id}</td><td>{l.ngay}</td><td>{l.lop}</td><td>{l.hoTen}</td><td>{l.gioiTinh}</td><td>{l.ngaySinh}</td><td>{l.cccd}</td><td>{l.cao}</td><td>{l.nang}</td><td>{l.bmi}</td><td>{l.mach}</td><td>{l.ha}</td><td>{l.nhi}</td><td>{l.mat}</td><td>{l.tmh}</td><td>{l.rhm}</td><td>{l.loai}</td></tr>)}
            {!lines && <tr><td colSpan={17} className="muted">Bấm Tổng hợp.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
