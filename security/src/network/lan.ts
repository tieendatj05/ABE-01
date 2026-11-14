// Network boundaries use actual socket addresses and current physical IPv4 interfaces.
import { networkInterfaces } from 'node:os';

export interface LocalIPv4 { address: string; netmask: string }
const VIRTUAL = /vmware|virtual|vethernet|vbox|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|bluetooth|wireguard|tunnel|tap-|tun\d/i;

export function normalizeIPv4(address: string): string | null {
  const value = address.toLowerCase().replace(/^::ffff:/, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts.join('.') : null;
}
const integer = (address: string): number | null => {
  const normalized = normalizeIPv4(address);
  return normalized === null ? null : normalized.split('.').reduce((n, octet) => ((n << 8) | Number(octet)) >>> 0, 0);
};
export const isLoopback = (address: string): boolean => address === '::1' || address === '0:0:0:0:0:0:0:1' || normalizeIPv4(address)?.startsWith('127.') === true;

export function sameSubnet(address: string, localAddress: string, netmask: string): boolean {
  const peer = integer(address), local = integer(localAddress), mask = integer(netmask);
  if (peer === null || local === null || mask === null || mask === 0) return false;
  const inverse = (~mask) >>> 0;
  if (((inverse + 1) & inverse) !== 0) return false; // reject non-contiguous netmasks
  return (peer & mask) === (local & mask);
}

export function localIPv4(): LocalIPv4[] {
  return Object.entries(networkInterfaces()).filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([, addresses]) => (addresses ?? [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal && normalizeIPv4(entry.address) !== null && entry.netmask !== '0.0.0.0')
      .map(({ address, netmask }) => ({ address, netmask })));
}
// ---- Nhiều VLAN: danh sách CIDR được cấp phép (MEDABE_NETWORK_ZONES="TIEPDON:10.10.10.0/24,NHI:10.10.20.0/24"). Vùng chỉ là NGỮ CẢNH mạng, không cấp quyền. ----
export interface Zone { name: string; net: number; prefix: number }
export function parseZones(raw: string): Zone[] {
  return raw.split(',').map((x) => x.trim()).filter(Boolean).map((item) => {
    const i = item.indexOf(':');
    const [ip, bits] = item.slice(i + 1).split('/');
    const net = i > 0 ? integer(ip ?? '') : null;
    const prefix = Number(bits);
    if (net === null || !/^[A-Za-z0-9_-]{1,40}$/.test(item.slice(0, i)) || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) throw new Error('MEDABE_NETWORK_ZONES sai định dạng (TEN:CIDR): ' + item);
    return { name: item.slice(0, i), net, prefix };
  });
}
const maskOf = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
/** Tên vùng mạng của địa chỉ socket thật ("LOOPBACK", vùng cấu hình, "LOCAL-SUBNET") hoặc null nếu không được phép. Không tin header chuyển tiếp. */
export function zoneOf(address: string, zones: Zone[] = parseZones(process.env.MEDABE_NETWORK_ZONES ?? ''), sameSubnetFallback?: boolean): string | null {
  if (isLoopback(address)) return 'LOOPBACK';
  const normalized = normalizeIPv4(address);
  if (!normalized || normalized === '0.0.0.0' || normalized === '255.255.255.255' || Number(normalized.split('.')[0]) >= 224) return null;
  const v = integer(normalized)!;
  for (const z of zones) if (((v & maskOf(z.prefix)) >>> 0) === ((z.net & maskOf(z.prefix)) >>> 0)) return z.name;
  const env = process.env.MEDABE_NETWORK_SAME_SUBNET;
  const fallback = sameSubnetFallback ?? (env ? env === 'true' : zones.length === 0);       // không cấu hình vùng => hành vi cũ (cùng subnet)
  return fallback && localIPv4().some((entry) => sameSubnet(normalized, entry.address, entry.netmask)) ? 'LOCAL-SUBNET' : null;
}
export function isLanPeer(address: string): boolean {
  return zoneOf(address) !== null;
}
export function broadcastAddresses(): string[] {
  return [...new Set(localIPv4().flatMap(({ address, netmask }) => {
    const ip = integer(address), mask = integer(netmask);
    if (ip === null || mask === null || !sameSubnet(address, address, netmask)) return [];
    const value = (ip | ~mask) >>> 0;
    return [[24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')];
  }))];
}
