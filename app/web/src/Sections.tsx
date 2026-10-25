import { useState, type ReactNode } from 'react';
import {
  DAN_TOC, DIA_CHI, DOI_TUONG, LAM_SANG, MAU_NHANH, MAU_XN, NGHE_NGHIEP, NGUON_CHI_TRA, NHOM_MAU, PHAN_LOAI, QUAN_HE, TIEN_SU, flag, searchXetNghiem, xetNghiemOf, type LamSangData, type Sex,
} from './data/catalog.js';
import { IcdPicker } from './IcdPicker.js';
import { bmi, tuoi, type CanLamSang, type HanhChinh, type KetLuan, type LanKham, type TheLuc, type TienSu } from './model.js';

interface P<T> { d: T; set: (v: T) => void; off: boolean }

export const F = ({ label, children, req }: { label: string; children: ReactNode; req?: boolean }) => (
  <>
    <label className="lbl">{label}{req && ' *'}</label>
    <div className="ctl">{children}</div>
  </>
);
const Strip = ({ children }: { children: ReactNode }) => <div className="strip">{children}</div>;
const Opts = ({ list }: { list: readonly string[] }) => <>{list.map((x) => <option key={x}>{x}</option>)}</>;

export function PanelHanhChinh({ d, set, off, child, lockCccd }: P<HanhChinh> & { child: boolean; lockCccd: boolean }) {
  const u = (p: Partial<HanhChinh>) => set({ ...d, ...p });
  const g = (p: Partial<HanhChinh['giamHo']>) => set({ ...d, giamHo: { ...d.giamHo, ...p } });
  return (
    <>
      <Strip>Thông tin Hành chính</Strip>
      <div className="fgrid">
        <F label="1. Họ và tên" req><input disabled={off} placeholder="NHẬP HỌ TÊN" value={d.hoTen} onChange={(e) => u({ hoTen: e.target.value.toUpperCase() })} /></F>
        <F label="2. Giới tính">
          <label className="radio"><input type="radio" disabled={off} checked={d.gioiTinh === 'nam'} onChange={() => u({ gioiTinh: 'nam' })} /> Nam</label>
          <label className="radio"><input type="radio" disabled={off} checked={d.gioiTinh === 'nu'} onChange={() => u({ gioiTinh: 'nu' })} /> Nữ</label>
        </F>
        <F label="3. Ngày sinh" req><input type="date" disabled={off} value={d.ngaySinh} onChange={(e) => u({ ngaySinh: e.target.value })} /></F>

        <F label="Tuổi"><input disabled readOnly value={tuoi(d.ngaySinh)} /></F>
        <F label="4. Số định danh cá nhân" req><input disabled={off || lockCccd} placeholder="Nhập số CCCD" maxLength={12} value={d.cccd} onChange={(e) => u({ cccd: e.target.value.replace(/\D/g, '') })} /></F>
        <F label="5. Ngày cấp"><input type="date" disabled={off} value={d.ngayCap} onChange={(e) => u({ ngayCap: e.target.value })} /></F>

        <F label="Nơi cấp"><input disabled={off} placeholder="Nơi cấp" value={d.noiCap} onChange={(e) => u({ noiCap: e.target.value })} /></F>
        <F label="6. Dân tộc"><select disabled={off} value={d.danToc} onChange={(e) => u({ danToc: e.target.value })}><Opts list={DAN_TOC} /></select></F>
        <F label="7. Đối tượng khám"><select disabled={off} value={d.doiTuong} onChange={(e) => u({ doiTuong: e.target.value })}><option /><Opts list={DOI_TUONG} /></select></F>

        <F label="8. Nguồn chi trả" req><select disabled={off} value={d.nguonChiTra} onChange={(e) => u({ nguonChiTra: e.target.value })}><option /><Opts list={NGUON_CHI_TRA} /></select></F>
        <F label="9. Nhóm máu"><select disabled={off} value={d.nhomMau} onChange={(e) => u({ nhomMau: e.target.value })}><option /><Opts list={NHOM_MAU} /></select></F>
        <F label="Điện thoại"><input disabled={off} placeholder="Nhập số điện thoại" maxLength={10} value={d.dienThoai} onChange={(e) => u({ dienThoai: e.target.value.replace(/\D/g, '') })} /></F>

        <F label="10. Nơi ở hiện tại: Tỉnh/Thành phố">
          <input list="dl-tinh" disabled={off} placeholder="Tìm tỉnh" value={d.tinh} onChange={(e) => u({ tinh: e.target.value })} />
          <datalist id="dl-tinh">{Object.keys(DIA_CHI).map((t) => <option key={t} value={t} />)}</datalist>
        </F>
        <F label="Phường/Xã">
          <input list="dl-xa" disabled={off} placeholder="Tìm xã" value={d.phuongXa} onChange={(e) => u({ phuongXa: e.target.value })} />
          <datalist id="dl-xa">{(DIA_CHI[d.tinh] ?? []).map((t) => <option key={t} value={t} />)}</datalist>
        </F>
        <F label="Lớp"><input disabled={off} placeholder="Lớp" value={d.lop ?? ''} onChange={(e) => u({ lop: e.target.value })} /></F>
        <label className="lbl">Số nhà/thôn/xóm</label>
        <div className="ctl wide"><input disabled={off} placeholder="Nhập địa chỉ chi tiết" value={d.diaChi} onChange={(e) => u({ diaChi: e.target.value })} /></div>
        <label className="lbl">Nghề nghiệp</label>
        <div className="ctl wide"><select disabled={off} value={d.ngheNghiep ?? ''} onChange={(e) => u({ ngheNghiep: e.target.value })}><option /><Opts list={NGHE_NGHIEP} /></select></div>
      </div>

      {child && (
        <>
          <div className="subhead">Thông tin người giám hộ và lần khám</div>
          <div className="fgrid">
            <F label="11. Họ tên người đi cùng trẻ / Người giám hộ (đối với trẻ dưới 16 tuổi)"><input disabled={off} placeholder="Nhập tên người giám hộ" value={d.giamHo.hoTen} onChange={(e) => g({ hoTen: e.target.value })} /></F>
            <label className="lbl">Mối quan hệ</label>
            <div className="ctl wide">
              {QUAN_HE.map((q) => <label key={q} className="radio"><input type="radio" disabled={off} checked={d.giamHo.quanHe === q} onChange={() => g({ quanHe: q })} /> {q}</label>)}
            </div>
            <F label="12. Số định danh người giám hộ"><input disabled={off} placeholder="Nhập số CCCD người giám hộ" maxLength={12} value={d.giamHo.cccd} onChange={(e) => g({ cccd: e.target.value.replace(/\D/g, '') })} /></F>
            <F label="Số điện thoại người giám hộ"><input disabled={off} placeholder="Nhập số điện thoại người giám hộ" maxLength={10} value={d.giamHo.dienThoai} onChange={(e) => g({ dienThoai: e.target.value.replace(/\D/g, '') })} /></F>
          </div>
        </>
      )}
    </>
  );
}

export function PanelLanKham({ d, set, off }: P<LanKham>) {
  return (
    <>
      <Strip>Thông tin lần khám</Strip>
      <div className="fgrid two">
        <F label="Ngày khám"><input type="date" disabled={off} value={d.ngayKham} onChange={(e) => set({ ...d, ngayKham: e.target.value })} /></F>
        <F label="Lý do khám"><input disabled={off} value={d.lyDo} onChange={(e) => set({ ...d, lyDo: e.target.value })} /></F>
        <F label="Ghi chú"><textarea disabled={off} rows={3} value={d.ghiChu} onChange={(e) => set({ ...d, ghiChu: e.target.value })} /></F>
      </div>
    </>
  );
}

export function PanelTienSu({ d, set, off }: P<TienSu>) {
  const toggle = (k: string) => set({ ...d, co: d.co.includes(k) ? d.co.filter((x) => x !== k) : [...d.co, k] });
  return (
    <>
      <Strip>Tiền sử bệnh tật</Strip>
      <div className="checks">
        {TIEN_SU.map((k) => <label key={k} className="radio"><input type="checkbox" disabled={off} checked={d.co.includes(k)} onChange={() => toggle(k)} /> {k}</label>)}
      </div>
      <div className="fgrid two"><F label="Mô tả chi tiết"><textarea disabled={off} rows={3} value={d.ghiChu} onChange={(e) => set({ ...d, ghiChu: e.target.value })} /></F></div>
    </>
  );
}

export function PanelTheLuc({ d, set, off }: P<TheLuc>) {
  const f = (k: keyof TheLuc, label: string, unit: string) => (
    <F label={`${label} (${unit})`}><input type="number" step="any" disabled={off} value={d[k] as string} onChange={(e) => set({ ...d, [k]: e.target.value })} /></F>
  );
  return (
    <>
      <Strip>Khám thể lực</Strip>
      <div className="fgrid two">
        {f('chieuCao', 'Chiều cao', 'cm')}{f('canNang', 'Cân nặng', 'kg')}
        <F label="BMI"><input disabled readOnly value={bmi(d.chieuCao, d.canNang)} /></F>
        {f('mach', 'Mạch', 'lần/phút')}{f('huyetApTT', 'Huyết áp tâm thu', 'mmHg')}{f('huyetApTTr', 'Huyết áp tâm trương', 'mmHg')}
        {f('nhipTho', 'Nhịp thở', 'lần/phút')}{f('nhietDo', 'Nhiệt độ', '°C')}
        <F label="Phân loại thể lực"><select disabled={off} value={d.loai} onChange={(e) => set({ ...d, loai: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Loại {n}</option>)}</select></F>
      </div>
    </>
  );
}

export interface SignMeta { name: string; ok: boolean; deviceId: string }

/** Khám lâm sàng: mỗi chuyên khoa một khối (một bản ghi mã hoá riêng), mỗi mục có Kết quả + Phân loại; bên phải là họ tên và CHỮ KÝ SỐ của bác sĩ. */
export function PanelLamSang({ ls, setLs, can, denied, child, meta, onNormal, onClear, onLoad }: {
  ls: Record<string, LamSangData>; setLs: (k: string, v: LamSangData) => void;
  can: (khoa: string) => boolean; denied: Record<string, boolean>; child: boolean;
  meta: Record<string, SignMeta | undefined>;
  onNormal: () => void; onClear: () => void; onLoad: (name: string) => void;
}) {
  const [mau, setMau] = useState('');
  const shown = LAM_SANG.filter((k) => child || k.khoa !== 'Nhi');
  const letter = (i: number) => String.fromCharCode(97 + i);
  return (
    <>
      <div className="strip stripbar">
        <span>Khám lâm sàng</span>
        <span className="stripactions">
          <button className="act" onClick={onNormal}>💾 Điền giá trị bình thường</button>
          <button className="act" onClick={onClear}>✕ Xóa</button>
          <label>Load:</label>
          <select value={mau} onChange={(e) => { setMau(e.target.value); if (e.target.value) onLoad(e.target.value); }}>
            <option value="" />{Object.keys(MAU_NHANH).map((m) => <option key={m}>{m}</option>)}
          </select>
        </span>
      </div>
      {shown.map((k, idx) => {
        const d = ls[k.khoa];
        const off = !can(k.khoa);
        const m = meta[k.khoa];
        return (
          <div key={k.khoa} className="lsblock">
            <h3>{idx + 1}. {k.ten} {denied[k.khoa] && <span className="lock">🔒 Bạn không có thuộc tính để đọc mục này</span>}</h3>
            {!denied[k.khoa] && d && (
              <div className="lsgrid">
                <div>
                  {k.muc.map((name, i) => (
                    <div key={name} className="lsitem">
                      <div className="lsname">{letter(i)},&nbsp; {name}</div>
                      <div className="lsline"><label className="lbl">Kết quả</label>
                        <input disabled={off} placeholder="Nhập kết quả khám" value={d[name]?.kq ?? ''} onChange={(e) => setLs(k.khoa, { ...d, [name]: { loai: d[name]?.loai ?? '', kq: e.target.value } })} /></div>
                      <div className="lsline"><label className="lbl">Phân loại</label>
                        <select disabled={off} value={d[name]?.loai ?? ''} onChange={(e) => setLs(k.khoa, { ...d, [name]: { kq: d[name]?.kq ?? '', loai: e.target.value } })}>
                          <option value="" />{PHAN_LOAI.map((p) => <option key={p} value={p}>Loại {p}</option>)}
                        </select></div>
                    </div>
                  ))}
                </div>
                <div className="signbox">
                  <div className="signhead">Họ tên và chữ ký bác sĩ</div>
                  {m ? (
                    <div className={m.ok ? 'stamp ok' : 'stamp bad'}>
                      <b>{m.name}</b>
                      <div>{m.ok ? '✔ Chữ ký số hợp lệ' : '✘ CHỮ KÝ KHÔNG HỢP LỆ'}</div>
                      <small>thiết bị {m.deviceId}</small>
                      <small>chứng chỉ do registry cấp</small>
                    </div>
                  ) : <div className="stamp none">Chưa ký<br /><small>sẽ được ký số bằng khoá thiết bị khi lưu</small></div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Cận lâm sàng - Xét nghiệm: chọn mẫu ("Ksk thường quy"...) hoặc tìm thêm chỉ số theo mã/tên trong 391 chỉ số chuẩn; chỉ các chỉ số đã chọn mới hiện ra. */
export function PanelCanLamSang({ d, set, off, sex, child }: P<CanLamSang> & { sex: Sex; child?: boolean }) {
  const mau = child ? MAU_XN.child : MAU_XN.adult;
  const [q, setQ] = useState('');
  const keys = Object.keys(d.kq);
  const codes = keys.length ? keys : (mau[0]?.ma ?? []);          // chưa chọn gì: hiện sẵn mẫu mặc định
  const base = () => (keys.length ? d.kq : Object.fromEntries((mau[0]?.ma ?? []).map((m) => [m, ''])));
  const put = (ma: string, v: string) => set({ ...d, gioiTinh: sex, kq: { ...base(), [ma]: v } });
  const addMany = (list: string[]) => set({ ...d, gioiTinh: sex, kq: { ...Object.fromEntries(list.map((m) => [m, ''])), ...base() } });
  const found = searchXetNghiem(q).filter((x) => !codes.includes(x.ma));
  const remove = (ma: string) => { const { [ma]: _gone, ...rest } = base(); set({ ...d, gioiTinh: sex, kq: rest }); };
  return (
    <>
      <Strip>Cận lâm sàng - Xét nghiệm</Strip>
      <div className="xnbar">
        <select disabled={off} value="" onChange={(e) => { const m = mau.find((x) => x.ten === e.target.value); if (m) addMany(m.ma); }}>
          <option value="">Thêm theo mẫu…</option>{mau.map((m) => <option key={m.ten}>{m.ten}</option>)}
        </select>
        <div className="picker">
          <input disabled={off} placeholder="Tìm chỉ số theo mã hoặc tên (vd H01, glucose, creatinin)…" value={q} onChange={(e) => setQ(e.target.value)} />
          {found.length > 0 && (
            <ul className="pickres">{found.map((x) => (
              <li key={x.ma}><a href="#" onClick={(e) => { e.preventDefault(); addMany([x.ma]); setQ(''); }}>{x.ma} · {x.ten}{x.dv ? ' (' + x.dv + ')' : ''}</a></li>
            ))}</ul>
          )}
        </div>
      </div>
      <table className="grid small">
        <thead><tr><th>Mã</th><th>Chỉ số</th><th>Kết quả</th><th>Đơn vị</th><th>Tham chiếu ({sex === 'nam' ? 'nam' : 'nữ'})</th><th /><th /></tr></thead>
        <tbody>
          {codes.map((ma) => {
            const t = xetNghiemOf(ma);
            const v = d.kq[ma] ?? '';
            const numeric = !!(t && (t.nam || t.nu));
            const f = v && numeric && Number.isFinite(Number(v)) ? flag(ma, Number(v), sex) : 'binhthuong';
            return (
              <tr key={ma}>
                <td>{ma}</td><td>{t?.ten ?? ma}</td>
                <td><input type={numeric ? 'number' : 'text'} step="any" disabled={off} value={v} onChange={(e) => put(ma, e.target.value)} style={{ width: 130 }} /></td>
                <td>{t?.dv ?? ''}</td><td>{t ? (sex === 'nam' ? t.tcNam : t.tcNu) : ''}</td>
                <td className={f === 'binhthuong' ? '' : f}>{f === 'cao' ? '↑ Cao' : f === 'thap' ? '↓ Thấp' : ''}</td>
                <td>{!off && !v && <a href="#" onClick={(e) => { e.preventDefault(); remove(ma); }}>bỏ</a>}</td>
              </tr>
            );
          })}
          {!codes.length && <tr><td colSpan={7} className="muted">Chưa chọn chỉ số nào. Chọn mẫu hoặc tìm chỉ số ở trên.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

export function PanelKetLuan({ d, set, off }: P<KetLuan>) {
  return (
    <>
      <Strip>Kết luận</Strip>
      <div className="fgrid two">
        <F label="Ngày kết luận"><input type="date" disabled={off} value={d.ngay} onChange={(e) => set({ ...d, ngay: e.target.value })} /></F>
        <F label="Phân loại sức khoẻ"><select disabled={off} value={d.loai} onChange={(e) => set({ ...d, loai: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Loại {n}</option>)}</select></F>
        <F label="Chẩn đoán (ICD-10)">
          <IcdPicker off={off} onPick={(x) => { if (!d.chanDoan.some((i) => i[0] === x[0])) set({ ...d, chanDoan: [...d.chanDoan, [...x]] }); }} />
          {d.chanDoan.map((i) => <span key={i[0]} className="tag">{i[0]} {i[1]}{!off && <a href="#" onClick={(e) => { e.preventDefault(); set({ ...d, chanDoan: d.chanDoan.filter((x) => x[0] !== i[0]) }); }}> ×</a>}</span>)}
        </F>
        <F label="Kết luận"><textarea disabled={off} rows={3} value={d.ketLuan} onChange={(e) => set({ ...d, ketLuan: e.target.value })} /></F>
      </div>
    </>
  );
}
