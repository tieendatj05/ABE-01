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
export function isLanPeer(address: string): boolean {
  if (isLoopback(address)) return true;
  const normalized = normalizeIPv4(address);
  if (!normalized || normalized === '0.0.0.0' || normalized === '255.255.255.255' || Number(normalized.split('.')[0]) >= 224) return false;
  return localIPv4().some((entry) => sameSubnet(normalized, entry.address, entry.netmask));
}
export function broadcastAddresses(): string[] {
  return [...new Set(localIPv4().flatMap(({ address, netmask }) => {
    const ip = integer(address), mask = integer(netmask);
    if (ip === null || mask === null || !sameSubnet(address, address, netmask)) return [];
    const value = (ip | ~mask) >>> 0;
    return [[24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')];
  }))];
}
