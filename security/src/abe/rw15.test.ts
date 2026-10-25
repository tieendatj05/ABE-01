import { describe, expect, it } from 'vitest';
import { combineKey, dealAuthority, decrypt, decryptShared, encrypt, encryptShared, newKeyHeader, openKeyHeader, partialKey, rewrap, rewrapKeyHeader, type AttrKey, type Share } from './rw15.js';

const msg = new TextEncoder().encode('Chan doan: viem phoi; di ung penicillin');
const CTX = 'BN001|kham|r1';

// 3 nút: Bệnh viện (1), Sở Y tế (2), xác thực điện thoại (3); cần 2 nút đồng thuận.
const { pk, shares } = dealAuthority('MED', 3, 2);
const pks = { MED: pk };
const [bv, syt, dt] = shares;
const keyOf = (gid: string, attr: string, nodes: Share[], k = 2): AttrKey =>
  combineKey(nodes.map((s) => partialKey(s, gid, attr)), k);
const keysFor = (gid: string, attrs: string[], nodes: Share[]) =>
  Object.fromEntries(attrs.map((a) => [a, keyOf(gid, a, nodes)])) as Record<string, AttrKey>;

describe('khoá sinh ngưỡng 2-trên-3', () => {
  it('bất kỳ 2 trong 3 nút cùng cấp đều cho khoá dùng được', async () => {
    const policy = 'MED:Role:BacSi AND MED:Khoa:NoiTiet';
    const env = await encrypt(pks, policy, msg, CTX);
    for (const pair of [[bv, syt], [bv, dt], [syt, dt]]) {
      const k = keysFor('bs1', ['MED:Role:BacSi', 'MED:Khoa:NoiTiet'], pair);
      expect(await decrypt('bs1', k, env, CTX)).toEqual(msg);
    }
  }, 120_000);

  it('một nút đơn lẻ (bị hack) không đủ để tạo khoá', () => {
    expect(() => combineKey([partialKey(bv, 'bs1', 'MED:Role:BacSi')], 2)).toThrow(/ít nhất 2 nút/);
  });

  it('kẻ ép k=1 với phần khoá của một nút thì ra khoá RÁC, không giải mã được', async () => {
    const env = await encrypt(pks, 'MED:Role:BacSi', msg, CTX);
    const forged = { 'MED:Role:BacSi': combineKey([partialKey(bv, 'hacker', 'MED:Role:BacSi')], 1) };
    await expect(decrypt('hacker', forged, env, CTX)).rejects.toThrow();
  }, 60_000);

  it('phần khoá của một thuộc tính không dùng được cho thuộc tính khác', async () => {
    const env = await encrypt(pks, 'MED:Role:Admin', msg, CTX);
    const k = keyOf('bs1', 'MED:Role:BacSi', [bv, syt]);
    // đổi tên thuộc tính trên giấy: khoá vẫn bị ràng buộc với F(BacSi)
    await expect(decrypt('bs1', { 'MED:Role:Admin': k }, env, CTX)).rejects.toThrow();
  }, 60_000);
});

describe('phong bì lai (DEK) và chống thông đồng', () => {
  it('người không thoả policy bị từ chối; khoá khác GID ghép lại cũng hỏng', async () => {
    const env = await encrypt(pks, 'MED:Role:BacSi AND MED:Khoa:NoiTiet', msg, CTX);
    expect(await decrypt('a', keysFor('a', ['MED:Role:BacSi'], [bv, syt]), env, CTX)).toBeNull();
    const merged = { ...keysFor('a', ['MED:Role:BacSi'], [bv, syt]), ...keysFor('b', ['MED:Khoa:NoiTiet'], [bv, syt]) };
    await expect(decrypt('a', merged, env, CTX)).rejects.toThrow();
  }, 120_000);

  it('ctx sai (tráo phong bì sang bản ghi khác) bị từ chối', async () => {
    const env = await encrypt(pks, 'MED:Role:BacSi', msg, CTX);
    const k = keysFor('a', ['MED:Role:BacSi'], [bv, syt]);
    await expect(decrypt('a', k, env, 'BN002|kham|r9')).rejects.toThrow();
  }, 60_000);
});

describe('rewrap: bọc lại khoá sau thu hồi', () => {
  it('đổi epoch: khoá cũ không mở được bản đã bọc lại, khoá mới thì được, dữ liệu không đổi', async () => {
    const oldAttr = 'MED:Khoa:NoiTiet#W41.0';
    const newAttr = 'MED:Khoa:NoiTiet#W41.1';
    const env = await encrypt(pks, oldAttr, msg, CTX);
    const oldKey = keysFor('bs1', [oldAttr], [bv, syt]);
    const newKey = keysFor('bs2', [newAttr], [bv, syt]); // bs2 còn quyền, bs1 bị thu hồi

    const re = await rewrap('bs1', oldKey, env, pks, newAttr); // người còn quyền bọc lại; ở đây dùng khoá cũ khi họ chưa bị thu
    expect(re).not.toBeNull();
    expect(re!.ciphertext).toBe(env.ciphertext);
    expect(re!.iv).toBe(env.iv);
    expect(await decrypt('bs2', newKey, re!, CTX)).toEqual(msg);
    expect(await decrypt('bs1', oldKey, re!, CTX)).toBeNull(); // khoá epoch cũ không còn thoả policy mới
  }, 120_000);
});

describe('khoá chung theo chính sách (KeyHeader)', () => {
  const { pk, shares } = dealAuthority('MED', 3, 2);
  const pks = { MED: pk };
  const key = (gid: string, attrs: string[]) =>
    Object.fromEntries(attrs.map((a) => [a, combineKey([partialKey(shares[0], gid, a), partialKey(shares[1], gid, a)], 2)])) as Record<string, AttrKey>;

  it('1 header cho cả lô: mỗi bản ghi có khoá con riêng; người đủ quyền mở được tất cả, người thiếu quyền không mở được', async () => {
    const policy = 'MED:Role:TiepDon OR MED:Role:BacSi';
    const { header, dek } = await newKeyHeader(pks, policy);
    const envs = await Promise.all(['r1', 'r2', 'r3'].map((id) => encryptShared(dek, 'h1', id, new TextEncoder().encode('du lieu ' + id), 'ctx|' + id)));
    const k = key('u', ['MED:Role:TiepDon']);
    const opened = await openKeyHeader('u', k, header);            // MỘT phép ABE
    expect(opened).not.toBeNull();
    for (const [i, id] of ['r1', 'r2', 'r3'].entries()) {
      expect(new TextDecoder().decode(await decryptShared(opened!, id, envs[i], 'ctx|' + id))).toBe('du lieu ' + id);
    }
    expect(await openKeyHeader('x', key('x', ['MED:Role:KTV']), header)).toBeNull();
    // tráo phong bì giữa 2 bản ghi cùng lô (khoá con theo recordId) hoặc sai ngữ cảnh -> thất bại
    await expect(decryptShared(opened!, 'r2', envs[0], 'ctx|r1')).rejects.toThrow();
    await expect(decryptShared(opened!, 'r1', envs[0], 'ctx|SAI')).rejects.toThrow();
  }, 120_000);

  it('bọc lại header sang epoch mới: cùng DEK nên bản ghi cũ vẫn giải mã được; khoá epoch cũ hết tác dụng', async () => {
    const { header, dek } = await newKeyHeader(pks, 'MED:Role:BacSi#2026W41.0');
    const env = await encryptShared(dek, 'h', 'rec', new TextEncoder().encode('x'), 'c');
    const re = await rewrapKeyHeader(pks, 'MED:Role:BacSi#2026W41.1', dek);
    const newKey = key('u', ['MED:Role:BacSi#2026W41.1']);
    const dek2 = await openKeyHeader('u', newKey, re);
    expect(new TextDecoder().decode(await decryptShared(dek2!, 'rec', env, 'c'))).toBe('x');
    expect(await openKeyHeader('u', key('u', ['MED:Role:BacSi#2026W41.0']), re)).toBeNull();
    expect(await openKeyHeader('u', key('u', ['MED:Role:BacSi#2026W41.0']), header)).not.toBeNull();
  }, 120_000);
});
