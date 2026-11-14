// Các màn hình xem kết quả của app phụ huynh. Chỉ HIỂN THỊ: mọi giải mã đã xong ở lớp dưới (security/src/client/parent.ts).
import { useMemo, useState } from 'react';
import type { ParentItem } from '../../../security/src/index.js';
import { LAM_SANG, XET_NGHIEM, flag, type LamSangData, type Sex } from '../../web/src/data/catalog.js';
import { bmi, type CanLamSang, type HanhChinh, type KetLuan, type LanKham, type TheLuc, type TienSu } from '../../web/src/model.js';
import { Icon, type IconName } from './icons.js';

export const LOAI: Record<number, string> = { 1: 'Rất tốt', 2: 'Tốt', 3: 'Trung bình', 4: 'Yếu', 5: 'Rất yếu' };
export const loaiOf = (v: unknown) => { const n = Number(v); return n >= 1 && n <= 5 ? n : 0; };

export const fmtDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s ?? '');
export const fmtTime = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
};

/** Bản MỚI NHẤT của một loại mục (và khoa). */
export function latestOf(items: ParentItem[], type: string, khoa?: string) {
  return items.filter((i) => i.type === type && (khoa === undefined || i.khoa === khoa)).sort((a, b) => a.ts.localeCompare(b.ts)).pop();
}
export const data = <T,>(i?: ParentItem) => i?.data as T | undefined;

export function LoaiBadge({ v, big = false }: { v: unknown; big?: boolean }) {
  const n = loaiOf(v);
  if (!n) return null;
  return <span className={`loai l${n}${big ? ' big' : ''}`}><b>{n}</b>{big ? <small>{LOAI[n]}</small> : <>Loại {n}</>}</span>;
}

const Empty = ({ icon, text }: { icon: IconName; text: string }) => (
  <div className="empty"><div className="empty-ico"><Icon n={icon} size={30} /></div><p>{text}</p></div>
);

/* ---------------- Thể lực ---------------- */
export function ThucLuc({ items }: { items: ParentItem[] }) {
  const it = latestOf(items, 'thecuc');
  const tl = data<TheLuc>(it);
  if (!tl) return <Empty icon="activity" text="Chưa có kết quả đo thể lực." />;
  const b = bmi(tl.chieuCao, tl.canNang);
  const tiles: { ico: IconName; k: string; v: string; u: string; tone: string }[] = [
    { ico: 'ruler', k: 'Chiều cao', v: tl.chieuCao, u: 'cm', tone: 'blue' },
    { ico: 'scale', k: 'Cân nặng', v: tl.canNang, u: 'kg', tone: 'teal' },
    { ico: 'activity', k: 'Mạch', v: tl.mach, u: 'lần/phút', tone: 'rose' },
    { ico: 'drop', k: 'Huyết áp', v: tl.huyetApTT && tl.huyetApTTr ? `${tl.huyetApTT}/${tl.huyetApTTr}` : '', u: 'mmHg', tone: 'violet' },
    { ico: 'wind', k: 'Nhịp thở', v: tl.nhipTho, u: 'lần/phút', tone: 'sky' },
    { ico: 'thermo', k: 'Nhiệt độ', v: tl.nhietDo, u: '°C', tone: 'amber' },
  ];
  return (
    <>
      {b && (
        <div className="card bmi">
          <div><span className="eyebrow">Chỉ số khối cơ thể</span><div className="bmi-v">{b}<small> kg/m²</small></div></div>
          <LoaiBadge v={tl.loai} big />
        </div>
      )}
      <div className="tiles">
        {tiles.filter((t) => t.v).map((t) => (
          <div key={t.k} className={`tile ${t.tone}`}>
            <span className="tile-ico"><Icon n={t.ico} size={20} /></span>
            <span className="tile-k">{t.k}</span>
            <span className="tile-v">{t.v}<small> {t.u}</small></span>
          </div>
        ))}
      </div>
      {!b && tl.loai ? <div className="card row-between"><span>Phân loại thể lực</span><LoaiBadge v={tl.loai} /></div> : null}
      {it && <p className="foot">Cập nhật {fmtTime(it.ts)}{it.authorName ? ` · ${it.authorName}` : ''}</p>}
    </>
  );
}

/* ---------------- Khám lâm sàng ---------------- */
const KHOA_ICON: Record<string, IconName> = { Nhi: 'heart', Mat: 'eye', TMH: 'ear', RHM: 'tooth' };
export function LamSangView({ items }: { items: ParentItem[] }) {
  const blocks = LAM_SANG.map((k) => ({ k, it: latestOf(items, 'lamsang', k.khoa) })).filter((x) => x.it);
  const [open, setOpen] = useState<string>(blocks[0]?.k.khoa ?? '');
  if (!blocks.length) return <Empty icon="heart" text="Chưa có kết quả khám lâm sàng." />;
  return (
    <>
      {blocks.map(({ k, it }) => {
        const d = it!.data as LamSangData;
        const rows = k.muc.filter((m) => d[m] && (d[m].kq || d[m].loai));
        const worst = Math.max(0, ...rows.map((m) => loaiOf(d[m].loai)));
        const isOpen = open === k.khoa;
        return (
          <div key={k.khoa} className={`card acc${isOpen ? ' open' : ''}`}>
            <button className="acc-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : k.khoa)}>
              <span className="tile-ico blue"><Icon n={KHOA_ICON[k.khoa] ?? 'heart'} size={20} /></span>
              <span className="acc-t"><b>{k.ten}</b><small>{rows.length} mục{it!.authorName ? ` · ${it!.authorName}` : ''}</small></span>
              {worst > 0 && <LoaiBadge v={worst} />}
              <Icon n="right" size={18} className="chev" />
            </button>
            {isOpen && (
              <div className="acc-b">
                {rows.map((m) => (
                  <div key={m} className="kv">
                    <span>{m}</span>
                    <b>{d[m].kq || '—'}{d[m].loai ? <LoaiBadge v={d[m].loai} /> : null}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ---------------- Xét nghiệm ---------------- */
const XN = new Map(XET_NGHIEM.map((x) => [x.ma, x]));
function RangeBar({ v, lo, hi }: { v: number; lo: number; hi: number }) {
  const span = hi - lo || 1;
  const min = lo - span * 0.6, max = hi + span * 0.6;
  const pos = Math.max(3, Math.min(97, ((v - min) / (max - min)) * 100));
  const a = ((lo - min) / (max - min)) * 100, b = ((hi - min) / (max - min)) * 100;
  return (
    <div className="range" aria-hidden="true">
      <i className="band" style={{ left: `${a}%`, width: `${b - a}%` }} />
      <i className="dot" style={{ left: `${pos}%` }} />
    </div>
  );
}
export function XetNghiemView({ items }: { items: ParentItem[] }) {
  const cls = data<CanLamSang>(latestOf(items, 'canlamsang'));
  const sex: Sex = cls?.gioiTinh === 'nu' ? 'nu' : 'nam';
  const rows = useMemo(() => {
    if (!cls?.kq) return [];
    return XET_NGHIEM.filter((x) => cls.kq[x.ma] !== undefined && cls.kq[x.ma] !== '').map((x) => {
      const raw = cls.kq[x.ma];
      const v = Number(raw);
      const num = raw.trim() !== '' && Number.isFinite(v);
      const f = num ? flag(x.ma, v, sex) : 'binhthuong';
      const r = XN.get(x.ma)?.[sex] ?? null;
      return { x, raw, v, num, f, r };
    });
  }, [cls, sex]);
  if (!rows.length) return <Empty icon="flask" text="Chưa có kết quả xét nghiệm." />;
  const bad = rows.filter((r) => r.f !== 'binhthuong');
  const ok = rows.filter((r) => r.f === 'binhthuong');
  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <div className={`xn ${r.f !== 'binhthuong' ? 'out' : ''}`}>
      <div className="xn-top">
        <span className="xn-name">{r.x.ten}</span>
        <span className="xn-val">{r.raw}<small> {r.x.dv}</small>{r.f === 'cao' ? <em>↑ Cao</em> : r.f === 'thap' ? <em>↓ Thấp</em> : null}</span>
      </div>
      {r.num && r.r ? <RangeBar v={r.v} lo={r.r[0]} hi={r.r[1]} /> : null}
      <small className="xn-ref">{(sex === 'nu' ? r.x.tcNu : r.x.tcNam) ? `Tham chiếu: ${sex === 'nu' ? r.x.tcNu : r.x.tcNam} ${r.x.dv}` : ''}</small>
    </div>
  );
  return (
    <>
      <div className="summary">
        <div><b>{rows.length}</b><span>chỉ số</span></div>
        <div className={bad.length ? 'warn' : 'good'}><b>{bad.length}</b><span>cần chú ý</span></div>
        <div className="good"><b>{ok.length}</b><span>bình thường</span></div>
      </div>
      {bad.length > 0 && <div className="card"><h3 className="sec warn">Cần chú ý</h3>{bad.map((r) => <Row key={r.x.ma} r={r} />)}</div>}
      {ok.length > 0 && <div className="card"><h3 className="sec">Trong giới hạn bình thường</h3>{ok.map((r) => <Row key={r.x.ma} r={r} />)}</div>}
      <p className="foot">Khoảng tham chiếu chỉ mang tính tham khảo; kết luận do bác sĩ đưa ra.</p>
    </>
  );
}

/* ---------------- Tiền sử & lần khám ---------------- */
export function TienSuView({ items }: { items: ParentItem[] }) {
  const lk = data<LanKham>(latestOf(items, 'lankham'));
  const ts = data<TienSu>(latestOf(items, 'tiensu'));
  if (!lk && !ts) return <Empty icon="clipboard" text="Chưa có thông tin tiền sử và lần khám." />;
  return (
    <>
      <div className="card">
        <h3 className="sec"><Icon n="calendar" size={16} /> Lần khám</h3>
        {lk ? (
          <>
            <div className="kv"><span>Ngày khám</span><b>{fmtDate(lk.ngayKham)}</b></div>
            <div className="kv"><span>Lý do khám</span><b>{lk.lyDo || '—'}</b></div>
            {lk.ghiChu && <div className="note-box">{lk.ghiChu}</div>}
          </>
        ) : <p className="muted">Chưa có thông tin.</p>}
      </div>
      <div className="card">
        <h3 className="sec"><Icon n="clipboard" size={16} /> Tiền sử bệnh tật</h3>
        {ts?.co?.length ? <div className="chips">{ts.co.map((c) => <span key={c} className="chip">{c}</span>)}</div> : <p className="muted">Không ghi nhận tiền sử bệnh.</p>}
        {ts?.ghiChu && <div className="note-box">{ts.ghiChu}</div>}
      </div>
    </>
  );
}

/* ---------------- Kết luận ---------------- */
export function KetLuanView({ items }: { items: ParentItem[] }) {
  const it = latestOf(items, 'ketluan');
  const kl = data<KetLuan>(it);
  if (!kl) return <Empty icon="shield" text="Chưa có kết luận của bác sĩ." />;
  const n = loaiOf(kl.loai);
  return (
    <>
      <div className={`card verdict l${n}`}>
        <div className="verdict-ring"><b>{n || '–'}</b><small>Loại</small></div>
        <div>
          <span className="eyebrow">Phân loại sức khỏe</span>
          <div className="verdict-t">{n ? LOAI[n] : 'Chưa phân loại'}</div>
          {kl.ngay && <small className="muted">Ngày kết luận {fmtDate(kl.ngay)}</small>}
        </div>
      </div>
      {kl.chanDoan?.length > 0 && (
        <div className="card">
          <h3 className="sec">Chẩn đoán</h3>
          {kl.chanDoan.map((c, i) => <div key={i} className="dx"><code>{c[0]}</code><span>{c[1]}</span></div>)}
        </div>
      )}
      <div className="card">
        <h3 className="sec">Kết luận của bác sĩ</h3>
        <blockquote className="quote">{kl.ketLuan || 'Chưa có kết luận.'}</blockquote>
        {it?.authorName && <small className="muted">— {it.authorName}</small>}
      </div>
      <p className="foot">Nếu có điều chưa rõ, vui lòng liên hệ nhà trường hoặc cơ sở khám để được bác sĩ tư vấn.</p>
    </>
  );
}

export type { HanhChinh };
