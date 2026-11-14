// Bản nháp + trạng thái khoá nghiệp vụ — LOGIC THUẦN (không phụ thuộc React) để kiểm thử được.
// Quy tắc theo yêu cầu: (1) KHÔNG âm thầm xoá phần nhập liệu chưa lưu khi bị khoá ngoài giờ; (2) KHÔNG tự động gửi/ghi lại khi đến giờ mở cửa —
// người dùng phải bấm Lưu. Bản nháp chỉ bị xoá khi người dùng chủ động huỷ hoặc sau khi backend xác nhận đã lưu.
export interface KV { readonly length: number; key(i: number): string | null; getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export interface Draft { patient: string; section: string; values: Record<string, string>; savedAt: string }

export class DraftStore {
  constructor(private kv: KV, private userId: string, private ns = 'medabe.research.draft', private now: () => Date = () => new Date()) {}
  private k(patient: string, section: string) { return `${this.ns}|${this.userId}|${patient}|${section}`; }
  save(patient: string, section: string, values: Record<string, string>) {
    this.kv.setItem(this.k(patient, section), JSON.stringify({ patient, section, values, savedAt: this.now().toISOString() } satisfies Draft));
  }
  load(patient: string, section: string): Draft | null {
    const raw = this.kv.getItem(this.k(patient, section));
    return raw ? (JSON.parse(raw) as Draft) : null;
  }
  /** Chỉ gọi sau khi backend xác nhận đã lưu, hoặc khi người dùng chủ động bỏ bản nháp. */
  clear(patient: string, section: string) { this.kv.removeItem(this.k(patient, section)); }
  /** Bản nháp của CHÍNH người dùng này (hai người cùng máy không thấy nháp của nhau). */
  pending(): Draft[] {
    const prefix = `${this.ns}|${this.userId}|`;
    const out: Draft[] = [];
    for (let i = 0; i < this.kv.length; i++) {
      const key = this.kv.key(i);
      if (key?.startsWith(prefix)) out.push(JSON.parse(this.kv.getItem(key)!) as Draft);
    }
    return out;
  }
}

export interface BusinessStatus { businessOpen: boolean; nextOpenAt: string | null }
export interface BusinessView {
  open: boolean;
  reopensAt: string | null;
  /** 'locked' = vừa bị khoá; 'reopened' = vừa mở lại (bản nháp còn nguyên, cần bấm Lưu); 'none' = không đổi */
  notice: 'none' | 'locked' | 'reopened';
  /** LUÔN false: mở cửa lại không bao giờ tự gửi bản nháp. Hằng số để kiểm thử khẳng định thiết kế. */
  autoSubmit: false;
}

export const initialBusiness: BusinessView = { open: true, reopensAt: null, notice: 'none', autoSubmit: false };

export function nextBusiness(prev: BusinessView, st: BusinessStatus): BusinessView {
  if (prev.open && !st.businessOpen) return { open: false, reopensAt: st.nextOpenAt, notice: 'locked', autoSubmit: false };
  if (!prev.open && st.businessOpen) return { open: true, reopensAt: null, notice: 'reopened', autoSubmit: false };
  return { ...prev, reopensAt: st.businessOpen ? null : st.nextOpenAt, notice: prev.notice };
}

export function lockMessage(v: BusinessView, fmt: (iso: string) => string = (s) => s): string {
  if (v.open) return v.notice === 'reopened' ? 'Hệ thống đã mở cửa trở lại. Các bản nháp chưa lưu vẫn được giữ trên máy này — hãy kiểm tra rồi bấm Lưu thủ công; hệ thống KHÔNG tự gửi.' : '';
  return `Đã khóa nghiệp vụ ngoài giờ làm việc${v.reopensAt ? `; mở lại lúc ${fmt(v.reopensAt)}` : ''}. Đọc, ghi, import và xin khóa đều bị chặn ở máy chủ. Phần đang nhập được giữ nguyên trên máy này.`;
}
