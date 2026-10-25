import { useEffect, useState } from 'react';
import { adm } from './adminApi.js';
import { log, run } from './ui.js';

interface Pending { id: string; who: string; attrs: string[] }

/**
 * Mô phỏng "App xác thực trên điện thoại" - nút thứ 3 trong ngưỡng 2-trên-3. Mỗi yêu cầu cấp khoá gửi tới nút này
 * phải được người dùng bấm duyệt; nhờ vậy khi Bệnh viện hoặc Sở Y tế không liên lạc được vẫn cấp được khoá.
 * Mã duyệt nằm trong kho của trạm quản trị (tiến trình chính gắn vào), không nhập tay.
 */
export function Phone() {
  const [list, setList] = useState<Pending[]>([]);

  const load = async () => {
    try { setList(await adm('DienThoai', 'GET', '/approvals')); } catch { /* chưa mở khoá hoặc nút chưa chạy */ }
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, []);

  const approve = (p: Pending) => run('Duyệt yêu cầu', async () => {
    await adm('DienThoai', 'POST', `/approvals/${p.id}`, {});
    log(`Đã duyệt yêu cầu của ${p.who}`, 'ok');
    await load();
  });

  return (
    <section>
      <h2>App điện thoại (mô phỏng)</h2>
      {list.length === 0 && <p className="sub">Không có yêu cầu nào đang chờ.</p>}
      {list.map((p) => (
        <div key={p.id} className="sec" style={{ marginBottom: 8 }}>
          <b>{p.who} xin khoá</b>
          <div>{p.attrs.map((a) => <span key={a} className="tag">{a.replace('MED:', '')}</span>)}</div>
          <button onClick={() => void approve(p)}>Cho phép</button>
        </div>
      ))}
    </section>
  );
}
