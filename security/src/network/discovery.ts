// Discovery carries only public metadata. The client must verify /api/discovery-proof before sending credentials.
import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { broadcastAddresses, isLanPeer, normalizeIPv4 } from './lan.js';

export const DISCOVERY_PORT = 43821;
export interface DiscoveredServer { url: string; registryPk: string }
const PK = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{64}$/;

export function startDiscovery(options: { port: number; registryPk: string }): { close(): void } {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535 || !PK.test(options.registryPk)) throw new Error('Invalid discovery configuration');
  const socket = createSocket('udp4');
  const recent = new Map<string, { at: number; count: number }>();
  let closed = false;
  const close = () => { if (closed) return; closed = true; try { socket.close(); } catch { /* already closed */ } };
  socket.on('error', (error) => { console.warn(`LAN discovery unavailable (${(error as NodeJS.ErrnoException).code ?? 'UDP error'})`); close(); });
  socket.on('message', (message, remote) => {
    if (closed || message.length > 512 || !isLanPeer(remote.address)) return;
    try {
      const request = JSON.parse(message.toString('utf8')) as { type?: string; v?: number; nonce?: string };
      if (request.type !== 'medabe-discover' || request.v !== 1 || !NONCE.test(request.nonce ?? '')) return;
      const now = Date.now();
      if (recent.size > 1024) for (const [key, entry] of recent) if (now - entry.at > 1000) recent.delete(key);
      if (recent.size > 1024 && !recent.has(remote.address)) return;
      const entry = recent.get(remote.address);
      if (entry && now - entry.at < 1000 && entry.count >= 20) return;
      recent.set(remote.address, { at: entry && now - entry.at < 1000 ? entry.at : now, count: entry && now - entry.at < 1000 ? entry.count + 1 : 1 });
      const response = Buffer.from(JSON.stringify({ type: 'medabe-server', v: 1, nonce: request.nonce, port: options.port, registryPk: options.registryPk }));
      socket.send(response, remote.port, remote.address, () => undefined);
    } catch { /* ignore malformed or unrelated LAN datagrams */ }
  });
  socket.bind(DISCOVERY_PORT, '0.0.0.0');
  socket.unref();
  return { close };
}

export function discoverServers(timeoutMs = 1500): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const nonce = randomBytes(32).toString('hex');
    const request = Buffer.from(JSON.stringify({ type: 'medabe-discover', v: 1, nonce }));
    const found = new Map<string, DiscoveredServer>();
    let finished = false;
    let repeat: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(repeat);
      try { socket.close(); } catch { /* socket did not bind */ }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, Math.max(100, Math.min(5000, timeoutMs)));
    socket.on('error', finish);
    socket.on('message', (message, remote) => {
      if (finished || message.length > 2048 || remote.port !== DISCOVERY_PORT || !isLanPeer(remote.address)) return;
      try {
        const response = JSON.parse(message.toString('utf8')) as { type?: string; v?: number; nonce?: string; port?: number; registryPk?: string };
        const address = normalizeIPv4(remote.address);
        if (!address || response.type !== 'medabe-server' || response.v !== 1 || response.nonce !== nonce || !PK.test(response.registryPk ?? '')
          || !Number.isInteger(response.port) || response.port! < 1 || response.port! > 65535) return;
        const server = { url: `http://${address}:${response.port}`, registryPk: response.registryPk! };
        found.set(server.url + '|' + server.registryPk, server);
      } catch { /* ignore malformed or unrelated LAN datagrams */ }
    });
    socket.bind(0, '0.0.0.0', () => {
      if (finished) return;
      socket.setBroadcast(true); socket.setTTL(1);
      const send = () => {
        if (finished) return;
        // Re-read interfaces for every probe, including after a WiFi address changes.
        for (const target of new Set(['127.0.0.1', ...broadcastAddresses(), '255.255.255.255'])) socket.send(request, DISCOVERY_PORT, target, () => undefined);
      };
      send(); repeat = setTimeout(send, 350);
    });
  });
}
