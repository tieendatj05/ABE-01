import { expect, it } from 'vitest';
import { isLanPeer, sameSubnet } from './lan.js';
import { discoverServers, startDiscovery } from './discovery.js';
it('LAN masks support non-/24 networks and fail closed on invalid/IPv6/WAN addresses', () => {
  expect(sameSubnet('192.168.2.5', '192.168.3.7', '255.255.254.0')).toBe(true);
  expect(sameSubnet('192.168.2.5', '192.168.3.7', '255.255.255.0')).toBe(false);
  expect(sameSubnet('192.168.1.4', '192.168.1.1', '255.255.255.252')).toBe(false);
  expect(sameSubnet('192.168.1.4', '192.168.1.1', '0.0.0.0')).toBe(false);
  expect(isLanPeer('127.0.0.1')).toBe(true);
  expect(isLanPeer('::ffff:127.0.0.1')).toBe(true);
  expect(isLanPeer('203.0.113.254')).toBe(false);
  expect(isLanPeer('2001:db8::1')).toBe(false);
});
it('a local server is discovered using the sender address and matching nonce', async () => {
  const responder = startDiscovery({ port: 19090, registryPk: 'a'.repeat(64) });
  try {
    await new Promise((r) => setTimeout(r, 50));
    const servers = await discoverServers(500);
    expect(servers.some((s) => s.url === 'http://127.0.0.1:19090' && s.registryPk === 'a'.repeat(64))).toBe(true);
  } finally { responder.close(); }
});
