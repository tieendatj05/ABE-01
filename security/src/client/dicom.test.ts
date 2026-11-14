import { describe, expect, it } from 'vitest';
import { adviseImage, contentStats } from './advisor.js';
import { DicomUnsupportedError, dicomToRgba, parseDicom, sortSlices } from './dicom.js';
import { makeDicom } from './dicom-fixture.js';

describe('đọc DICOM', () => {
  it('đọc Implicit VR LE: kích thước, điểm ảnh, nguồn UPENN-GBM', () => {
    const s = parseDicom(makeDicom());
    expect(s.meta).toMatchObject({ rows: 4, cols: 6, bitsAllocated: 16, modality: 'MR', bodyPart: 'BRAIN', sourceId: 'UPENN-GBM-00002', hasIdentityTags: false });
    expect(s.pixels.length).toBe(24);
    expect(s.pixels[3]).toBe(503);
  });
  it('đọc Explicit VR LE cho kết quả như nhau', () => {
    const a = parseDicom(makeDicom()); const b = parseDicom(makeDicom({ ts: '1.2.840.10008.1.2.1' }));
    expect(Array.from(b.pixels)).toEqual(Array.from(a.pixels));
    expect(b.meta.rows).toBe(4);
  });
  it('bỏ qua chuỗi SQ độ dài không xác định (không nhầm Rows lồng bên trong)', () => {
    for (const ts of ['1.2.840.10008.1.2', '1.2.840.10008.1.2.1']) expect(parseDicom(makeDicom({ ts, sq: true })).meta.rows).toBe(4);
  });
  it('từ chối DICOM nén và tệp không phải DICOM', () => {
    expect(() => parseDicom(makeDicom({ ts: '1.2.840.10008.1.2.4.50' }))).toThrow(DicomUnsupportedError);
    expect(() => parseDicom(new Uint8Array(500))).toThrow(DicomUnsupportedError);
  });
  it('từ chối dữ liệu điểm ảnh bị cắt cụt', () => {
    const b = makeDicom(); expect(() => parseDicom(b.slice(0, b.length - 10))).toThrow(DicomUnsupportedError);
  });
  it('mã bệnh nhân lạ KHÔNG được giữ lại; tên thật/ngày sinh chỉ bật cờ, không lộ giá trị', () => {
    const s = parseDicom(makeDicom({ pid: 'BN-NGUYEN-VAN-A', name: 'NGUYEN^VAN^A', birth: '19800101' }));
    expect(s.meta.sourceId).toBeNull();
    expect(s.meta.hasIdentityTags).toBe(true);
    expect(JSON.stringify(s.meta)).not.toMatch(/NGUYEN|1980/);
  });
  it('dicomToRgba: cửa sổ phân vị, nền đen, MONOCHROME1 đảo màu', () => {
    const s = parseDicom(makeDicom());
    const p = dicomToRgba(s);
    expect([p.w, p.h]).toEqual([6, 4]);
    expect(p.data[0]).toBe(0);                     // nền
    expect(p.data[3 * 4]).toBeGreaterThan(0);      // có tín hiệu
    expect(p.data[3]).toBe(255);
    const inv = dicomToRgba(parseDicom(makeDicom({ photometric: 'MONOCHROME1' })));
    expect(inv.data[0]).toBe(255);
  });
  it('sortSlices theo InstanceNumber', () => {
    const a = { meta: { instanceNumber: 3 } }, b = { meta: { instanceNumber: 1 } };
    expect(sortSlices([a, b] as never)[0]).toBe(b);
  });
});

describe('trợ lý gợi ý vùng + khoa', () => {
  const brain = (): { px: ReturnType<typeof dicomToRgba>; meta: ReturnType<typeof parseDicom>['meta'] } => {
    const rows = 40, cols = 30; const px: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) px.push(x >= 8 && x < 22 && y >= 10 && y < 30 ? 800 : 0);
    const s = parseDicom(makeDicom({ rows, cols, px }));
    return { px: dicomToRgba(s, { low: 0, high: 800 }), meta: s.meta };
  };
  it('nguồn UPENN-GBM: đề xuất đúng MỘT vùng, khoa Thần kinh, khung ôm vùng tín hiệu', () => {
    const { px, meta } = brain();
    const a = adviseImage(px, meta);
    expect(a.decision).toBe('DE_XUAT'); expect(a.source).toBe('UPENN-GBM');
    expect(a.regions).toHaveLength(1);
    expect(a.regions[0].khoas).toEqual(['ThanKinh']);
    const r = a.regions[0].rect;
    expect(r.x).toBeLessThanOrEqual(8); expect(r.x + r.w).toBeGreaterThanOrEqual(22);
    expect(r.y).toBeLessThanOrEqual(10); expect(r.y + r.h).toBeGreaterThanOrEqual(30);
    expect(a.regions[0].basis).toMatch(/UPENN-GBM/);
  });
  it('nguồn KHÔNG nhận ra: không đề xuất vùng nào, mặc định chỉ tác giả', () => {
    const { px, meta } = brain();
    const a = adviseImage(px, { ...meta, sourceId: null });
    expect(a.decision).toBe('CHI_TAC_GIA'); expect(a.regions).toEqual([]); expect(a.source).toBeNull();
    const png = adviseImage(px);                   // không có tiêu đề DICOM (PNG/JPEG)
    expect(png.decision).toBe('CHI_TAC_GIA'); expect(png.regions).toEqual([]);
    expect(png.warnings.join(' ')).toMatch(/tự xem ảnh/);
  });
  it('MRI nhưng không phải não: không đề xuất', () => {
    const { px, meta } = brain();
    expect(adviseImage(px, { ...meta, bodyPart: 'KNEE' }).decision).toBe('CHI_TAC_GIA');
    expect(adviseImage(px, { ...meta, modality: 'CT' }).decision).toBe('CHI_TAC_GIA');
  });
  it('lát rỗng bị bỏ qua', () => {
    const s = parseDicom(makeDicom({ rows: 10, cols: 10, px: new Array(100).fill(0) }));
    const a = adviseImage(dicomToRgba(s, { low: 0, high: 1 }), s.meta);
    expect(a.decision).toBe('BO_QUA_LAT'); expect(a.regions).toEqual([]);
  });
  it('cảnh báo định danh / chữ in trên ảnh được bật đúng', () => {
    const { px, meta } = brain();
    const w = adviseImage(px, { ...meta, hasIdentityTags: true, burnedInAnnotation: true }).warnings.join(' ');
    expect(w).toMatch(/định danh/); expect(w).toMatch(/BurnedInAnnotation/);
    expect(adviseImage(px, { ...meta, hasIdentityTags: true }).needsAck).toBe(true);
    expect(adviseImage(px, meta).needsAck).toBe(false);
    expect(adviseImage(px).needsAck).toBe(false);          // PNG: chỉ nhắc chung, không chặn
    expect(adviseImage(px, meta).warnings).toEqual([]);
  });
  it('contentStats cho khung đúng', () => {
    const { px } = brain(); const c = contentStats(px);
    expect(c.bbox).toEqual({ x: 8, y: 10, w: 14, h: 20 });
  });
});
