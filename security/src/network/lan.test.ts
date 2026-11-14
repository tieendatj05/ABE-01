import { expect, it } from 'vitest';
import { isLanPeer, parseZones, sameSubnet, zoneOf } from './lan.js';
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

it('nhiều VLAN: vùng CIDR được cấp phép vào được (kể cả khác subnet card vật lý), vùng lạ bị chặn, vùng chỉ là ngữ cảnh', () => {
  const zones = parseZones('TIEPDON:10.10.10.0/24, NHI:10.10.20.0/24,MAT:10.10.30.0/23');
  expect(zoneOf('10.10.10.7', zones, false)).toBe('TIEPDON');
  expect(zoneOf('10.10.20.254', zones, false)).toBe('NHI');
  expect(zoneOf('10.10.31.9', zones, false)).toBe('MAT');                         // /23 gồm 10.10.30.x và 10.10.31.x
  expect(zoneOf('::ffff:10.10.20.8', zones, false)).toBe('NHI');
  expect(zoneOf('127.0.0.1', zones, false)).toBe('LOOPBACK');
  for (const bad of ['10.10.40.1', '10.11.20.5', '192.168.1.10', '203.0.113.5', '0.0.0.0', '255.255.255.255', '224.0.0.1', '2001:db8::1', 'abc', '10.10.20.256'])
    expect(zoneOf(bad, zones, false)).toBeNull();
  expect(() => parseZones('NHI10.10.20.0/24')).toThrow();
  expect(() => parseZones('NHI:10.10.20.0/33')).toThrow();
  expect(() => parseZones('NHI:10.10.20.0')).toThrow();
});

it('biến môi trường MEDABE_NETWORK_ZONES điều khiển isLanPeer của nút cấp khoá; bỏ cấu hình thì về hành vi cũ', () => {
  const old = process.env.MEDABE_NETWORK_ZONES, oldFb = process.env.MEDABE_NETWORK_SAME_SUBNET;
  try {
    process.env.MEDABE_NETWORK_ZONES = 'NHI:10.10.20.0/24'; delete process.env.MEDABE_NETWORK_SAME_SUBNET;
    expect(isLanPeer('10.10.20.9')).toBe(true);
    expect(isLanPeer('10.10.21.9')).toBe(false);
    expect(isLanPeer('127.0.0.1')).toBe(true);
    delete process.env.MEDABE_NETWORK_ZONES;
    expect(isLanPeer('10.10.20.9')).toBe(false);                                   // không cấu hình, không cùng subnet thật => từ chối như cũ
  } finally { if (old === undefined) delete process.env.MEDABE_NETWORK_ZONES; else process.env.MEDABE_NETWORK_ZONES = old; if (oldFb !== undefined) process.env.MEDABE_NETWORK_SAME_SUBNET = oldFb; }
});
