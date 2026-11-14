// HTTPS cho luồng nghiên cứu: máy khách KIỂM CHỨNG chứng chỉ máy chủ (ghim CA nội bộ + kiểm tên/SAN), không bao giờ tắt kiểm tra.
// Khi truyền `ca`, Node chỉ tin CA đó (thay vì kho CA hệ thống) => đây là ghim CA.
import https from 'node:https';

export interface TlsFetchOptions { minVersion?: 'TLSv1.2' | 'TLSv1.3' }

/** fetch chỉ chấp nhận https:, xác minh chuỗi chứng chỉ theo `ca` và tên máy chủ theo SAN. Không theo chuyển hướng. */
export function tlsFetch(ca: string | Buffer, opts: TlsFetchOptions = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
    if (url.protocol !== 'https:') throw new TypeError(`Chỉ chấp nhận https: (nhận ${url.protocol})`);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const body = init.body == null ? undefined : typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer);
    return new Promise<Response>((resolve, reject) => {
      const req = https.request(url, { method: init.method ?? 'GET', headers, ca, rejectUnauthorized: true, minVersion: opts.minVersion ?? 'TLSv1.2', agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
          const status = res.statusCode ?? 0;
          resolve(new Response(status === 204 || status === 205 || status === 304 ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage, headers: h }));
        });
      });
      req.on('error', reject);
      const signal = init.signal;
      if (signal) {
        const abort = () => req.destroy(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      }
      if (body) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}
