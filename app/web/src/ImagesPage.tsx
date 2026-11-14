import { useCallback, useEffect, useRef, useState } from 'react';
import { adviseImage, dicomToRgba, listImages, looksLikeDicom, openImage, parseDicom, saveImage, sortSlices, type Advice, type DicomSlice, type ImageView, type Rect, type Rgba } from '../../../security/src/index.js';
import { canWrite } from './model.js';
import { session } from './session.js';
import { sachTenAll } from './ten.js';
import { adviseFace } from './face.js';
import { log, run } from './ui.js';

// ẢNH CT/MRI THEO VÙNG (ảnh 2D). Người nhập khoanh vùng thủ công và gán chuyên khoa từ DANH MỤC; mỗi vùng có khoá riêng, bác sĩ chỉ nhận/giải mã vùng của khoa mình.
// Phạm vi: ảnh 2D PNG/JPEG (và chuỗi lát cắt 2D có thứ tự); KHÔNG đọc DICOM và KHÔNG dựng khối 3D. Tên tệp KHÔNG được lưu (tránh đưa định danh vào nhãn ảnh).
const KHOAS: [string, string][] = [['Nhi', 'Nhi'], ['ThanKinh', 'Thần kinh'], ['Mat', 'Mắt'], ['TMH', 'Tai - Mũi - Họng'], ['RHM', 'Răng - Hàm - Mặt'], ['KSK', 'Khám chung (KSK)'], ['XetNghiem', 'Xét nghiệm']];
const kLabel = (k: string) => KHOAS.find(([c]) => c === k)?.[1] ?? k;
const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080'];
const MAX_SIDE = 2048;

interface Draft { rect: Rect; khoas: string[]; label: string }

async function decodeFile(file: File): Promise<{ pixels: Rgba; bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(file);
  if (bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE) throw new Error(`Ảnh quá lớn (${bitmap.width}x${bitmap.height}); tối đa ${MAX_SIDE}x${MAX_SIDE} điểm ảnh.`);
  const cv = document.createElement('canvas'); cv.width = bitmap.width; cv.height = bitmap.height;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height);
  return { pixels: { w: cv.width, h: cv.height, data: new Uint8Array(d.data.buffer.slice(0)) }, bitmap };
}

/** Điểm ảnh -> PNG 8 bit (không mất mát). Dùng làm "ảnh gốc" khi nguồn là DICOM (bản DICOM 16 bit nguyên văn KHÔNG được lưu). */
async function rgbaToPng(px: Rgba): Promise<Uint8Array> {
  const cv = document.createElement('canvas'); cv.width = px.w; cv.height = px.h;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
  const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('Không tạo được PNG từ lát cắt');
  return new Uint8Array(await blob.arrayBuffer());
}
const toBitmap = (px: Rgba) => createImageBitmap(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h));
interface SeriesItem { slice: DicomSlice; px: Rgba; advice: Advice }
const DECISION_TEXT: Record<Advice['decision'], string> = {
  DE_XUAT: '✔ Nhận ra nguồn — có đề xuất vùng/khoa',
  CHI_TAC_GIA: '🔒 Không nhận ra nguồn — mặc định CHỈ NGƯỜI NHẬP xem được',
  BO_QUA_LAT: '∅ Lát gần như rỗng — nên bỏ qua',
};

export function PixelCanvas({ px }: { px: Rgba }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    cv.width = px.w; cv.height = px.h;
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
  }, [px]);
  return <canvas ref={ref} className="imgcanvas" aria-label="Ảnh theo vùng được phép" style={{ maxWidth: '100%', background: 'repeating-conic-gradient(#d9dee3 0% 25%, #f3f5f7 0% 50%) 0 0/16px 16px', border: '1px solid #b8c2cc' }} />;
}

/**
 * Hiển thị một ảnh đã giải mã. Người có ẢNH GỐC (tác giả, hoặc Giám sát đã qua MFA) xem ảnh gốc NGUYÊN VẸN; người chỉ có một số vùng (bác sĩ khoa) xem các vùng
 * được cấp dán lên nền trống — phần ngoài quyền không có trên máy nên không thể vẽ.
 */
export function ViewCanvas({ view }: { view: { pixels: Rgba; original?: { mime: string; bytes: Uint8Array } } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    let dead = false;
    const drawPixels = () => {
      cv.width = view.pixels.w; cv.height = view.pixels.h;
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(view.pixels.data), view.pixels.w, view.pixels.h), 0, 0);
    };
    const o = view.original;
    if (!o) { drawPixels(); return; }
    createImageBitmap(new Blob([o.bytes as BlobPart], { type: o.mime }))
      .then((bm) => { if (dead) { bm.close(); return; } cv.width = bm.width; cv.height = bm.height; cv.getContext('2d')!.drawImage(bm, 0, 0); bm.close(); })
      .catch(() => { if (!dead) drawPixels(); });      // không giải mã được tệp gốc: vẫn hiện các vùng
    return () => { dead = true; };
  }, [view]);
  return <canvas ref={ref} className="imgcanvas" aria-label={view.original ? 'Ảnh gốc đầy đủ' : 'Ảnh theo vùng được phép'} style={{ maxWidth: '100%', background: 'repeating-conic-gradient(#d9dee3 0% 25%, #f3f5f7 0% 50%) 0 0/16px 16px', border: '1px solid #b8c2cc' }} />;
}

/** Chuẩn hoá để so khớp tên không phân biệt hoa/thường và dấu tiếng Việt. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

export function ImagesPage({ unit }: { unit: string }) {
  const c = session.client!;
  const canUpload = canWrite('anh', c.s.attrs);
  const [cccd, setCccd] = useState('');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<{ hoTen: string; cccd: string }[] | null>(null);   // danh sách hồ sơ hành chính mà tài khoản này GIẢI MÃ được (giải mã trên máy này)
  const loadPeople = async () => {
    if (people) return people;
    const all = await c.listGroup(unit);
    const latest = new Map<string, (typeof all)[number]>();
    for (const r of all) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
    const opened = sachTenAll(await c.openMany([...latest.values()]));
    const list = opened.flatMap((o) => { const d = o?.data as { hoTen?: string; cccd?: string } | undefined; return d?.cccd && /^\d{12}$/.test(d.cccd) ? [{ hoTen: d.hoTen ?? '', cccd: d.cccd }] : []; });
    setPeople(list); return list;
  };
  const matches = (() => {
    const q = fold(query); if (!people || q.length < 2 || /^\d{12}$/.test(query.trim())) return [];
    return people.filter((p) => fold(p.hoTen).includes(q) || p.cccd.includes(q.replace(/\s/g, ''))).slice(0, 8);
  })();
  // Gõ số 12 chữ số = CCCD; gõ chữ/số một phần = tìm theo họ tên hoặc CCCD trong các hồ sơ tài khoản này đọc được.
  const onQuery = (v: string) => {
    setQuery(v);
    const t = v.trim();
    setCccd(/^\d{12}$/.test(t) ? t : '');
    if (t.length >= 2 && !people) void run('Tải danh sách bệnh nhân để tra cứu', async () => { await loadPeople(); });
  };
  const choose = (p: { hoTen: string; cccd: string }) => { setQuery(`${p.hoTen} · ${p.cccd}`); setCccd(p.cccd); void search(p.cccd); };
  const [groups, setGroups] = useState<{ imageId: string; rows: Awaited<ReturnType<typeof listImages>>[number]['rows'] }[]>([]);
  const [views, setViews] = useState<Record<string, ImageView | null>>({});
  const [searched, setSearched] = useState('');
  // tải ảnh mới
  const [pixels, setPixels] = useState<Rgba | null>(null);
  const [orig, setOrig] = useState<{ mime: string; bytes: Uint8Array } | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [modality, setModality] = useState<'CT' | 'MRI' | 'KHAC'>('CT');
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  // DICOM nhiều lát + trợ lý gợi ý
  const [series, setSeries] = useState<SeriesItem[] | null>(null);
  const [sliceIdx, setSliceIdx] = useState(0);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [ack, setAck] = useState(false);
  const [openSlice, setOpenSlice] = useState<Record<string, number>>({});    // thẻ ảnh theo chuỗi: lát đang xem
  const needAck = !!advice?.needsAck && !ack;
  const faceToken = useRef(0);                                           // tăng mỗi khi đổi/xóa ảnh để bỏ kết quả nhận dạng khuôn mặt của ảnh cũ

  const search = (code = cccd) => run('Tra cứu ảnh', async () => {
    if (!/^\d{12}$/.test(code)) throw new Error('Chọn một bệnh nhân trong danh sách gợi ý hoặc nhập đủ 12 chữ số CCCD');
    const gs = await listImages(c, code);
    const v: Record<string, ImageView | null> = {};
    for (const g of gs) v[g.imageId] = await openImage(c, g.rows);            // chỉ giải mã vùng người này được phép
    setGroups(gs); setViews(v); setSearched(code);
    log(gs.length ? `Có ${gs.length} ảnh bạn được phép xem (một phần).` : 'Không có ảnh nào bạn được phép xem cho hồ sơ này.', gs.length ? 'ok' : 'warn');
  });

  // vẽ ảnh + các vùng khoanh trên canvas soạn thảo
  const redraw = useCallback(() => {
    const cv = cvRef.current; if (!cv || !bitmap) return;
    cv.width = bitmap.width; cv.height = bitmap.height;
    const g = cv.getContext('2d')!; g.drawImage(bitmap, 0, 0);
    g.lineWidth = Math.max(2, bitmap.width / 300); g.font = `${Math.max(12, bitmap.width / 40)}px sans-serif`;
    drafts.forEach((d, i) => { g.strokeStyle = g.fillStyle = COLORS[i % COLORS.length]; g.strokeRect(d.rect.x, d.rect.y, d.rect.w, d.rect.h); g.fillText(String(i + 1), d.rect.x + 4, d.rect.y + Math.max(14, bitmap.width / 40)); });
    if (drag) { g.strokeStyle = '#000'; g.setLineDash([6, 4]); g.strokeRect(Math.min(drag.x, drag.x2), Math.min(drag.y, drag.y2), Math.abs(drag.x2 - drag.x), Math.abs(drag.y2 - drag.y)); g.setLineDash([]); }
  }, [bitmap, drafts, drag]);
  useEffect(redraw, [redraw]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * e.currentTarget.width), y: Math.round(((e.clientY - r.top) / r.height) * e.currentTarget.height) };
  };
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

  /** Đưa một lát DICOM (đã quy về xám 8 bit) vào vùng soạn thảo. "Ảnh gốc" lưu là PNG 8 bit của lát đó. */
  const showSlice = async (list: SeriesItem[], i: number) => {
    const it = list[i];
    faceToken.current++;
    setSliceIdx(i); setPixels(it.px); setBitmap(await toBitmap(it.px)); setDrafts([]); setAdvice(it.advice);
    setOrig({ mime: 'image/png', bytes: await rgbaToPng(it.px) });
    setModality(/^CT$/i.test(it.slice.meta.modality) ? 'CT' : /^MR$/i.test(it.slice.meta.modality) ? 'MRI' : 'KHAC');
  };

  const pick = (files: FileList | null) => run('Mở ảnh', async () => {
    const list = Array.from(files ?? []); if (!list.length) return;
    setAck(false); setSeries(null);
    const first = new Uint8Array(await list[0].arrayBuffer());
    if (looksLikeDicom(first)) {
      const slices: DicomSlice[] = []; const bad = new Map<string, number>();
      for (const f of list) {
        try {
          const slice = parseDicom(new Uint8Array(await f.arrayBuffer()));
          if (slices.length && (slice.meta.rows !== slices[0].meta.rows || slice.meta.cols !== slices[0].meta.cols)) throw new Error('lát khác kích thước các lát còn lại (không cùng một chuỗi)');
          slices.push(slice);
        } catch (e) { bad.set((e as Error).message, (bad.get((e as Error).message) ?? 0) + 1); }
      }
      if (!slices.length) throw new Error([...bad.keys()][0] ?? 'Không đọc được tệp DICOM nào');
      const sorted: SeriesItem[] = sortSlices(slices).map((slice) => { const px = dicomToRgba(slice); return { slice, px, advice: adviseImage(px, slice.meta) }; });
      setSeries(sorted);
      const useful = sorted.flatMap((s, i) => (s.advice.decision !== 'BO_QUA_LAT' ? [i] : []));
      await showSlice(sorted, useful[Math.floor(useful.length / 2)] ?? 0);               // mở lát ở giữa các lát có nội dung
      log(`Đã đọc ${sorted.length} lát DICOM${bad.size ? `; bỏ qua ${[...bad.values()].reduce((a, b) => a + b, 0)} tệp (${[...bad.keys()].join('; ')})` : ''}. Chưa có gì được lưu hay gửi đi.`, bad.size ? 'warn' : 'ok');
      return;
    }
    const file = list[0];
    if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Chỉ nhận ảnh PNG/JPEG hoặc DICOM không nén (.dcm).');
    const d = await decodeFile(file);
    setPixels(d.pixels); setBitmap(d.bitmap); setDrafts([]); setAdvice(adviseImage(d.pixels));
    setOrig({ mime: file.type, bytes: first });          // byte NGUYÊN VẸN của tệp; tên tệp không được giữ
    void detectFace(d.pixels, ++faceToken.current);      // chạy nền: có khuôn mặt thì tự chia vùng Mắt / TMH / RHM
  });

  /** Nhận dạng khuôn mặt trên máy này (mô hình nằm trong app). `token` để bỏ kết quả của ảnh cũ nếu người dùng đã chọn ảnh khác. */
  const detectFace = async (px: Rgba, token: number) => {
    log('Đang tìm khuôn mặt trong ảnh (chạy ngay trên máy này, ảnh không rời máy)…');
    try {
      const adv = await adviseFace(px);
      if (token !== faceToken.current) return;
      if (!adv) { log('Không thấy khuôn mặt người trong ảnh: bạn có thể tự khoanh vùng, hoặc để chỉ người nhập xem được.', 'warn'); return; }
      setAdvice(adv); setAck(false); setModality('KHAC');          // ảnh chụp mặt không phải CT/MRI
      setDrafts((ds) => (ds.length ? ds : adv.regions.map((r) => ({ rect: r.rect, khoas: r.khoas, label: r.label }))));   // không đè lên vùng người dùng đã tự khoanh
      log(`Đã nhận diện khuôn mặt (${adv.regions.length} vùng đề xuất). Hãy xem lại các khung rồi bấm "Mã hoá và lưu".`, 'ok');
    } catch (e) {
      if (token === faceToken.current) log('Không chạy được nhận dạng khuôn mặt (' + (e as Error).message + '). Bạn vẫn có thể tự khoanh vùng.', 'warn');
    }
  };

  const applyAdvice = () => { if (advice) setDrafts(advice.regions.map((r) => ({ rect: r.rect, khoas: r.khoas, label: r.label }))); };

  /** Lưu MỌI lát có nội dung của chuỗi; mỗi lát theo đề xuất của trợ lý cho chính lát đó (nguồn không nhận ra => chỉ tác giả). */
  const saveSeries = () => run('Mã hoá và lưu cả chuỗi lát cắt', async () => {
    if (!series) return;
    if (!/^\d{12}$/.test(cccd)) throw new Error('Nhập số định danh cá nhân (12 chữ số) của bệnh nhân ở ô tra cứu trước khi lưu');
    const keep = series.filter((s) => s.advice.decision !== 'BO_QUA_LAT');
    if (!keep.length) throw new Error('Không có lát nào có nội dung để lưu');
    if (keep.length > 120) throw new Error('Chuỗi quá dài (tối đa 120 lát có nội dung mỗi lần)');
    if (!confirm(`Lưu ${keep.length} lát (bỏ ${series.length - keep.length} lát rỗng), mỗi lát có vùng theo gợi ý tự động (nếu có)?\nẢnh gốc từng lát chỉ bạn đọc được.`)) return;
    const seriesId = crypto.randomUUID(); const t0 = performance.now();
    for (const [i, s] of keep.entries()) {
      await saveImage(c, { patientCode: cccd, original: { mime: 'image/png', bytes: await rgbaToPng(s.px) }, pixels: s.px, modality: /^CT$/i.test(s.slice.meta.modality) ? 'CT' : /^MR$/i.test(s.slice.meta.modality) ? 'MRI' : 'KHAC',
        regions: s.advice.regions.map((r) => ({ rect: r.rect, khoas: r.khoas, label: r.label })), series: { id: seriesId, index: i, count: keep.length } });
      if (i % 5 === 4) log(`Đã mã hoá ${i + 1}/${keep.length} lát…`, 'ok');
    }
    log(`Đã lưu chuỗi ${keep.length} lát (${Math.round((performance.now() - t0) / 1000)} giây). Mỗi vùng một khoá riêng; chỉ bạn đọc lại được ảnh gốc từng lát.`, 'ok');
    setPixels(null); setBitmap(null); setOrig(null); setDrafts([]); setSeries(null); setAdvice(null);
    await search(cccd);
  });

  const finishDrag = () => {
    if (!drag || !pixels) { setDrag(null); return; }
    const x = clamp(Math.min(drag.x, drag.x2), pixels.w), y = clamp(Math.min(drag.y, drag.y2), pixels.h);
    const w = clamp(Math.abs(drag.x2 - drag.x), pixels.w - x), h = clamp(Math.abs(drag.y2 - drag.y), pixels.h - y);
    setDrag(null);
    if (w >= 4 && h >= 4) setDrafts((ds) => [...ds, { rect: { x, y, w, h }, khoas: [], label: '' }]);
  };
  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = () => run('Mã hoá và lưu ảnh theo vùng', async () => {
    if (!pixels || !orig) throw new Error('Chưa chọn ảnh');
    if (!/^\d{12}$/.test(cccd)) throw new Error('Nhập số định danh cá nhân (12 chữ số) của bệnh nhân ở ô tra cứu trước khi lưu');
    if (drafts.some((d) => !d.khoas.length)) throw new Error('Mỗi vùng phải được gán ít nhất một chuyên khoa');
    const t0 = performance.now();
    await saveImage(c, { patientCode: cccd, original: orig, pixels, modality, regions: drafts.map((d) => ({ rect: d.rect, khoas: d.khoas, label: d.label })) });
    log(`Đã lưu ảnh với ${drafts.length} vùng (mỗi vùng một khoá riêng, ${Math.round(performance.now() - t0)} ms). Chỉ bạn đọc lại được ảnh gốc.`, 'ok');
    faceToken.current++;
    setPixels(null); setBitmap(null); setOrig(null); setDrafts([]); setSeries(null); setAdvice(null);
    await search(cccd);
  });

  // Kết quả tra cứu: các lát của cùng một chuỗi gộp thành MỘT thẻ có thanh trượt
  const cards = (() => {
    const by = new Map<string, { key: string; items: { g: (typeof groups)[number]; v: ImageView | null }[] }>();
    for (const g of groups) {
      const v = views[g.imageId] ?? null; const key = v?.series?.id ?? g.imageId;
      (by.get(key) ?? by.set(key, { key, items: [] }).get(key)!).items.push({ g, v });
    }
    for (const c2 of by.values()) c2.items.sort((a, b) => (a.v?.series?.index ?? 0) - (b.v?.series?.index ?? 0));
    return [...by.values()];
  })();

  return (
    <div className="pagebody">
      <section>
        <h2>Ảnh CT/MRI theo vùng (ảnh 2D)</h2>
        <p style={{ marginTop: 0 }}>Mỗi vùng ảnh được mã hoá bằng <b>khoá riêng</b>, chỉ bác sĩ có chuyên khoa tương ứng (và người nhập ảnh) giải mã được. Phần ảnh ngoài vùng được cấp <b>không tồn tại trên máy bạn</b> (nền trống), không phải bị che bằng giao diện.
          Chỉ <b>người nhập ảnh</b> (tài khoản đã tải lên) xem được ảnh gốc đầy đủ; bác sĩ chỉ thấy vùng thuộc khoa mình. Phạm vi hiện tại: ảnh 2D PNG/JPEG và DICOM <b>không nén</b> (từng lát; bản lưu là PNG 8 bit của lát, không giữ đủ 16 bit); <b>chưa</b> dựng khối 3D. Đây là dữ liệu thử nghiệm, chưa dùng cho chẩn đoán.</p>
        <div className="row">
          <input style={{ minWidth: 340 }} placeholder="Họ tên hoặc số CCCD (12 số) của bệnh nhân" value={query} onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { if (cccd) void search(); else if (matches.length === 1) choose(matches[0]); } }} />
          <button disabled={cccd.length !== 12} onClick={() => void search()}>Tra cứu ảnh</button>
        </div>
        {matches.length > 0 && <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, border: '1px solid #cfd7df', borderRadius: 6, maxWidth: 520 }}>
          {matches.map((p) => <li key={p.cccd}><button className="mini2" style={{ width: '100%', textAlign: 'left' }} onClick={() => choose(p)}>{p.hoTen || '(không tên)'} · {p.cccd}</button></li>)}</ul>}
        {query.trim().length >= 2 && !cccd && people && !matches.length && <p className="hint">Không thấy hồ sơ phù hợp trong các hồ sơ <b>tài khoản này đọc được</b> của đơn vị đang chọn. Hãy gõ đủ 12 số CCCD, hoặc kiểm tra đơn vị ở thanh trên.</p>}
      </section>

      {searched && (
        <section>
          <h2>Ảnh bạn được phép xem ({groups.length})</h2>
          {!groups.length && <p>Không có ảnh nào thuộc quyền của tài khoản này cho hồ sơ vừa tra cứu.</p>}
          {cards.map((card, n) => { const at = Math.min(openSlice[card.key] ?? Math.floor(card.items.length / 2), card.items.length - 1); const { g, v } = card.items[at]; return (
            <div key={card.key} style={{ margin: '12px 0', padding: 10, border: '1px solid #cfd7df', borderRadius: 6 }}>
              <b>Ảnh {n + 1}{v?.series ? ` · chuỗi ${card.items.length} lát cắt (đang xem lát ${at + 1}/${card.items.length})` : ''}</b>
              {card.items.length > 1 && <div><input type="range" aria-label="Chọn lát cắt" min={0} max={card.items.length - 1} value={at} style={{ width: 320, minWidth: 0 }} onChange={(e) => setOpenSlice((o) => ({ ...o, [card.key]: Number(e.target.value) }))} /></div>}
              {v && v.width > 0 ? <>
                {' '}<span className={v.limited ? 'warn' : 'ok'}>{v.limited ? '⚠ Bản hiển thị đã GIỚI HẠN (chỉ các vùng được cấp; ảnh gốc không có trên máy này)' : '✔ Ảnh gốc đầy đủ (bạn là người nhập)'}</span>
                <div style={{ margin: '8px 0' }}><ViewCanvas view={v} /></div>
                <small>Vùng đọc được: {v.regions.length ? v.regions.map((r, i) => `#${i + 1} [${r.khoas.map(kLabel).join(' + ')}] ${r.rect.w}x${r.rect.h}`).join(' · ') : 'không có'}</small>
                {v.tampered > 0 && <p className="bad">⚠ {v.tampered} phần của ảnh bị phát hiện can thiệp/sai chữ ký nên không được hiển thị. Hãy báo quản trị.</p>}
              </> : <p className="bad">Không mở được ảnh này (không đủ quyền hoặc dữ liệu bị can thiệp).</p>}
            </div>); })}
        </section>
      )}

      {canUpload && (
        <section>
          <h2>Tải ảnh mới từ hồ sơ giấy</h2>
          <div className="row">
            <input type="file" multiple accept=".dcm,image/png,image/jpeg" onChange={(e) => void pick(e.target.files)} />
            <select value={modality} onChange={(e) => setModality(e.target.value as typeof modality)}><option value="CT">CT</option><option value="MRI">MRI</option><option value="KHAC">Khác</option></select>
          </div>
          {series && <div className="row" style={{ alignItems: 'center' }}>
            <b style={{ flex: 'none' }}>Lát cắt {sliceIdx + 1}/{series.length}</b>
            <input type="range" aria-label="Chọn lát để soạn" min={0} max={series.length - 1} value={sliceIdx} style={{ width: 320, minWidth: 0 }} onChange={(e) => void run('Chọn lát', () => showSlice(series, Number(e.target.value)))} />
            <small style={{ flex: 'none' }}>{series.filter((s) => s.advice.decision !== 'BO_QUA_LAT').length} lát có nội dung / {series.length}</small>
          </div>}
          {advice && <div role="region" aria-label="Gợi ý tự động" style={{ margin: '8px 0', padding: 10, border: '1px solid #9db4cc', background: '#f2f7fc', borderRadius: 6 }}>
            <b>🤖 Gợi ý tự động</b> <small>{advice.source === 'FACE'
              ? '(chạy ngay trên máy này bằng mô hình nhận dạng khuôn mặt có sẵn trong app, không gọi mạng, ảnh chưa rời máy · chỉ là ĐỀ XUẤT, bạn quyết định)'
              : '(chạy ngay trên máy này, ảnh chưa rời máy · chỉ là ĐỀ XUẤT, bạn quyết định · không phải mô hình học máy: là bộ luật cố định cho nguồn đã biết)'}</small>
            <div>{advice.source === 'FACE' ? '✔ Nhận ra khuôn mặt người — đã tự chia vùng Mắt / Tai-Mũi-Họng / Răng-Hàm-Mặt' : DECISION_TEXT[advice.decision]}</div>
            {advice.notes.map((t) => <div key={t}><small>{t}</small></div>)}
            {advice.regions.map((r, i) => <div key={i}>• Đề xuất vùng {r.rect.w}x{r.rect.h} → <b>{r.khoas.map(kLabel).join(' + ')}</b> <small>— {r.basis}</small></div>)}
            {advice.warnings.map((t) => <p key={t} className="warnbar" style={{ margin: '6px 0' }}>⚠ {t}</p>)}
            <div className="row" style={{ alignItems: 'center' }}>
              {advice.regions.length > 0 && <button className="mini2" onClick={applyAdvice}>Áp dụng đề xuất vào lát này</button>}
              {advice.needsAck && <label style={{ flex: 'none' }}><input type="checkbox" style={{ minWidth: 0 }} checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi đã xem các cảnh báo trên và xác nhận đã có sự đồng ý bằng văn bản của người trong ảnh (hoặc cha mẹ/người giám hộ nếu dưới 16 tuổi) cho việc lưu ảnh này</label>}
            </div>
          </div>}
          {bitmap && pixels && <>
            <p className="hint">Kéo chuột trên ảnh để khoanh <b>vùng</b>, rồi gán chuyên khoa cho từng vùng (một vùng có thể thuộc nhiều khoa). Điểm ảnh ngoài mọi vùng chỉ có trong <b>ảnh gốc</b> (chỉ bạn đọc được).</p>
            <canvas ref={cvRef} style={{ maxWidth: '100%', cursor: 'crosshair', border: '1px solid #b8c2cc', touchAction: 'none' }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = pos(e); setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y }); }}
              onPointerMove={(e) => { if (drag) { const p = pos(e); setDrag({ ...drag, x2: p.x, y2: p.y }); } }}
              onPointerUp={finishDrag} />
            {drafts.map((d, i) => (
              <div className="row" key={i} style={{ alignItems: 'center' }}>
                <b style={{ flex: 'none', color: COLORS[i % COLORS.length] }}>Vùng {i + 1} ({d.rect.w}x{d.rect.h})</b>
                {KHOAS.map(([k, l]) => <label key={k} style={{ flex: 'none' }}><input type="checkbox" style={{ minWidth: 0 }} checked={d.khoas.includes(k)} onChange={(e) => setDraft(i, { khoas: e.target.checked ? [...d.khoas, k] : d.khoas.filter((x) => x !== k) })} /> {l}</label>)}
                <button className="mini2" onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}>Xóa vùng</button>
              </div>))}
            <div className="row">
              <button disabled={needAck || !/^\d{12}$/.test(cccd) || drafts.some((d) => !d.khoas.length)} onClick={() => void save()}>Mã hoá và lưu {series ? 'lát này' : ''} ({drafts.length} vùng)</button>
              {series && <button disabled={needAck || !/^\d{12}$/.test(cccd)} onClick={() => void saveSeries()}>Lưu cả chuỗi ({series.filter((s) => s.advice.decision !== 'BO_QUA_LAT').length} lát có nội dung, theo gợi ý)</button>}
            </div>
            {!/^\d{12}$/.test(cccd) && <p className="hint">Nhập số định danh của bệnh nhân ở ô tra cứu phía trên để lưu.</p>}
          </>}
        </section>
      )}
    </div>
  );
}
