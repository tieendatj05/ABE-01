import { expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { nodeUrl, storageUrl } from './connection.js';
import { gidMessage, MedClient, type ClientState } from './medclient.js';
import { loadOrCreateDeviceKeys, MemoryKeyStore } from './device.js';
import { verifyServerProof } from './server-proof.js';
const secret = new Uint8Array(32).fill(4);
const pk = bytesToHex(ed25519.getPublicKey(secret));
const cfg = { registryPk: pk, k: 2, pk: {}, nodes: [{ org: 'BenhVien', url: 'http://localhost:9001' }] };
function proof(nonce: string, address = '127.0.0.1', port = 8090) {
  const payload = JSON.stringify({ nonce, registryPk: pk, address, port, config: cfg });
  return { payload, signature: bytesToHex(ed25519.sign(new TextEncoder().encode('medabe/discovery/v1|' + payload), secret)) };
}
it('LAN node endpoints follow the verified storage host without changing their ports', () => {
  expect(nodeUrl('http://localhost:9001', 'http://192.168.1.7:8090')).toBe('http://192.168.1.7:9001');
  expect(() => storageUrl('file:///tmp/test')).toThrow();
  expect(() => storageUrl('http://user:password@server.test')).toThrow();
});
it('server proof rejects replay, wrong address, port, signature and registry; localhost supports expanded IPv6', () => {
  const nonce = 'a'.repeat(64);
  expect(verifyServerProof('http://127.0.0.1:8090', nonce, proof(nonce), pk).config.k).toBe(2);
  expect(verifyServerProof('http://localhost:8090', nonce, proof(nonce, '0:0:0:0:0:0:0:1'), pk).registryPk).toBe(pk);
  expect(() => verifyServerProof('http://127.0.0.1:8090', 'b'.repeat(64), proof(nonce), pk)).toThrow();
  expect(() => verifyServerProof('http://127.0.0.2:8090', nonce, proof(nonce), pk)).toThrow();
  expect(() => verifyServerProof('http://127.0.0.1:8091', nonce, proof(nonce), pk)).toThrow();
  expect(() => verifyServerProof('http://127.0.0.1:8090', nonce, { ...proof(nonce), signature: '00'.repeat(64) }, pk)).toThrow();
  expect(() => verifyServerProof('http://127.0.0.1:8090', nonce, proof(nonce), '00'.repeat(32))).toThrow();
});
it('reconnect verifies before sending credentials; suspend blocks cached reads and writes', async () => {
  const state: ClientState = { name: 'Fake', gid: 'gid-one', devicePub: 'device-pub', cert: bytesToHex(ed25519.sign(gidMessage('gid-one', 'device-pub'), secret)), token: 'secret-token',
    deviceId: 'device-one', storageBase: 'http://127.0.0.2:8090', nodes: [{ org: 'BenhVien', url: 'http://127.0.0.2:9001', x: 1, token: 'node-secret', requiresApproval: false }], attrs: [], keys: {}, indexKey: '', bg: {} };
  const requests: { url: string; init: RequestInit }[] = [];
  let wrong = false;
  const f: typeof fetch = async (input, init) => {
    const url = String(input); requests.push({ url, init: init ?? {} });
    if (url.includes('/api/discovery-proof')) {
      const nonce = new URL(url).searchParams.get('nonce')!;
      return Response.json(wrong ? { ...proof(nonce), signature: '00'.repeat(64) } : proof(nonce));
    }
    return Response.json({ n: 0, last: '' });
  };
  const client = new MedClient(state, await loadOrCreateDeviceKeys(new MemoryKeyStore()), f);
  await client.reconnect('http://127.0.0.1:8090');
  expect(state.nodes[0].url).toBe('http://127.0.0.1:9001');
  expect(JSON.stringify(requests)).not.toContain('secret-token');
  expect(JSON.stringify(requests)).not.toContain('node-secret');
  await client.checkConnection();
  client.suspendNetwork();
  await expect(client.openMany([])).rejects.toThrow(/Chưa kết nối/);
  await expect(client.saveRecord({ patientCode: 'fake', type: 'hanhchinh', khoa: 'KSK', data: {} })).rejects.toThrow(/Chưa kết nối/);
  wrong = true;
  await expect(client.reconnect('http://127.0.0.1:8090')).rejects.toThrow();
});
