// MỘT nút cấp khoá của cơ quan logic "MED" (vd Bệnh viện, Sở Y tế, App xác thực trên điện thoại).
// Mỗi nút: giữ một share (α_i, β_i) của riêng nó, có admin token riêng, danh sách cấp quyền riêng, audit riêng.
// Cần >= k nút cùng đồng thuận (mỗi nút tự duyệt theo chính sách của nó) mới ghép được một khoá hợp lệ.
import { randomBytes, randomUUID } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import express from 'express';
import { partialKey, type Partial, type Share } from '../abe/rw15.js';
import { bearer, cors, requireAdmin, safeEq } from '../common/http.js';
import { isIssuable, parseVersioned, type EpochDirectory } from '../common/epoch.js';
import { JsonStore, type AuditRec } from '../common/persist.js';
import { isLanPeer } from '../network/lan.js';

export const gidMessage = (gid: string, devicePub: string) => new TextEncoder().encode(`medabe/gid/${gid}|${devicePub}`);
export const deviceIdOf = (devicePub: string) => bytesToHex(sha256(hexToBytes(devicePub))).slice(0, 16);

interface Holder { gid: string; name: string; token: string; devicePub: string; deviceId: string; attrs: string[]; disabled: boolean }
interface BgGrant { gid: string; patientIdx: string; until: number; counter: number; reason: string }
interface Pending { id: string; gid: string; attrs: string[]; approved: boolean; partials?: Record<string, Partial> }
interface OpenPolicy { enabled: boolean; attrs: string[] }
interface State {
  open?: OpenPolicy;          // đăng ký tự do: máy đã có chứng chỉ registry tự nhận bộ quyền mặc định (admin bật/tắt/đặt)
  grants: Record<string, { name: string; attrs: string[] }>;
  holders: Record<string, Holder>;                 // theo gid
  breakGlass: BgGrant[];
  audit: AuditRec[];
}

export interface NodeOptions {
  dir: string;
  org: string;                    // tên tổ chức, vd "BenhVien"
  share: Share;
  adminToken: string;
  registryPk: string;             // khoá công khai Ed25519 của registry (hex)
  storageBase: string;            // máy chủ lưu trữ: công bố epoch + nhận cảnh báo
  serviceToken: string;           // token dịch vụ để đẩy sự kiện lên máy chủ lưu trữ
  requiresApproval?: boolean;     // true: phải có người (điện thoại) bấm duyệt từng yêu cầu cấp khoá
  approverToken?: string;
  breakGlassHours?: number;
  /** Mặc định đăng ký tự do (chỉ dùng khi nút chưa có cấu hình do admin đặt). attrs là tên rút gọn, vd "Role:BacSi". */
  defaultOpen?: { enabled: boolean; attrs: string[] };
  indexKey: string;               // khoá chỉ mục mù (HMAC) dùng chung giữa các nút, giao cho nhân viên lâm sàng lúc đăng ký
  webhook?: string;               // URL nhận cảnh báo (kết nối SMS/Email/Slack...)
  fetchFn?: typeof fetch;
  /**
   * Luồng nghiên cứu: cấp khoá theo VÉ do backend (tài khoản người dùng) thay vì "holder"/mã cấp quyền theo thiết bị.
   * Nút không giữ danh sách người dùng; mỗi lần cấp đều hỏi lại backend (giờ làm việc, trạng thái tài khoản, thiết bị, phiên).
   */
  research?: { backendBase: string };
}

export function createNode(o: NodeOptions) {
  const f = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const store = new JsonStore<State>(o.dir);
  const S = store.open(() => ({ grants: {}, holders: {}, breakGlass: [], audit: [] }));
  S.open ??= { enabled: !!o.defaultOpen?.enabled, attrs: (o.defaultOpen?.attrs ?? []).map((a) => `MED:${a}`) };
  const BG_MS = (o.breakGlassHours ?? 24) * 3600_000;
  const pending = new Map<string, Pending>();

  async function epochs(): Promise<EpochDirectory> {
    const r = await f(`${o.storageBase}/api/epochs`);
    if (!r.ok) throw new Error('Không lấy được thư mục epoch');
    return (await r.json()) as EpochDirectory;
  }

  async function alert(type: string, severity: 'INFO' | 'WARN' | 'CRITICAL', detail: string, subject?: string, deviceGid?: string) {
    store.log(o.org, `alert.${type}`, detail);
    const body = JSON.stringify({ source: `node:${o.org}`, type, severity, detail, subject, deviceGid });
    await f(`${o.storageBase}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': o.serviceToken }, body }).catch(() => undefined);
    if (o.webhook) await f(o.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => undefined);
  }

  const holderOf = (req: express.Request) => Object.values(S.holders).find((h) => safeEq(h.token, bearer(req)) && !h.disabled);

  /** Nút này CÓ cấp thuộc tính `attr` (đã phiên bản hoá) cho `h` không? */
  async function mayIssue(h: Holder, attr: string, dir: EpochDirectory): Promise<string | null> {
    const ok = isIssuable(attr, dir);
    if (!ok.ok) return ok.reason;
    const base = ok.base;
    if (base === `MED:Device:${h.deviceId}`) return null;                        // thuộc tính thiết bị: mặc định
    if (base.startsWith('MED:BG:')) {                                              // phá vỡ kính: phải đang kích hoạt
      const idx = base.slice('MED:BG:'.length);
      const g = S.breakGlass.find((x) => x.gid === h.gid && x.patientIdx === idx && x.until > Date.now());
      if (!g) return 'chưa kích hoạt phá-vỡ-kính cho bệnh nhân này (hoặc đã hết hạn)';
      // Quản trị đóng phá-vỡ-kính sớm = tăng bộ đếm: không cấp khoá của bộ đếm MỚI hơn lúc kích hoạt.
      return (parseVersioned(attr)?.counter ?? 0) <= g.counter ? null : 'phá-vỡ-kính đã bị đóng (epoch đã đổi)';
    }
    return h.attrs.includes(base) ? null : `nút ${o.org} không cấp ${base} cho người này`;
  }

  async function issue(h: Holder, attrs: string[]) {
    const dir = await epochs();
    const out: Record<string, Partial> = {};
    const denied: Record<string, string> = {};
    for (const a of attrs) {
      const why = await mayIssue(h, a, dir);
      if (why) denied[a] = why;
      else out[a] = partialKey(o.share, h.gid, a);
    }
    return { partials: out, denied };
  }

  const app = express();
  app.use((req, res, next) => {
    if (!isLanPeer(req.socket.remoteAddress ?? '')) return void res.status(403).json({ error: 'LAN_ONLY: chỉ cho phép thiết bị cùng mạng nội bộ' });
    next();
  });
  app.use(cors(), express.json({ limit: '1mb' }));
  const admin = requireAdmin(o.adminToken);

  app.get('/info', (_q, r) => r.json({ org: o.org, x: o.share.x, k: o.share.k, n: o.share.n, requiresApproval: !!o.requiresApproval }));

  app.post('/admin/grants', admin, (req, res) => {
    const { name, attrs } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(attrs) || !attrs.length || !attrs.every((a) => typeof a === 'string' && /^[A-Za-z0-9_.:-]+$/.test(a)))
      return void res.status(400).json({ error: 'name/attrs không hợp lệ' });
    const code = randomBytes(9).toString('base64url');
    S.grants[code] = { name: name.trim(), attrs: attrs.map((a: string) => `MED:${a}`) };
    store.log('admin', 'grant.create', `${name} [${attrs.join(',')}]`);
    res.json({ code });
  });

  /** Chứng chỉ registry gắn GID <-> khoá thiết bị + chứng minh đang giữ khoá riêng của thiết bị. Trả về thông báo lỗi hoặc null. */
  async function verifyDevice(gid: string, devicePub: string, cert: string, sig: string, popMsg: string): Promise<string | null> {
    try {
      if (!ed25519.verify(hexToBytes(String(cert)), gidMessage(String(gid), String(devicePub)), hexToBytes(o.registryPk))) return 'GID/khoá thiết bị không có chứng chỉ hợp lệ của registry';
    } catch { return 'GID/khoá thiết bị không có chứng chỉ hợp lệ của registry'; }
    try {
      const pub = await crypto.subtle.importKey('raw', hexToBytes(String(devicePub)) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, hexToBytes(String(sig)) as BufferSource, new TextEncoder().encode(popMsg) as BufferSource))) throw new Error('sig');
    } catch { return 'thiết bị không chứng minh được quyền sở hữu khoá riêng'; }
    return null;
  }

  app.get('/open-info', (_q, r) => r.json({ open: !!S.open?.enabled }));

  // Đăng ký TỰ DO: không cần mã; chỉ nhận máy đã được registry cấp chứng chỉ. Bộ quyền do admin đặt (không do máy tự chọn).
  app.post('/claim-open', async (req, res) => {
    if (!S.open?.enabled) return void res.status(403).json({ error: 'đăng ký tự do đang tắt ở nút này' });
    const { gid, devicePub, cert, sig, name } = req.body ?? {};
    if (typeof name !== 'string' || !/^[\p{L}0-9 .,'_-]{1,60}$/u.test(name.trim())) return void res.status(400).json({ error: 'tên không hợp lệ' });
    const bad = await verifyDevice(gid, devicePub, cert, sig, `claim-open|${gid}`);
    if (bad) return void res.status(403).json({ error: bad });
    const previous = S.holders[gid];
    if (previous) {
      if (previous.disabled || previous.devicePub !== devicePub) return void res.status(403).json({ error: 'Thiết bị đã bị khóa hoặc không khớp' });
      return void res.json({ token: previous.token, deviceId: previous.deviceId, requiresApproval: !!o.requiresApproval, attrs: previous.attrs, indexKey: o.indexKey });
    }
    const attrs = S.open.attrs;
    S.holders[gid] = { gid, name: name.trim(), token: randomBytes(24).toString('base64url'), devicePub, deviceId: deviceIdOf(devicePub), attrs, disabled: false };
    store.log(name.trim(), 'claim-open', `gid=${String(gid).slice(0, 8)}… ${attrs.length} thuộc tính mặc định`);
    res.json({ token: S.holders[gid].token, deviceId: S.holders[gid].deviceId, requiresApproval: !!o.requiresApproval, attrs, indexKey: o.indexKey });
  });

  app.get('/admin/open-enrollment', admin, (_q, r) => r.json(S.open));
  app.post('/admin/open-enrollment', admin, async (req, res) => {
    const { enabled, attrs } = req.body ?? {};
    if (typeof enabled !== 'boolean' || !Array.isArray(attrs) || !attrs.every((a) => typeof a === 'string' && /^[A-Za-z0-9_.:-]{1,60}$/.test(a)))
      return void res.status(400).json({ error: 'enabled/attrs không hợp lệ' });
    S.open = { enabled, attrs: attrs.map((a: string) => `MED:${a}`) };
    store.save();
    store.log('admin', 'open-enrollment', `${enabled ? 'BẬT' : 'TẮT'} [${attrs.join(',')}]`);
    await alert('OPEN_ENROLLMENT', enabled ? 'WARN' : 'INFO', `${o.org}: đăng ký tự do ${enabled ? 'BẬT' : 'TẮT'} với ${attrs.length} thuộc tính mặc định`);
    res.json(S.open);
  });

  // Đổi mã một lần + GID có chứng chỉ của registry + chứng minh sở hữu khoá thiết bị (PoP).
  app.post('/claim', async (req, res) => {
    const { code, gid, devicePub, cert, sig } = req.body ?? {};
    const g = S.grants[String(code)];
    if (!g) return void res.status(404).json({ error: 'mã không hợp lệ hoặc đã dùng' });
    try {
      if (!ed25519.verify(hexToBytes(String(cert)), gidMessage(String(gid), String(devicePub)), hexToBytes(o.registryPk))) throw new Error('cert');
    } catch {
      return void res.status(403).json({ error: 'GID/khoá thiết bị không có chứng chỉ hợp lệ của registry' });
    }
    try {
      const pub = await crypto.subtle.importKey('raw', hexToBytes(String(devicePub)) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const okSig = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, hexToBytes(String(sig)) as BufferSource, new TextEncoder().encode(`claim|${code}|${gid}`) as BufferSource);
      if (!okSig) throw new Error('sig');
    } catch {
      return void res.status(403).json({ error: 'thiết bị không chứng minh được quyền sở hữu khoá riêng' });
    }
    if (S.holders[gid]) return void res.status(409).json({ error: 'GID này đã đăng ký ở nút này' });
    delete S.grants[code];
    S.holders[gid] = { gid, name: g.name, token: randomBytes(24).toString('base64url'), devicePub, deviceId: deviceIdOf(devicePub), attrs: g.attrs, disabled: false };
    store.log(g.name, 'claim', `gid=${String(gid).slice(0, 8)}…`);
    res.json({ token: S.holders[gid].token, deviceId: S.holders[gid].deviceId, requiresApproval: !!o.requiresApproval, attrs: g.attrs, indexKey: o.indexKey });
  });

  app.post('/partials', async (req, res) => {
    const h = holderOf(req);
    if (!h) return void res.status(401).json({ error: 'unauthorized' });
    const attrs = req.body?.attrs;
    if (!Array.isArray(attrs) || !attrs.length || attrs.length > 64 || !attrs.every((a) => typeof a === 'string')) return void res.status(400).json({ error: 'attrs sai' });
    if (o.requiresApproval) {
      const id = randomUUID();
      pending.set(id, { id, gid: h.gid, attrs, approved: false });
      store.log(h.name, 'partials.pending', `${attrs.length} thuộc tính, chờ duyệt trên điện thoại`);
      return void res.status(202).json({ pending: id });
    }
    const r = await issue(h, attrs);
    store.log(h.name, 'partials.issue', `${Object.keys(r.partials).length} cấp, ${Object.keys(r.denied).length} từ chối`);
    res.json(r);
  });

  app.get('/partials/:id', async (req, res) => {
    const h = holderOf(req);
    const p = pending.get(String(req.params.id));
    if (!h || !p || p.gid !== h.gid) return void res.status(404).json({ error: 'không có yêu cầu' });
    if (!p.approved) return void res.status(202).json({ pending: p.id });
    pending.delete(p.id);
    res.json(await issue(h, p.attrs));
  });

  // ---- Luồng nghiên cứu: cấp khoá theo VÉ ----
  // Máy khách đưa jti (vé một-lần do backend cấp sau khi qua ABAC + giờ làm việc) + chữ ký chứng minh sở hữu khoá thiết bị.
  // Nút gọi backend `redeem` (token dịch vụ); backend ĐÁNH GIÁ LẠI rồi trả {gid, thuộc tính được cấp}. Nút chỉ cấp đúng các thuộc tính
  // đó, gắn H(gid) của NGƯỜI (không phải thiết bị) => đổi máy vẫn cùng khoá; hai người khác GID không ghép được khoá.
  if (o.research) {
    const backend = o.research.backendBase;
    app.post('/v2/partials', async (req, res) => {
      const { jti, sig, attrs } = req.body ?? {};
      if (typeof jti !== 'string' || !/^[0-9a-f]{32}$/.test(jti) || typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig) || !Array.isArray(attrs) || !attrs.length
        || attrs.length > 64 || !attrs.every((a) => typeof a === 'string' && a.length < 200)) return void res.status(400).json({ error: 'jti/sig/attrs không hợp lệ' });
      let redeem: Response;
      try {
        redeem = await f(`${backend}/api/v2/internal/tickets/redeem`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': o.serviceToken }, body: JSON.stringify({ jti, org: o.org, sig }) });
      } catch { return void res.status(502).json({ error: 'BACKEND_UNREACHABLE' }); }
      const g = (await redeem.json().catch(() => ({}))) as { error?: string; gid?: string; attrs?: string[]; indexKey?: boolean };
      if (!redeem.ok || !g.gid) {
        store.log('ticket', 'v2.deny', `${g.error ?? `HTTP ${redeem.status}`} jti=${jti.slice(0, 8)}`);
        return void res.status(redeem.status === 423 ? 423 : 403).json({ error: g.error ?? 'DENIED' });
      }
      const dir = await epochs();
      const granted = new Set(g.attrs ?? []);
      const partials: Record<string, Partial> = {};
      const denied: Record<string, string> = {};
      for (const a of attrs as string[]) {
        const ok = isIssuable(a, dir);
        if (!ok.ok) denied[a] = ok.reason;
        else if (!granted.has(ok.base)) denied[a] = 'vé không cho phép thuộc tính này';
        else partials[a] = partialKey(o.share, g.gid, a);
      }
      store.log('ticket', 'v2.partials', `gid=${g.gid.slice(0, 8)}… ${Object.keys(partials).length} cấp, ${Object.keys(denied).length} từ chối`);
      res.json({ partials, denied, indexKey: g.indexKey ? o.indexKey : undefined });
    });
  }

  // App xác thực trên điện thoại: xem và duyệt yêu cầu.
  const approver: express.RequestHandler = (req, res, next) => {
    if (!o.approverToken || !safeEq(String(req.header('x-approver-token') ?? ''), o.approverToken)) return void res.status(401).json({ error: 'approver only' });
    next();
  };
  app.get('/approvals', approver, (_q, r) =>
    r.json([...pending.values()].filter((p) => !p.approved).map((p) => ({ id: p.id, who: S.holders[p.gid]?.name, attrs: p.attrs.map((a) => parseVersioned(a)?.base ?? a) }))));
  app.post('/approvals/:id', approver, (req, res) => {
    const p = pending.get(String(req.params.id));
    if (!p) return void res.status(404).json({ error: 'không có yêu cầu' });
    p.approved = true;
    store.log('approver', 'approve', `${S.holders[p.gid]?.name}`);
    res.json({ ok: true });
  });

  // Phá vỡ kính: bác sĩ tự kích hoạt cho 1 bệnh nhân. KHÔNG im lặng: mỗi nút đều ghi log + bắn cảnh báo.
  app.post('/breakglass', async (req, res) => {
    const h = holderOf(req);
    if (!h) return void res.status(401).json({ error: 'unauthorized' });
    const { patientIdx, reason } = req.body ?? {};
    if (!h.attrs.includes('MED:Role:BacSi')) return void res.status(403).json({ error: 'chỉ bác sĩ mới được phá-vỡ-kính' });
    if (typeof patientIdx !== 'string' || !/^[0-9a-f]{8,64}$/.test(patientIdx) || typeof reason !== 'string' || reason.trim().length < 10)
      return void res.status(400).json({ error: 'cần patientIdx hợp lệ và lý do tối thiểu 10 ký tự' });
    const until = Date.now() + BG_MS;
    const counter = (await epochs()).counters[`MED:BG:${patientIdx}`] ?? 0;
    S.breakGlass.push({ gid: h.gid, patientIdx, until, counter, reason: reason.trim() });
    store.save();
    // Gắn deviceGid của người kích hoạt: agent bảo vệ phía máy chủ dùng nó để phát hiện một thiết bị phá-vỡ-kính NHIỀU bệnh nhân khác nhau trong thời gian ngắn.
    await alert('BREAK_GLASS', 'CRITICAL', `${h.name} phá-vỡ-kính hồ sơ ${patientIdx.slice(0, 8)}… đến ${new Date(until).toISOString()}: ${reason.trim()}`, patientIdx, h.gid);
    res.json({ until });
  });

  app.get('/admin/holders', admin, (_q, r) => r.json(Object.values(S.holders).map(({ token: _t, devicePub: _d, ...h }) => h)));
  app.post('/admin/revoke', admin, async (req, res) => {
    const { gid, attr } = req.body ?? {};
    const h = S.holders[String(gid)];
    if (!h || !h.attrs.includes(attr)) return void res.status(404).json({ error: 'holder/attr không tồn tại' });
    h.attrs = h.attrs.filter((a) => a !== attr);
    store.log('admin', 'attr.revoke', `${h.name} -${attr}`);
    await alert('ATTR_REVOKED', 'WARN', `${o.org} thu hồi ${attr} của ${h.name}`);
    res.json({ ok: true, note: 'Quản trị cần tăng bộ đếm epoch của thuộc tính này ở máy chủ lưu trữ để khoá cũ không mở được dữ liệu bọc lại.' });
  });
  app.post('/admin/holders/:gid/disable', admin, async (req, res) => {
    const h = S.holders[String(req.params.gid)];
    if (!h) return void res.status(404).json({ error: 'không có holder' });
    h.disabled = true;
    store.log('admin', 'holder.disable', h.name);
    await alert('HOLDER_DISABLED', 'WARN', `${o.org} khoá người dùng ${h.name} (mất máy/nghỉ việc)`);
    res.json({ ok: true });
  });
  app.get('/admin/audit', admin, (_q, r) => r.json({ chain: store.verifyAudit(), records: S.audit }));

  return { app, store };
}
