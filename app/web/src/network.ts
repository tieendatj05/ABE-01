import { bridge } from './bridge.js';

export const allowedServer = (base: string) => bridge ? bridge.network.allowed(base) : Promise.resolve(true);
export const discoverServers = () => bridge ? bridge.network.discover() : Promise.resolve([]);

export async function enrollmentAt(base: string): Promise<boolean> {
  if (!(await allowedServer(base))) throw new Error('Máy chủ không nằm trên mạng nội bộ đang kết nối.');
  if (bridge) await bridge.network.probe(base);
  const r = await fetch(base.replace(/\/+$/, '') + '/api/enrollment', { signal: AbortSignal.timeout(2500), redirect: 'error' });
  if (!r.ok) throw new Error('Máy chủ chưa sẵn sàng');
  return !!((await r.json()) as { open?: boolean }).open;
}
