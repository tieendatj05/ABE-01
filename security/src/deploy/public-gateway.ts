// CỔNG LỌC cho TRUY CẬP TỪ XA (Internet qua đường hầm). Đứng trước máy chủ, CHỈ nghe loopback; đường hầm (cloudflared) trỏ vào đây.
// Vì sao cần: nếu trỏ thẳng đường hầm vào Spring, mọi người trên Internet sẽ trông như "loopback" (qua được kiểm tra LAN) và chạm được cả
// đường quản trị cũ (/api/admin/*, token), đường nội bộ của nút cấp khoá, SIEM... Cổng này:
//   1) chỉ cho đi qua danh sách trắng đường dẫn nghiệp vụ (xem ALLOW); mọi thứ khác → 404;
//   2) XOÁ mọi header bí mật khách gửi lên (X-Service-Token, X-Admin-Token, X-Siem-Token, X-Medabe-Client-IP, X-Forwarded-*) và tự đặt
//      X-Medabe-Client-IP = IP khách thật (CF-Connecting-IP) để máy chủ giới hạn đăng nhập/ghi nhật ký đúng người;
//   3) gom 3 nút cấp khoá về cùng một địa chỉ: /n/<tổ chức>/v2/partials (chỉ POST đúng đường này) và viết lại /api/config cho khớp;
//   4) giới hạn tốc độ theo IP khách (chống quét/đoán mật khẩu ở tầng ngoài; máy chủ còn khoá tài khoản + giới hạn riêng).
// KHÔNG cho Internet đổi cấu hình truy cập từ xa (PUT /api/v2/admin/remote): chỉ người ngồi ở máy chủ (LAN/loopback) bật/tắt được.
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface GatewayOptions { port: number; springPort: number; nodePorts: Record<string, number>; maxPerMinute?: number }

const ALLOW: RegExp[] = [
  /^GET \/api\/v2\/(status|policy|auth\/challenge|auth\/me|devices|admin\/(schedule|users|devices|audit|remote))$/,
  /^POST \/api\/v2\/(auth\/(login|logout|password)|devices|keys\/ticket|admin\/users|admin\/devices\/[0-9a-f]{16}\/revoke|admin\/users\/[^/]+\/reset-password|(baseline|abe)\/records(\/batch)?)$/,
  /^PUT \/api\/v2\/admin\/(schedule|users\/[^/]+)$/,
  /^GET \/api\/v2\/(baseline|abe)\/records\/[0-9a-f-]{36}$/,
  /^GET \/api\/(epochs|config|app\/version|app\/download)$/,
  /^(GET|POST|PUT|DELETE) \/api\/records(\/[A-Za-z0-9._-]+(\/header)?)?$/,
  /^(GET|POST|PUT) \/api\/headers(\/[A-Za-z0-9-]+)?$/,
  /^POST \/api\/events$/,
];
const STRIP = new Set(['x-service-token', 'x-admin-token', 'x-siem-token', 'x-approver-token', 'x-medabe-client-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
  'x-real-ip', 'forwarded', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'te', 'trailer', 'host']);

const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };

export function allowedPath(method: string, rawUrl: string): { path: string } | null {
  const path = new URL(rawUrl, 'http://x').pathname;
  if (/%2e|%2f|%5c|\.\.|\/\//i.test(rawUrl.split('?')[0])) return null;          // không cho mã hoá/đi vòng đường dẫn
  return ALLOW.some((r) => r.test(`${method} ${path}`)) ? { path } : null;
}

export function startPublicGateway(o: GatewayOptions): Server {
  const hits = new Map<string, { n: number; t: number }>();
  const limit = o.maxPerMinute ?? 600;
  const clean = (h: IncomingHttpHeaders) => {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(h)) if (v !== undefined && !STRIP.has(k.toLowerCase())) out[k] = v;
    return out;
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const ip = String(req.headers['cf-connecting-ip'] ?? '127.0.0.1').split(',')[0].trim();
    const now = Date.now();
    const e = hits.get(ip);
    if (!e || now - e.t > 60_000) hits.set(ip, { n: 1, t: now }); else if (++e.n > limit) return void json(res, 429, { error: 'RATE_LIMIT' });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > 60_000) hits.delete(k);
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    if (method === 'OPTIONS') return void res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' }).end();

    // Nút cấp khoá: chỉ POST /n/<tổ chức>/v2/partials
    const nm = /^\/n\/([A-Za-z0-9_-]{1,40})\/v2\/partials$/.exec(new URL(url, 'http://x').pathname);
    let target: { port: number; path: string } | null = null;
    if (nm) { if (method === 'POST' && o.nodePorts[nm[1]]) target = { port: o.nodePorts[nm[1]], path: '/v2/partials' }; }
    else { const a = allowedPath(method, url); if (a) target = { port: o.springPort, path: a.path + (url.includes('?') ? url.slice(url.indexOf('?')) : '') }; }
    if (!target) return void json(res, 404, { error: 'NOT_FOUND' });

    const headers = { ...clean(req.headers), 'x-medabe-client-ip': ip };
    const up = httpRequest({ host: '127.0.0.1', port: target.port, method, path: target.path, headers, timeout: 60_000 }, (ur) => {
      if (url.split('?')[0] === '/api/config' && ur.statusCode === 200) {        // địa chỉ các nút = đường dẫn qua cổng này
        const chunks: Buffer[] = [];
        ur.on('data', (c: Buffer) => chunks.push(c));
        ur.on('end', () => {
          try {
            const cfg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { nodes?: { org: string; url: string }[] };
            const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
            const base = `${proto}://${req.headers.host}`;
            cfg.nodes = (cfg.nodes ?? []).map((n) => ({ org: n.org, url: `${base}/n/${n.org}` }));
            json(res, 200, cfg);
          } catch { json(res, 502, { error: 'BAD_UPSTREAM' }); }
        });
        return;
      }
      const h = { ...ur.headers }; delete h['transfer-encoding']; delete h.connection;
      res.writeHead(ur.statusCode ?? 502, { ...h, 'access-control-allow-origin': '*' });
      ur.pipe(res);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'UPSTREAM_UNAVAILABLE' }); else res.destroy(); });
    req.pipe(up);
  });
  server.listen(o.port, '127.0.0.1');
  return server;
}
