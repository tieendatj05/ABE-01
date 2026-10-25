import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const bearer = (req: Request) => (req.header('authorization') ?? '').replace(/^Bearer /, '');

/**
 * Chống dò token quản trị: sai quá `max` lần trong `windowMs` từ cùng một địa chỉ thì khoá địa chỉ đó trong `windowMs` (HTTP 429),
 * kể cả khi sau đó đưa đúng token - kẻ dò không biết lúc nào mình đã đoán trúng.
 */
export function makeFailLimiter(max = 5, windowMs = 60_000, now: () => number = Date.now) {
  const m = new Map<string, { n: number; start: number; blockedUntil: number }>();
  return {
    blocked(ip: string) { return (m.get(ip)?.blockedUntil ?? 0) > now(); },
    fail(ip: string) {
      const e = m.get(ip);
      if (!e || now() - e.start > windowMs) { m.set(ip, { n: 1, start: now(), blockedUntil: 0 }); return; }
      e.n++;
      if (e.n >= max) e.blockedUntil = now() + windowMs;
    },
    ok(ip: string) { m.delete(ip); },
  };
}

export const requireAdmin = (adminToken: string, limiter = makeFailLimiter()) => (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '?';
  if (limiter.blocked(ip)) return void res.status(429).json({ error: 'quá nhiều lần thử sai, thử lại sau' });
  if (!safeEq(String(req.header('x-admin-token') ?? ''), adminToken)) { limiter.fail(ip); return void res.status(401).json({ error: 'admin only' }); }
  limiter.ok(ip);
  next();
};

/** Token là bearer (không cookie) nên cho phép gọi chéo nguồn: thiết bị nói chuyện trực tiếp với từng cơ quan. */
export const cors = (origin = '*') => (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-admin-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return void res.sendStatus(204);
  next();
};
