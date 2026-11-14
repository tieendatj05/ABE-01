// LỚP DỮ LIỆU của app TRA CỨU SỨC KHỎE (đăng nhập bằng TÀI KHOẢN, quyền đọc do ABE quyết định — KHÔNG còn đường "CCCD + họ tên" không tài khoản).
// Mục tiêu: máy khác vừa nhập xong thì app này thấy NGAY:
//   - mỗi 3 giây hỏi "dấu vân tay" hồ sơ của bệnh nhân đang xem (GET /api/records/version?patientIdx=, rất nhẹ, chỉ tính mục tài khoản này được xem);
//   - đổi giá trị mới tải lại danh sách và CHỈ giải mã các mục MỚI (mục đã giải mã được nhớ theo id trong bộ nhớ, không ghi ra đĩa);
//   - người ta mới nhập một bệnh nhân mà chưa ai có dữ liệu thì app vẫn chờ và tự hiện ra khi có mục đầu tiên.
// Không lưu gì ra đĩa: dữ liệu sức khỏe chỉ nằm trong bộ nhớ của trang này và mất khi đóng / đăng xuất.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BusinessHoursError, openImage, type ImageView, type OpenResult, type ParentItem, type RecordRow } from '../../../security/src/index.js';
import { session } from '../../web/src/session.js';
import { sachTenAll } from '../../web/src/ten.js';

export interface ImgGroup { key: string; view: ImageView | null }
export interface PatientData { items: ParentItem[]; images: ImgGroup[]; restricted: number; loadedAt: string; total: number }
export interface Person { hoTen: string; cccd: string }

/** Chuẩn hoá để so khớp tên không phân biệt hoa/thường và dấu tiếng Việt. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
export const isCccd = (s: string) => /^\d{12}$/.test(s.trim());

export const friendly = (e: unknown): string => {
  if (e instanceof BusinessHoursError) return e.message;
  const m = (e as Error)?.message ?? String(e);
  if (/MFA_REQUIRED/.test(m)) return 'Tài khoản này cần xác thực MFA — hãy dùng app nhân viên để xác thực.';
  if (/ACCESS_REASON_REQUIRED/.test(m)) return 'Tài khoản này phải nêu lý do mỗi lần đọc — hãy dùng app nhân viên.';
  if (/failed to fetch|networkerror|load failed|network request|abort|timeout/i.test(m)) return 'Không kết nối được máy chủ. Hãy kiểm tra mạng nội bộ rồi thử lại.';
  return m;
};

/** Hồ sơ MỘT bệnh nhân, tự cập nhật. `code` = CCCD 12 số (null = chưa chọn ai). */
export function usePatient(code: string | null, ready: boolean) {
  const [data, setData] = useState<PatientData | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [changedAt, setChangedAt] = useState<number>(0);          // lần gần nhất dữ liệu đổi do người khác nhập (để giao diện nháy "Vừa cập nhật")
  const opened = useRef(new Map<string, OpenResult | null>());    // id bản ghi -> đã giải mã
  const imgs = useRef(new Map<string, ImageView | null>());       // khoá nhóm ảnh -> ảnh đã ghép
  const ver = useRef('');
  const busy = useRef(false);

  const load = useCallback(async (silent: boolean) => {
    const c = session.client;
    if (!c || !code || busy.current) return;
    busy.current = true; if (!silent) setSyncing(true);
    try {
      const v = await c.patientVersion(code).catch(() => ver.current);    // lấy dấu vân tay TRƯỚC khi tải: thay đổi trong lúc tải sẽ bị bắt ở lần hỏi kế tiếp
      const rows = await c.listRecords(code);
      const plain = rows.filter((r) => r.type !== 'anh' && r.type !== 'vung');
      const todo = plain.filter((r) => !opened.current.has(r.id));
      if (todo.length) { const res = sachTenAll(await c.openMany(todo)); todo.forEach((r, i) => opened.current.set(r.id, res[i])); }
      const items: ParentItem[] = plain.flatMap((r) => { const o = opened.current.get(r.id); return o ? [{ type: r.type, khoa: r.khoa, data: o.data, ts: r.createdAt, authorName: o.author.name }] : []; });

      const by = new Map<string, RecordRow[]>();
      for (const r of rows) if ((r.type === 'anh' || r.type === 'vung') && r.refId) (by.get(r.refId) ?? by.set(r.refId, []).get(r.refId)!).push(r);
      const images: ImgGroup[] = [];
      for (const [id, rs] of by) {
        const key = id + '|' + rs.map((r) => r.id).sort().join(',');
        if (!imgs.current.has(key)) imgs.current.set(key, await openImage(c, rs));
        images.push({ key, view: imgs.current.get(key) ?? null });
      }
      const first = ver.current === '';
      ver.current = v;
      setData({ items, images, restricted: c.restrictedCount(code), loadedAt: new Date().toISOString(), total: rows.length });
      setError(''); setLive(true);
      if (!first) setChangedAt(Date.now());
    } catch (e) { setError(friendly(e)); setLive(false); }
    finally { busy.current = false; setSyncing(false); }
  }, [code]);

  useEffect(() => {
    opened.current.clear(); imgs.current.clear(); ver.current = ''; setData(null); setError(''); setChangedAt(0);
    if (!code || !ready) return;
    let stop = false;
    void load(false);
    const tick = async () => {
      const c = session.client;
      if (stop || !c || document.visibilityState !== 'visible' || busy.current || !session.connectionReady) return;
      try {
        const v = await c.patientVersion(code);
        setLive(true);
        if (!ver.current || v !== ver.current) await load(true);
      } catch (e) { setLive(false); if (!(e instanceof BusinessHoursError)) setError(friendly(e)); }
    };
    const t = setInterval(() => void tick(), 3000);
    const vis = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [code, ready, load]);

  return { data, error, live, syncing, changedAt, refresh: () => load(false) };
}

/**
 * Danh sách bệnh nhân của một đơn vị để TRA THEO TÊN (giải mã trên máy này, chỉ các hồ sơ hành chính tài khoản đọc được).
 * Chỉ tải khi `enabled` (người dùng bắt đầu gõ tên); sau đó 4 giây hỏi một lần: có người đăng ký thêm bệnh nhân ở máy khác thì danh sách tự thêm.
 */
export function usePeople(unit: string, enabled: boolean, ready: boolean) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const opened = useRef(new Map<string, OpenResult | null>());
  const ver = useRef('');
  const busy = useRef(false);

  const load = useCallback(async () => {
    const c = session.client;
    if (!c || busy.current) return;
    busy.current = true; setLoading(true);
    try {
      const v = await c.groupVersion(unit).catch(() => ver.current);
      const all = await c.listGroup(unit);
      const latest = new Map<string, RecordRow>();
      for (const r of all) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
      const todo = [...latest.values()].filter((r) => !opened.current.has(r.id));
      if (todo.length) { const res = sachTenAll(await c.openMany(todo)); todo.forEach((r, i) => opened.current.set(r.id, res[i])); }
      const list = [...latest.values()].flatMap((r) => { const d = opened.current.get(r.id)?.data as { hoTen?: string; cccd?: string } | undefined; return d?.cccd && isCccd(d.cccd) ? [{ hoTen: d.hoTen ?? '', cccd: d.cccd }] : []; });
      ver.current = v; setPeople(list); setError('');
    } catch (e) {
      const m = (e as Error).message ?? '';
      setError(/khoá chỉ mục/.test(m) ? 'Tài khoản này không tra được theo tên. Hãy gõ đủ 12 số CCCD.' : friendly(e));
    } finally { busy.current = false; setLoading(false); }
  }, [unit]);

  useEffect(() => { opened.current.clear(); ver.current = ''; setPeople(null); setError(''); }, [unit]);
  useEffect(() => {
    if (!enabled || !ready) return;
    let stop = false;
    void load();
    const t = setInterval(() => {
      const c = session.client;
      if (stop || !c || busy.current || document.visibilityState !== 'visible' || !session.connectionReady) return;
      void c.groupVersion(unit).then((v) => { if (!stop && ver.current && v !== ver.current) return load(); }).catch(() => undefined);
    }, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [enabled, ready, unit, load]);

  return { people, error, loading };
}
