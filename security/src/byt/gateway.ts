// CỔNG LIÊN THÔNG BỘ Y TẾ (MÔ PHỎNG). Một dịch vụ RIÊNG (kho riêng, khoá ký riêng) đóng vai hệ thống tiếp nhận của Bộ Y tế:
//   - Cơ sở khám gửi các bản ghi ĐÃ MÃ HOÁ (cùng header ABE) lên đây; cổng không có khoá nào, không đọc được nội dung.
//   - Cổng trả BIÊN NHẬN có chữ ký Ed25519 cho từng bản ghi (mã biên nhận, mã cơ sở, băm nội dung, thời điểm nhận). Trạng thái "Đã liên thông" của
//     ứng dụng được lấy từ các biên nhận này, không còn là một cờ tự đặt.
//   - Cán bộ Bộ Y tế (thuộc tính ABE Org:SoYTe) tải ciphertext từ đây rồi giải mã TRÊN MÁY MÌNH.
//   - Phụ huynh tra cứu qua đúng các đường /api/public/* như ở kho chính, nên chỉ cần đổi địa chỉ máy chủ trong ứng dụng phụ huynh.
//   - Ngoài ứng dụng LAN còn có `publicApp`: CHỈ chứa /api/public/* (+ giao diện app phụ huynh nếu có thư mục `staticDir`) và KHÔNG chặn theo LAN, để điện thoại
//     dùng 4G/WiFi khác vẫn tra cứu được (qua đường hầm HTTPS). Mọi đường /byt/* (gửi, tải của nhân viên/Bộ Y tế) KHÔNG có ở đây.
// Xác thực người gửi: chữ ký ECDSA của thiết bị lên từng yêu cầu + chứng chỉ Ed25519 do registry cấp (cổng chỉ cần khoá công khai của registry).
// Giới hạn (mô phỏng): cổng chạy cùng mạng/cùng máy demo, chưa có TLS, chưa kiểm tra quyền ghi của người gửi (ABE chỉ bảo vệ việc ĐỌC).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import express from 'express';
import { deviceIdOf, gidMessage } from '../authority/node.js';
import { certMessage } from '../research/verify.js';
import { JsonStore, type AuditRec } from '../common/persist.js';
import { isLanPeer } from '../network/lan.js';
import { contentHashOf, receiptMessage, type Receipt } from './receipt.js';

const TYPES = new Set(['hanhchinh', 'lankham', 'tiensu', 'thecuc', 'lamsang', 'canlamsang', 'ketluan']);
const HEX = /^[0-9a-f]+$/;
const UUID = /^[0-9a-f-]{36}$/;

export interface Facility { ma: string; ten: string }
export interface GatewayOptions {
  dir: string;
  registryPk: string;           // khoá công khai Ed25519 của registry (để kiểm tra chứng chỉ thiết bị)
  facilities: Facility[];       // các cơ sở được phép gửi (mã CSKCB)
  now?: () => number;
  staticDir?: string;           // thư mục giao diện app phụ huynh (app/parent/dist) để `publicApp` phục vụ cùng nguồn gốc với API
  /** `publicApp` đứng sau đường hầm/proxy: lấy IP thật từ CF-Connecting-IP / X-Forwarded-For. CHỈ bật khi listener chỉ nhận kết nối từ proxy (mặc định bind 127.0.0.1). */
  trustProxy?: boolean;
}

interface StoredRecord {
  id: string; patientIdx: string; groupIdx?: string; parentIdx?: string; parentWrap?: unknown;
  type: string; khoa: string; authorDevice: string; createdAt: string;
  envelope: Record<string, unknown>; receipt: Receipt; updatedAt: string;
}
interface StoredHeader { id: string; policy: string; abe: unknown; wrapIv: string; wrappedDek: string }
interface State {
  seq: number;
  records: Record<string, StoredRecord>;
  headers: Record<string, StoredHeader>;
  audit: AuditRec[];
}

export interface GatewayKey { priv: string; pub: string }
/** Khoá ký của cổng: sinh một lần, cất trong thư mục của cổng. Khoá công khai được máy chủ lưu trữ công bố (có chữ ký registry) cho máy khách ghim. */
export function loadOrCreateGatewayKey(dir: string): GatewayKey {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'key.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as GatewayKey;
  const priv = ed25519.utils.randomSecretKey();
  const key = { priv: bytesToHex(priv), pub: bytesToHex(ed25519.getPublicKey(priv)) };
  writeFileSync(file, JSON.stringify(key), { mode: 0o600 });
  return key;
}

/** Đọc danh sách cơ sở từ facilities.json (tạo file mẫu nếu chưa có). Sửa file này để thêm mã cơ sở khám. */
export function loadFacilities(dir: string, fallback: Facility): Facility[] {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'facilities.json');
  if (!existsSync(file)) writeFileSync(file, JSON.stringify([fallback], null, 2));
  return (JSON.parse(readFileSync(file, 'utf8')) as Facility[]).filter((f) => typeof f.ma === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(f.ma));
}

export function createGateway(o: GatewayOptions) {
  const now = o.now ?? Date.now;
  const key = loadOrCreateGatewayKey(o.dir);
  const store = new JsonStore<State>(o.dir);
  const S = store.open(() => ({ seq: 0, records: {}, headers: {}, audit: [] }));
  const facilities = new Map(o.facilities.map((f) => [f.ma, f]));
  const seenSigs = new Map<string, number>();                       // chống phát lại yêu cầu đã ký (trong cửa sổ thời gian)
  const WINDOW_MS = 5 * 60_000;

  const app = express();
  app.use((req, res, next) => {
    if (!isLanPeer(req.socket.remoteAddress ?? '')) return void res.status(403).json({ error: 'LAN_ONLY: chỉ cho phép thiết bị cùng mạng nội bộ' });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-device, x-ts, x-sig');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { (req as express.Request & { raw?: Buffer }).raw = buf; } }));

  // ---------- xác thực thiết bị ----------
  interface Caller { gid: string; deviceId: string; devicePub: string }
  async function authenticate(req: express.Request): Promise<Caller | string> {
    try {
      const device = JSON.parse(Buffer.from(String(req.header('x-device') ?? ''), 'base64').toString('utf8')) as { gid: string; devicePub: string; cert: string; userId?: string; deviceId?: string };
      const ts = Number(req.header('x-ts')), sig = String(req.header('x-sig') ?? '');
      if (!/^[0-9a-f]{32}$/.test(device.gid) || !/^04[0-9a-f]{128}$/.test(device.devicePub) || !HEX.test(device.cert) || !HEX.test(sig)) return 'thiếu hoặc sai thông tin thiết bị';
      if (!Number.isFinite(ts) || Math.abs(now() - ts) > WINDOW_MS) return 'yêu cầu hết hạn (kiểm tra đồng hồ máy)';
      // Thiết bị đăng ký kiểu cũ: chứng chỉ ký (gid, khoá). Thiết bị của TÀI KHOẢN (email + mật khẩu): chứng chỉ ký thêm userId và deviceId, nên máy gửi kèm hai trường đó (được chứng chỉ bảo vệ, không giả được).
      const account = typeof device.userId === 'string' && typeof device.deviceId === 'string' && device.userId.length > 0 && device.deviceId.length > 0;
      const certMsg = account ? new TextEncoder().encode(certMessage(device.userId!, device.gid, device.deviceId!, device.devicePub)) : gidMessage(device.gid, device.devicePub);
      if (!ed25519.verify(hexToBytes(device.cert), certMsg, hexToBytes(o.registryPk))) return 'chứng chỉ thiết bị không hợp lệ';
      const raw = (req as express.Request & { raw?: Buffer }).raw ?? Buffer.alloc(0);
      const msg = `byt|${req.method}|${req.originalUrl}|${ts}|${bytesToHex(sha256(raw))}`;
      const pub = await crypto.subtle.importKey('raw', hexToBytes(device.devicePub) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, hexToBytes(sig) as BufferSource, new TextEncoder().encode(msg) as BufferSource))) return 'chữ ký yêu cầu không hợp lệ';
      for (const [k, t] of seenSigs) if (now() - t > WINDOW_MS) seenSigs.delete(k);
      if (seenSigs.has(sig)) return 'yêu cầu đã được dùng (phát lại)';
      seenSigs.set(sig, now());
      return { gid: device.gid, devicePub: device.devicePub, deviceId: account ? device.deviceId! : deviceIdOf(device.devicePub) };
    } catch {
      return 'không xác thực được thiết bị';
    }
  }
  const signed: (fn: (req: express.Request, res: express.Response, who: Caller) => unknown) => express.RequestHandler = (fn) => async (req, res) => {
    const who = await authenticate(req);
    if (typeof who === 'string') return void res.status(401).json({ error: who });
    try { await fn(req, res, who); } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  };

  const view = (r: StoredRecord) => ({
    id: r.id, patientIdx: r.patientIdx, groupIdx: r.groupIdx, type: r.type, khoa: r.khoa, authorDevice: r.authorDevice, createdAt: r.createdAt,
    envelope: r.envelope, ...(r.parentIdx ? { parentIdx: r.parentIdx, parentWrap: r.parentWrap } : {}), receipt: r.receipt,
  });
  const headersFor = (rows: StoredRecord[]) => [...new Set(rows.flatMap((r) => (r.envelope.v === 3 ? [String(r.envelope.headerId)] : [])))].map((id) => S.headers[id]).filter(Boolean);

  // ---------- công khai trong LAN ----------
  app.get('/byt/info', (_q, res) => res.json({ name: 'Cổng liên thông Bộ Y tế (mô phỏng)', pk: key.pub, facilities: [...facilities.values()] }));

  // ---------- gửi liên thông ----------
  app.post('/byt/submit', signed((req, res, who) => {
    const { maCskcb, records, headers } = (req.body ?? {}) as { maCskcb?: string; records?: unknown[]; headers?: unknown[] };
    const fac = facilities.get(String(maCskcb));
    if (!fac) return void res.status(403).json({ error: `mã cơ sở "${maCskcb}" chưa được đăng ký ở cổng` });
    if (!Array.isArray(records) || !records.length || records.length > 100) return void res.status(400).json({ error: 'cần 1..100 bản ghi mỗi lần gửi' });
    const incoming = new Map<string, StoredHeader>();
    for (const h of Array.isArray(headers) ? headers.slice(0, 200) : []) {
      const x = h as StoredHeader;
      if (x && UUID.test(String(x.id)) && typeof x.policy === 'string' && x.abe && typeof x.wrapIv === 'string' && HEX.test(x.wrapIv) && typeof x.wrappedDek === 'string' && HEX.test(x.wrappedDek)) incoming.set(x.id, { id: x.id, policy: x.policy, abe: x.abe, wrapIv: x.wrapIv, wrappedDek: x.wrappedDek });
    }
    const receipts: Receipt[] = [];
    const rejected: { id: string; error: string }[] = [];
    let created = 0, refreshed = 0;
    for (const raw of records) {
      const r = raw as Record<string, any>;
      const id = String(r?.id);
      const env = r?.envelope as Record<string, unknown> | undefined;
      const bad = (e: string) => rejected.push({ id, error: e });
      if (!UUID.test(id)) { bad('id sai'); continue; }
      if (!/^[0-9a-f]{32}$/.test(String(r.patientIdx)) || !TYPES.has(String(r.type)) || !/^[A-Za-z0-9_]{1,40}$/.test(String(r.khoa))) { bad('patientIdx/type/khoa sai'); continue; }
      if (!env || typeof env !== 'object' || ![2, 3].includes(Number(env.v)) || !HEX.test(String(env.iv)) || !HEX.test(String(env.ciphertext))) { bad('phong bì sai định dạng'); continue; }
      if (env.v === 3) {
        const hid = String(env.headerId);
        if (!incoming.has(hid) && !S.headers[hid]) { bad('thiếu header khoá chung ' + hid); continue; }
      } else if (!(env.abe as { policy?: unknown } | undefined)?.policy) { bad('thiếu header ABE'); continue; }
      const contentHash = contentHashOf(env as { iv: string; ciphertext: string });
      const have = S.records[id];
      if (have && have.receipt.contentHash !== contentHash) { bad('id đã tồn tại với nội dung khác'); continue; }
      for (const [hid, h] of incoming) if (hid === String(env.headerId)) S.headers[hid] = h;          // cập nhật header (có thể vừa được bọc lại)
      if (have) {
        have.envelope = env; have.updatedAt = new Date(now()).toISOString(); refreshed++;               // cùng nội dung: giữ biên nhận, làm mới phần ABE
        if (/^[0-9a-f]{32}$/.test(String(r.parentIdx)) && r.parentWrap) { have.parentIdx = r.parentIdx; have.parentWrap = r.parentWrap; } // và đường tra cứu phụ huynh (có thể vừa đổi)
        receipts.push(have.receipt);
        continue;
      }
      const base = { receiptId: 'BN-' + randomUUID().slice(0, 8).toUpperCase(), maCskcb: fac.ma, recordId: id, contentHash, receivedAt: new Date(now()).toISOString(), seq: ++S.seq, deviceId: who.deviceId };
      const receipt: Receipt = { ...base, sig: bytesToHex(ed25519.sign(receiptMessage(base), hexToBytes(key.priv))) };
      S.records[id] = {
        id, patientIdx: r.patientIdx, groupIdx: /^[0-9a-f]{32}$/.test(String(r.groupIdx)) ? r.groupIdx : undefined,
        parentIdx: /^[0-9a-f]{32}$/.test(String(r.parentIdx)) ? r.parentIdx : undefined, parentWrap: r.parentWrap,
        type: r.type, khoa: r.khoa, authorDevice: String(r.authorDevice ?? ''), createdAt: String(r.createdAt ?? receipt.receivedAt),
        envelope: env, receipt, updatedAt: receipt.receivedAt,
      };
      receipts.push(receipt); created++;
    }
    store.log(`device:${who.deviceId}`, 'submit', `${fac.ma}: ${created} mới, ${refreshed} làm mới, ${rejected.length} từ chối`);
    res.json({ receipts, created, refreshed, rejected });
  }));

  // ---------- trạng thái: bản ghi nào đã có biên nhận ----------
  app.post('/byt/status', signed((req, res) => {
    const ids = (req.body as { ids?: unknown }).ids;
    if (!Array.isArray(ids) || ids.length > 500) return void res.status(400).json({ error: 'ids: tối đa 500' });
    res.json({ receipts: ids.map((id) => S.records[String(id)]?.receipt).filter(Boolean) });
  }));

  // ---------- Bộ Y tế tải ciphertext (quyền đọc do ABE quyết định, không do cổng) ----------
  app.get('/byt/records', signed((req, res) => {
    const { patientIdx, groupIdx, type } = req.query as Record<string, string | undefined>;
    let rows: StoredRecord[];
    if (patientIdx && /^[0-9a-f]{32}$/.test(patientIdx)) rows = Object.values(S.records).filter((r) => r.patientIdx === patientIdx);
    else if (groupIdx && /^[0-9a-f]{32}$/.test(groupIdx) && type && TYPES.has(type)) {
      const latest = new Map<string, StoredRecord>();                          // bản MỚI NHẤT của mỗi (bệnh nhân, khoa) trong đơn vị
      for (const r of Object.values(S.records)) {
        if (r.groupIdx !== groupIdx || r.type !== type) continue;
        const k = r.patientIdx + '|' + r.khoa;
        const p = latest.get(k);
        if (!p || r.createdAt >= p.createdAt) latest.set(k, r);
      }
      rows = [...latest.values()].slice(0, 5000);
    } else return void res.status(400).json({ error: 'cần patientIdx, hoặc groupIdx kèm type' });
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ records: rows.map(view), headers: headersFor(rows) });
  }));

  app.get('/byt/stats', signed((_req, res) => {
    const by = new Map<string, { patients: Set<string>; records: number; types: Record<string, number> }>();
    for (const r of Object.values(S.records)) {
      const e = by.get(r.receipt.maCskcb) ?? { patients: new Set(), records: 0, types: {} };
      e.patients.add(r.patientIdx); e.records++; e.types[r.type] = (e.types[r.type] ?? 0) + 1;
      by.set(r.receipt.maCskcb, e);
    }
    res.json({ total: Object.keys(S.records).length, facilities: [...facilities.values()].map((f) => ({ ...f, records: by.get(f.ma)?.records ?? 0, patients: by.get(f.ma)?.patients.size ?? 0, types: by.get(f.ma)?.types ?? {} })) });
  }));

  // ---------- phụ huynh tra cứu qua Bộ Y tế: cùng hình dạng với /api/public/* của kho chính ----------
  // Cửa sổ trượt đếm theo khoá (IP). Dùng đồng hồ `now` để kiểm thử được.
  const windowed = (windowMs: number) => {
    const m = new Map<string, number[]>();
    const live = (k: string) => { const t = now(); const a = (m.get(k) ?? []).filter((x) => t - x < windowMs); if (a.length) m.set(k, a); else m.delete(k); return a; };
    return {
      add(k: string) { if (m.size > 20_000) for (const x of [...m.keys()]) live(x); const a = live(k); a.push(now()); m.set(k, a); return a.length; },
      count: (k: string) => live(k).length,
    };
  };
  const recordsHits = windowed(60_000), versionHits = windowed(60_000), allHits = windowed(60_000);
  const misses = windowed(10 * 60_000);                       // lần tra cứu KHÔNG ra kết quả theo IP: dấu hiệu dò CCCD
  const MISS_LIMIT = 15, RECORDS_PER_MIN = 20, VERSION_PER_MIN = 120, ALL_PER_MIN = 900;
  const parentRows = (idx: string) => Object.values(S.records).filter((r) => r.parentIdx === idx && r.parentWrap).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const mountParent = (a: express.Express, ipOf: (req: express.Request) => string) => {
    a.get('/api/public/ping', (_q, res) => res.json({ ok: true, name: 'KSK' }));
    a.get('/api/public/parent-records', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const ip = ipOf(req);
      if (misses.count(ip) >= MISS_LIMIT) return void res.status(429).json({ error: 'tra cứu không ra kết quả quá nhiều lần, thử lại sau ít phút' });
      if (recordsHits.add(ip) > RECORDS_PER_MIN || allHits.add('*') > ALL_PER_MIN) return void res.status(429).json({ error: 'tra cứu quá nhanh, thử lại sau' });
      const idx = String(req.query.parentIdx ?? '');
      if (!/^[0-9a-f]{32}$/.test(idx)) return void res.status(400).json({ error: 'parentIdx sai' });
      const rows = parentRows(idx).slice(0, 500);
      if (rows.length) store.log('phu-huynh', 'parent.view', `parentIdx=${idx.slice(0, 8)} ${rows.length} bản ghi`);
      else misses.add(ip);
      res.json(rows.map((r) => ({ id: r.id, patientIdx: r.patientIdx, type: r.type, khoa: r.khoa, createdAt: r.createdAt, envelope: { iv: r.envelope.iv, ciphertext: r.envelope.ciphertext }, parentWrap: r.parentWrap })));
    });
    a.get('/api/public/parent-version', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (versionHits.add(ipOf(req)) > VERSION_PER_MIN || allHits.add('*') > ALL_PER_MIN) return void res.status(429).json({ error: 'quá nhanh' });
      const idx = String(req.query.parentIdx ?? '');
      if (!/^[0-9a-f]{32}$/.test(idx)) return void res.status(400).json({ error: 'parentIdx sai' });
      const rows = parentRows(idx);
      res.json({ n: rows.length, last: rows.length ? rows[rows.length - 1].createdAt : '' });
    });
  };
  mountParent(app, (req) => req.socket.remoteAddress ?? '?');

  // ---------- ứng dụng CÔNG KHAI (qua đường hầm HTTPS): chỉ đường tra cứu của phụ huynh + giao diện ----------
  const forwarded = (req: express.Request) => req.header('cf-connecting-ip') || String(req.header('x-forwarded-for') ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  const publicApp = express();
  publicApp.disable('x-powered-by');
  publicApp.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');                       // WebView của app (https://localhost, capacitor://localhost) gọi chéo nguồn gốc
      res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') return void res.sendStatus(204);
    }
    next();
  });
  mountParent(publicApp, o.trustProxy ? forwarded : (req) => req.socket.remoteAddress ?? '?');
  const dist = o.staticDir && existsSync(join(o.staticDir, 'index.html')) ? o.staticDir : undefined;
  if (dist) {
    publicApp.use(express.static(dist, { index: 'index.html', setHeaders: (res, file) => { if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); } }));
    publicApp.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/byt/') ? void res.sendFile(join(dist, 'index.html')) : next()));
  }
  publicApp.use((_req, res) => res.status(404).json({ error: 'not found' }));

  return { app, publicApp, store, publicKey: key.pub };
}
