import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { AuthorityPublic } from '../abe/rw15.js';
import { storageUrl } from './connection.js';

export interface ServerConfig {
  registryPk: string; k: number; pk: AuthorityPublic; nodes: { org: string; url: string }[];
  /** Cổng liên thông Bộ Y tế (mô phỏng): địa chỉ + khoá công khai Ed25519 để kiểm tra biên nhận. Nằm trong cấu hình có chữ ký của registry. */
  byt?: { url: string; pk: string };
}
export interface ServerProofPayload {
  nonce: string; registryPk: string; address: string; port: number; config: ServerConfig;
}
export class ServerProofError extends Error {}

const normalizeAddress = (raw: string) => {
  let address = raw.toLowerCase().replace(/^\[|\]$/g, '');
  if (address.startsWith('::ffff:')) address = address.slice(7);
  return address === '0:0:0:0:0:0:0:1' ? '::1' : address;
};
const isLoopback = (raw: string) => {
  const address = normalizeAddress(raw);
  return address === 'localhost' || address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
};
const isNumeric = (address: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address) || address.includes(':');
export const newProofNonce = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

/** Public configuration is accepted only with a fresh, endpoint-bound signature. */
export function verifyServerProof(base: string, nonce: string, proof: unknown, expectedRegistryPk?: string): ServerProofPayload {
  try {
    if (!/^[0-9a-f]{64}$/.test(nonce)) throw new Error('nonce');
    const target = new URL(storageUrl(base));
    const host = normalizeAddress(target.hostname);
    if (!isNumeric(host) && host !== 'localhost') throw new Error('numeric address required');
    if (!proof || typeof proof !== 'object') throw new Error('proof');
    const { payload, signature } = proof as { payload?: unknown; signature?: unknown };
    if (typeof payload !== 'string' || payload.length > 100_000 || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) throw new Error('shape');
    const value = JSON.parse(payload) as ServerProofPayload;
    if (value.nonce !== nonce || !/^[0-9a-f]{64}$/i.test(value.registryPk) || value.config?.registryPk !== value.registryPk) throw new Error('identity');
    if (expectedRegistryPk && expectedRegistryPk.toLowerCase() !== value.registryPk.toLowerCase()) throw new Error('registry changed');
    const address = normalizeAddress(value.address);
    if (!(host === 'localhost' ? isLoopback(address) : host === address)) throw new Error('address mismatch');
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    if (value.port !== port || !Number.isInteger(value.port)) throw new Error('port mismatch');
    if (!Number.isInteger(value.config.k) || value.config.k < 1 || !value.config.pk || !Array.isArray(value.config.nodes) ||
      !value.config.nodes.every((node) => typeof node.org === 'string' && typeof node.url === 'string')) throw new Error('config');
    if (!ed25519.verify(hexToBytes(signature), new TextEncoder().encode('medabe/discovery/v1|' + payload), hexToBytes(value.registryPk))) throw new Error('signature');
    return value;
  } catch {
    throw new ServerProofError('Không xác minh được chữ ký, địa chỉ hoặc danh tính máy chủ KSK.');
  }
}

/** This request never includes a device or authority token and never follows redirects. */
export async function requestServerProof(base: string, fetcher: typeof fetch, expectedRegistryPk?: string, signal?: AbortSignal): Promise<ServerProofPayload> {
  const address = storageUrl(base), nonce = newProofNonce();
  const response = await fetcher(address + '/api/discovery-proof?nonce=' + nonce, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) throw new ServerProofError('Máy chủ chưa hỗ trợ xác minh kết nối hoặc chưa sẵn sàng.');
  return verifyServerProof(address, nonce, await response.json(), expectedRegistryPk);
}
