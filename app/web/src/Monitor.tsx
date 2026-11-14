import { useEffect, useState } from 'react';
import { adm } from './adminApi.js';
import { bridge } from './bridge.js';

interface Ev { id: number; ts: string; source: string; type: string; severity: string; detail: string; subject?: string; deviceGid?: string }
interface Rule { ten: string; nguong: string; hanhDong: string }
interface AgentStatus { enabled: boolean; totalAlerts: number; rules: Rule[] }
interface NetRow { iface: string; ip: string; mac: string; state: string; locallyAdministered: boolean; baselineMac: string; mismatch: boolean }
interface NetStatus {
  sensorId?: string; iface?: string; lastSeen?: string; online: boolean; staleMinutes: number;
  baselineApproved: boolean; baselineApprovedAt?: string; baselineCount: number; observedCount: number; table: NetRow[]; note: string;
}
interface AiStatus { enabled: boolean; configured: boolean; model: string; state: string }
interface AiAnalysis { summary: string; evidence: number[]; alternatives: string[]; missing: string[]; recommendation: string[]; limits: string; confidence: string }
interface AiResult { state: string; message?: string; analysis?: AiAnalysis }

/** Loại sự kiện do AGENT tự tạo ra (không phải admin bấm). */
const isAgentAction = (e: Ev) => e.type.startsWith('AGENT_') || e.type === 'DEVICE_LOCKED';
const isNetAlert = (e: Ev) => e.type.startsWith('NET_');

/** Màn hình giám sát: Agent luật + CẢM BIẾN MẠNG (ARP) + phân tích Gemini + dòng sự kiện an ninh. */
export function Monitor() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [net, setNet] = useState<NetStatus | null>(null);
  const [netMsg, setNetMsg] = useState('');
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(true);

  const hasSensor = !!bridge?.admin?.netScan;

  const load = async () => {
    try {
      const [ev, ag, ns, as] = await Promise.all([
        adm('storage', 'GET', '/api/admin/events'),
        adm('storage', 'GET', '/api/admin/agent'),
        adm('storage', 'GET', '/api/admin/net-status'),
        adm('storage', 'GET', '/api/admin/ai/status'),
      ]);
      setEvents(ev); setAgent(ag); setNet(ns); setAi(as);
      setErr('');
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  /** Một vòng cảm biến: đọc bảng ARP trong tiến trình chính rồi gửi lên máy chủ để đối chiếu baseline. */
  const scanOnce = async () => {
    if (!hasSensor) return;
    try {
      const scan = await bridge!.admin!.netScan();
      if (scan.unsupported) { setNetMsg('Cảm biến chỉ chạy trên Windows.'); return; }
      if (!scan.rows.length) { setNetMsg(scan.error || 'Chưa đọc được thiết bị nào trên card LAN.'); return; }
      await adm('storage', 'POST', '/api/admin/net-observations', { sensorId: scan.iface ?? 'win', iface: scan.iface ?? 'net', observations: scan.rows });
      setNetMsg('');
    } catch (e) { setNetMsg((e as Error).message); }
  };

  useEffect(() => {
    if (!auto) return;
    void (async () => { await scanOnce(); await load(); })();
    const t = setInterval(() => void (async () => { await scanOnce(); await load(); })(), 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const approveBaseline = async () => {
    if (!confirm('Chỉ duyệt baseline KHI bạn chắc chắn mạng đang SẠCH (chưa bị ARP spoofing). Hệ thống sẽ coi bảng IP↔MAC hiện tại là gốc tin cậy. Tiếp tục?')) return;
    try { setNet(await adm('storage', 'POST', '/api/admin/net-baseline/approve')); } catch (e) { setNetMsg((e as Error).message); }
  };

  const analyze = async () => {
    const ids = events.filter((e) => isNetAlert(e) || (isAgentAction(e) && e.severity === 'CRITICAL')).slice(0, 50).map((e) => e.id);
    if (!ids.length) { setAiResult({ state: 'error', message: 'Chưa có cảnh báo nào để phân tích.' }); return; }
    setAnalyzing(true); setAiResult(null);
    try { setAiResult(await adm('storage', 'POST', '/api/admin/ai/analyze', { ids })); }
    catch (e) { setAiResult({ state: 'error', message: (e as Error).message }); }
    finally { setAnalyzing(false); }
  };

  const agentActions = events.filter(isAgentAction);
  const netAlerts = events.filter(isNetAlert);

  return (
    <section>
      <h2>Giám sát an ninh</h2>

      {/* ---------- CẢM BIẾN MẠNG ---------- */}
      <div className="agentbox">
        <h3 style={{ marginTop: 0 }}>🛰️ Cảm biến mạng{' '}
          {net && (net.online ? <span className="ok">● cảm biến đang chạy</span> : <span className="bad">● cảm biến mất kết nối</span>)}
        </h3>
        {!hasSensor && <div className="warn">Không có cảm biến mạng.</div>}
        {net && (
          <>
            <div className="sub" style={{ marginBottom: 6 }}>
              Card: <b>{net.iface ?? '—'}</b> · lần quan sát gần nhất: <b>{net.lastSeen ? new Date(net.lastSeen).toLocaleTimeString() : '—'}</b>
              {' '}· thấy <b>{net.observedCount}</b> thiết bị{' '}
              · baseline:{' '}
              {net.baselineApproved
                ? <span className="ok">đã duyệt ({net.baselineCount} mục)</span>
                : <span className="warn">CHƯA DUYỆT</span>}
              {' '}<button className="mini2" disabled={!hasSensor || !net.observedCount} onClick={() => void approveBaseline()}>Duyệt baseline</button>
            </div>
            {netMsg && <div className="warn" style={{ marginBottom: 6 }}>{netMsg}</div>}
            {net.table.length > 0 && (
              <table className="grid small" style={{ marginBottom: 6 }}>
                <thead><tr><th>IP</th><th>MAC hiện tại</th><th>Trạng thái</th><th>MAC baseline</th><th>Đối chiếu</th></tr></thead>
                <tbody>
                  {net.table.map((r) => (
                    <tr key={r.ip} className={r.mismatch ? 'bad' : ''}>
                      <td>{r.ip}</td>
                      <td><code>{r.mac}</code>{r.locallyAdministered && <small> ·riêng tư</small>}</td>
                      <td>{r.state}</td>
                      <td>{r.baselineMac ? <code>{r.baselineMac}</code> : <small>(chưa có)</small>}</td>
                      <td>{r.baselineMac ? (r.mismatch ? '⚠️ KHÁC baseline' : '✓ khớp') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {netAlerts.length > 0 && (
              <div className="warnbar"><b>Cảnh báo mạng:</b> {netAlerts.length} sự kiện NET_*.</div>
            )}
          </>
        )}
      </div>

      {/* ---------- PHÂN TÍCH GEMINI ---------- */}
      <div className="agentbox">
        <h3 style={{ marginTop: 0 }}>🧠 Phân tích bằng Gemini{' '}
          {ai && (ai.state === 'ready' ? <span className="ok">● sẵn sàng ({ai.model})</span>
            : ai.state === 'not_configured' ? <span className="warn">● chưa có API key</span>
            : <span className="bad">● đã tắt</span>)}
        </h3>
        <button className="mini2" disabled={analyzing || (ai?.state !== 'ready')} onClick={() => void analyze()}>
          {analyzing ? 'Đang phân tích…' : 'Phân tích cảnh báo bằng AI'}
        </button>
        {aiResult && (
          <div style={{ marginTop: 8 }}>
            {aiResult.state === 'disabled' && <div className="warn">AI đang tắt.</div>}
            {aiResult.state === 'not_configured' && <div className="warn">Chưa có API key.</div>}
            {aiResult.state === 'quota' && <div className="warn">Hết quota. {aiResult.message}</div>}
            {aiResult.state === 'error' && <div className="bad">Lỗi: {aiResult.message}</div>}
            {(aiResult.state === 'ok' || aiResult.state === 'cached') && aiResult.analysis && (
              <div className="grid small" style={{ padding: 8, border: '1px solid #ccc', borderRadius: 6 }}>
                <div><b>Tóm tắt:</b> {aiResult.analysis.summary} {aiResult.state === 'cached' && <small>(kết quả đã lưu)</small>}</div>
                <div><b>Độ tin cậy:</b> {aiResult.analysis.confidence}</div>
                {aiResult.analysis.alternatives?.length > 0 && <div><b>Giải thích khác:</b> {aiResult.analysis.alternatives.join('; ')}</div>}
                {aiResult.analysis.missing?.length > 0 && <div><b>Còn thiếu:</b> {aiResult.analysis.missing.join('; ')}</div>}
                {aiResult.analysis.recommendation?.length > 0 && <div><b>Đề xuất:</b> {aiResult.analysis.recommendation.join('; ')}</div>}
                <div><b>Giới hạn:</b> {aiResult.analysis.limits}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- AGENT LUẬT ---------- */}
      <div className="agentbox">
        <h3 style={{ marginTop: 0 }}>🤖 Agent bảo vệ {agent && (agent.enabled ? <span className="ok">● đang hoạt động</span> : <span className="bad">● đã tắt</span>)}</h3>
        <p className="sub">Đã tự xử lý <b>{agent?.totalAlerts ?? '…'}</b> lần.</p>
        {agent && (
          <table className="grid small" style={{ marginBottom: 10 }}>
            <thead><tr><th>Luật đang theo dõi</th><th>Ngưỡng</th><th>Hành động tự động</th></tr></thead>
            <tbody>{agent.rules.map((r) => <tr key={r.ten}><td>{r.ten}</td><td>{r.nguong}</td><td>{r.hanhDong}</td></tr>)}</tbody>
          </table>
        )}
        {agentActions.length > 0 && (
          <>
            <div className="sub" style={{ marginBottom: 4 }}><b>Hành động gần đây:</b></div>
            <table className="grid small">
              <tbody>
                {agentActions.slice(0, 8).map((e) => (
                  <tr key={e.id} className="bad">
                    <td style={{ width: 90 }}>{new Date(e.ts).toLocaleTimeString()}</td>
                    <td style={{ width: 220 }}>{e.type}</td>
                    <td>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <label className="radio"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> tự làm mới</label>
      {err && <div className="bad">{err}</div>}
      <table>
        <thead><tr><th>Giờ</th><th>Mức</th><th>Loại</th><th>Nguồn</th><th>Chi tiết</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className={isNetAlert(e) ? 'bad' : isAgentAction(e) ? 'agentrow' : ''}>
              <td>{new Date(e.ts).toLocaleTimeString()}</td>
              <td className={e.severity === 'CRITICAL' ? 'bad' : e.severity === 'WARN' ? 'warn' : ''}>{e.severity}</td>
              <td>{isNetAlert(e) && '🛰️ '}{isAgentAction(e) && '🤖 '}{e.type}</td><td>{e.source}</td>
              <td>{e.detail}{e.subject && <> · subject <code>{e.subject}</code></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
