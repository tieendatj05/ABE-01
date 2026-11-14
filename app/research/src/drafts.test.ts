import { describe, expect, it } from 'vitest';
import { DraftStore, initialBusiness, lockMessage, nextBusiness, type KV } from './drafts.js';

class MemKV implements KV {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('bản nháp và khoá nghiệp vụ ngoài giờ', () => {
  it('bị khoá ngoài giờ KHÔNG xoá phần đang nhập; mở cửa lại KHÔNG tự gửi', () => {
    const kv = new MemKV();
    const drafts = new DraftStore(kv, 'u-1');
    drafts.save('BN-GIA-0001', 'lamsang.Nhi', { chieuCao: '120', ketLuan: 'dang nhap do' });

    let view = nextBusiness(initialBusiness, { businessOpen: false, nextOpenAt: '2026-11-03T07:00:00+07:00' });
    expect(view).toMatchObject({ open: false, notice: 'locked', reopensAt: '2026-11-03T07:00:00+07:00', autoSubmit: false });
    expect(lockMessage(view)).toContain('Đã khóa nghiệp vụ');
    expect(drafts.load('BN-GIA-0001', 'lamsang.Nhi')?.values).toEqual({ chieuCao: '120', ketLuan: 'dang nhap do' });   // còn nguyên

    view = nextBusiness(view, { businessOpen: false, nextOpenAt: '2026-11-03T07:00:00+07:00' });                        // thăm dò lại vẫn đóng
    expect(view.notice).toBe('locked');

    view = nextBusiness(view, { businessOpen: true, nextOpenAt: null });
    expect(view).toMatchObject({ open: true, notice: 'reopened', autoSubmit: false });
    expect(lockMessage(view)).toContain('KHÔNG tự gửi');
    expect(drafts.pending()).toHaveLength(1);                                                                              // vẫn chờ người dùng bấm Lưu
  });

  it('bản nháp chỉ bị xoá khi người dùng xác nhận (sau khi lưu thành công / huỷ chủ động)', () => {
    const drafts = new DraftStore(new MemKV(), 'u-1');
    drafts.save('P', 'hanhchinh', { hoTen: 'A' });
    expect(drafts.pending()).toHaveLength(1);
    drafts.clear('P', 'hanhchinh');
    expect(drafts.pending()).toHaveLength(0);
  });

  it('hai người dùng cùng một máy không thấy bản nháp của nhau', () => {
    const kv = new MemKV();
    const a = new DraftStore(kv, 'u-A'), b = new DraftStore(kv, 'u-B');
    a.save('P', 'hanhchinh', { hoTen: 'chi A thay' });
    expect(b.pending()).toHaveLength(0);
    expect(b.load('P', 'hanhchinh')).toBeNull();
    expect(a.load('P', 'hanhchinh')?.values.hoTen).toBe('chi A thay');
  });
});
