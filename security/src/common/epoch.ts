// Phiên bản (epoch) của thuộc tính: "<thuộc tính>#<tuần>.<bộ đếm>", vd "MED:Role:BacSi#2026W41.0".
//  - tuần  : do máy chủ lưu trữ công bố (một nguồn thời gian duy nhất); khoá được làm mới mỗi tuần.
//  - bộ đếm: tăng khi thu hồi/kết thúc phá-vỡ-kính; khoá thuộc bộ đếm cũ không mở được dữ liệu đã bọc lại.
// Thư mục epoch là CÔNG KHAI và không chứa bí mật: sửa nó chỉ gây từ chối dịch vụ, không tạo ra quyền truy cập.
export interface EpochDirectory {
  tag: string;                       // tuần hiện hành, vd "2026W41"
  retention: string[];               // các tuần còn được cấp khoá để đọc lịch sử (gồm cả tuần hiện hành)
  counters: Record<string, number>;  // thuộc tính gốc -> bộ đếm hiện hành (mặc định 0)
}

const V = /^(.+)#(\d{4}W\d{2})\.(\d+)$/;

export const versioned = (base: string, dir: EpochDirectory) => `${base}#${dir.tag}.${dir.counters[base] ?? 0}`;

export function parseVersioned(attr: string): { base: string; tag: string; counter: number } | null {
  const m = V.exec(attr);
  return m ? { base: m[1], tag: m[2], counter: Number(m[3]) } : null;
}

/** Khoá cho `attr` còn được phép cấp không (tuần trong thời hạn lưu giữ, bộ đếm không vượt hiện hành). */
export function isIssuable(attr: string, dir: EpochDirectory): { ok: true; base: string } | { ok: false; reason: string } {
  const p = parseVersioned(attr);
  if (!p) return { ok: false, reason: 'thuộc tính thiếu phiên bản' };
  if (!dir.retention.includes(p.tag)) return { ok: false, reason: `tuần ${p.tag} đã quá thời hạn lưu giữ` };
  if (p.counter > (dir.counters[p.base] ?? 0)) return { ok: false, reason: 'bộ đếm epoch chưa tồn tại' };
  return { ok: true, base: p.base };
}
