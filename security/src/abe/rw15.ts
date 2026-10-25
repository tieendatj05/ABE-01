// CP-ABE (Rouselakis–Waters 2015, prime-order, BLS12-381) với KHOÁ SINH NGƯỠNG t-trên-n:
// bí mật gốc (α, β) của cơ quan KHÔNG nằm ở máy nào - nó được chia Shamir cho n nút (bệnh viện, Sở Y tế,
// xác thực điện thoại...). Cần >= t nút cùng đồng thuận mới tạo được một khoá thuộc tính hợp lệ, nên một nút
// bị hack không thể giả mạo khoá.
//
//   Dealer     : α, β ngẫu nhiên; PK = ( e(g1,g2)^α , g1^β ); chia f_α(x), f_β(x) bậc t-1 cho x = 1..n rồi XOÁ α, β.
//   Nút i      : cho (gid, attr): t_i ngẫu nhiên;  K_i = g2^{α_i} · H(gid)^{β_i} · F(attr)^{t_i} ,  K'_i = g1^{t_i}
//   Người dùng : K = Π K_i^{λ_i} = g2^α · H(gid)^β · F(attr)^t ,  K' = Π K'_i^{λ_i} = g1^t  với t = Σ λ_i t_i
//   Mã hoá     : như RW15 (xem encapsulate). Ràng buộc thuộc tính nằm trong F(attr) nên người dùng không tự
//                tạo khoá cho thuộc tính khác từ phần khoá của một nút.
//
// Lai: DEK ngẫu nhiên mã hoá dữ liệu (AES-256-GCM); ABE chỉ bọc DEK. Nhờ vậy có thể BỌC LẠI DEK dưới policy/epoch
// mới mà không đụng vào dữ liệu (rewrap) - dùng cho thu hồi.

import { bls12_381 as bls } from '@noble/curves/bls12-381.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { mod, reconstruction, toLsss } from './lsss.js';
import { leavesOf, parsePolicy } from './policy.js';

const { Fr, Fp12 } = bls.fields;
const G1 = bls.G1.Point;
const G2 = bls.G2.Point;
type P1 = InstanceType<typeof G1>;
type P2 = InstanceType<typeof G2>;
type GT = ReturnType<typeof Fp12.mul>;

const R = Fr.ORDER;
const DST_F = 'MEDABE-RW15-F-BLS12381G2_XMD:SHA-256_SSWU_RO_';
const DST_H = 'MEDABE-RW15-H-BLS12381G2_XMD:SHA-256_SSWU_RO_';

function randScalar(): bigint {
  for (;;) {
    const v = BigInt('0x' + bytesToHex(crypto.getRandomValues(new Uint8Array(64)))) % R;
    if (v !== 0n) return v;
  }
}
const toG2 = (msg: string, dst: string) => bls.G2.hashToCurve(new TextEncoder().encode(msg), { DST: dst }) as unknown as P2;
const F = (attr: string) => toG2(attr, DST_F);
const H = (gid: string) => toG2(gid, DST_H);
const mulG1 = (p: P1, k: bigint) => (mod(k) === 0n ? G1.ZERO : p.multiply(mod(k)));
const hex = (p: { toBytes(): Uint8Array }) => bytesToHex(p.toBytes());
const gtHex = (x: GT) => bytesToHex(Fp12.toBytes(x));
const gtFrom = (s: string) => Fp12.fromBytes(hexToBytes(s));
const g1From = (s: string) => G1.fromBytes(hexToBytes(s));
const g2From = (s: string) => G2.fromBytes(hexToBytes(s));

let EGG: GT | undefined;
const egg = () => (EGG ??= bls.pairing(G1.BASE, G2.BASE));

/** Cơ quan logic của một thuộc tính = phần trước dấu ':' đầu tiên (vd "MED:Khoa:NoiTiet" -> "MED"). */
export const authorityOf = (attr: string) => {
  const i = attr.indexOf(':');
  if (i <= 0) throw new Error(`Thuộc tính "${attr}" thiếu tên cơ quan (dạng CoQuan:ThuocTinh)`);
  return attr.slice(0, i);
};

export interface AuthorityPublic { id: string; eAlpha: string; gBeta: string }
export interface Share { id: string; x: number; k: number; n: number; alpha: string; beta: string }
export interface Partial { x: number; K: string; Kp: string }
export interface AttrKey { K: string; Kp: string }
export interface AbeHeader { policy: string; rows: { C1: string; C2: string; C3: string; C4: string }[] }
export interface Envelope {
  v: 2;
  abe: AbeHeader;
  wrapIv: string;
  wrappedDek: string;
  iv: string;
  ciphertext: string;
}

// ---------- Dealer + khoá sinh ngưỡng ----------
const evalPoly = (coef: bigint[], x: number) => {
  let y = 0n;
  for (let i = coef.length - 1; i >= 0; i--) y = (y * BigInt(x) + coef[i]) % R;
  return y;
};

/** Chạy MỘT LẦN khi khởi tạo; α, β chỉ tồn tại trong hàm này rồi bị bỏ. (PoC: dealer tin cậy; bản thật dùng DKG.) */
export function dealAuthority(id: string, n: number, k: number): { pk: AuthorityPublic; shares: Share[] } {
  if (k < 1 || k > n) throw new Error('Cần 1 <= k <= n');
  const alpha = randScalar();
  const beta = randScalar();
  const fa = [alpha, ...Array.from({ length: k - 1 }, randScalar)];
  const fb = [beta, ...Array.from({ length: k - 1 }, randScalar)];
  return {
    pk: { id, eAlpha: gtHex(Fp12.pow(egg(), alpha)), gBeta: hex(G1.BASE.multiply(beta)) },
    shares: Array.from({ length: n }, (_, i) => ({
      id, x: i + 1, k, n,
      alpha: evalPoly(fa, i + 1).toString(16), beta: evalPoly(fb, i + 1).toString(16),
    })),
  };
}

/** Một nút (SAU KHI đã tự duyệt yêu cầu theo chính sách của nó) trả phần khoá cho (gid, attr). */
export function partialKey(share: Share, gid: string, attr: string): Partial {
  if (authorityOf(attr) !== share.id) throw new Error(`Nút của ${share.id} không cấp thuộc tính ${attr}`);
  const t = randScalar();
  const K = G2.BASE.multiply(BigInt('0x' + share.alpha))
    .add(H(gid).multiply(BigInt('0x' + share.beta)))
    .add(F(attr).multiply(t));
  return { x: share.x, K: hex(K), Kp: hex(G1.BASE.multiply(t)) };
}

function lambdaAt0(i: number, xs: number[]): bigint {
  let num = 1n, den = 1n;
  for (const j of xs) {
    if (j === i) continue;
    num = (num * BigInt(-j)) % R;
    den = (den * BigInt(i - j)) % R;
  }
  return (mod(num) * Fr.inv(mod(den))) % R;
}

/** Người dùng ghép >= k phần khoá của CÙNG thuộc tính thành khoá hoàn chỉnh. */
export function combineKey(partials: Partial[], k: number): AttrKey {
  const xs = [...new Set(partials.map((p) => p.x))];
  if (xs.length < k) throw new Error(`Cần ít nhất ${k} nút đồng thuận, mới có ${xs.length}`);
  const use = partials.filter((p, i) => partials.findIndex((q) => q.x === p.x) === i).slice(0, k);
  const set = use.map((p) => p.x);
  let K = G2.ZERO, Kp = G1.ZERO;
  for (const p of use) {
    const l = lambdaAt0(p.x, set);
    K = K.add(g2From(p.K).multiply(l));
    Kp = Kp.add(g1From(p.Kp).multiply(l));
  }
  return { K: hex(K), Kp: hex(Kp) };
}

// ---------- KEM ----------
function encapsulate(pks: Record<string, AuthorityPublic>, policy: string) {
  const tree = parsePolicy(policy);
  for (const a of new Set(leavesOf(tree))) {
    if (!pks[authorityOf(a)]) throw new Error(`Thiếu khoá công khai của cơ quan "${authorityOf(a)}"`);
  }
  const l = toLsss(tree);
  const s = randScalar();
  const v = [s, ...Array.from({ length: l.cols - 1 }, randScalar)];
  const w = [0n, ...Array.from({ length: l.cols - 1 }, randScalar)];
  const dot = (row: bigint[], vec: bigint[]) => mod(row.reduce((acc, a, i) => acc + mod(a) * vec[i], 0n));

  const rows = l.rows.map((row, x) => {
    const pk = pks[authorityOf(l.attrs[x])];
    const t = randScalar();
    return {
      C1: gtHex(Fp12.mul(Fp12.pow(egg(), dot(row, v)), Fp12.pow(gtFrom(pk.eAlpha), t))),
      C2: hex(mulG1(G1.BASE, -t)),
      C3: hex(mulG1(g1From(pk.gBeta), t).add(mulG1(G1.BASE, dot(row, w)))),
      C4: hex(F(l.attrs[x]).multiply(t)),
    };
  });
  return { header: { policy, rows } as AbeHeader, key: sha256(Fp12.toBytes(Fp12.pow(egg(), s))) };
}

function decapsulate(gid: string, keys: Record<string, AttrKey>, header: AbeHeader): Uint8Array | null {
  const l = toLsss(parsePolicy(header.policy));
  if (l.rows.length !== header.rows.length) throw new Error('Ciphertext không khớp policy');
  const coef = reconstruction(l, l.attrs.map((a, i) => (keys[a] ? i : -1)).filter((i) => i >= 0));
  if (!coef) return null;
  const Hg = H(gid);
  let acc = Fp12.ONE;
  for (const [x, c] of coef) {
    if (c === 0n) continue;
    const r = header.rows[x];
    const k = keys[l.attrs[x]];
    const prod = bls.pairingBatch([
      { g1: g1From(r.C3), g2: Hg },
      { g1: g1From(r.C2), g2: g2From(k.K) },
      { g1: g1From(k.Kp), g2: g2From(r.C4) },
    ]);
    acc = Fp12.mul(acc, Fp12.pow(Fp12.mul(gtFrom(r.C1), prod), c));
  }
  return sha256(Fp12.toBytes(acc));
}

// ---------- Lai: DEK + AES-256-GCM ----------
const aes = (raw: Uint8Array, use: KeyUsage[]) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, use);
const enc = (s: string) => new TextEncoder().encode(s) as BufferSource;
const gcmEnc = async (key: Uint8Array, iv: Uint8Array, aad: string, data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc(aad) }, await aes(key, ['encrypt']), data as BufferSource));
const gcmDec = async (key: Uint8Array, iv: Uint8Array, aad: string, data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc(aad) }, await aes(key, ['decrypt']), data as BufferSource));

/** `ctx` gắn dữ liệu với ngữ cảnh bản ghi (vd "bệnh nhân|loại|id") để chống tráo phong bì giữa các bản ghi. */
export async function encrypt(pks: Record<string, AuthorityPublic>, policy: string, plaintext: Uint8Array, ctx: string, dek: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): Promise<Envelope> {
  const { header, key } = encapsulate(pks, policy);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    v: 2,
    abe: header,
    wrapIv: bytesToHex(wrapIv),
    wrappedDek: bytesToHex(await gcmEnc(key, wrapIv, policy, dek)),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(await gcmEnc(dek, iv, ctx, plaintext)),
  };
}

async function unwrapDek(gid: string, keys: Record<string, AttrKey>, env: Envelope): Promise<Uint8Array | null> {
  const key = decapsulate(gid, keys, env.abe);
  if (!key) return null;
  return gcmDec(key, hexToBytes(env.wrapIv), env.abe.policy, hexToBytes(env.wrappedDek));
}

/** null = các khoá đang giữ không thoả policy. Ném lỗi nếu khoá sai GID/epoch, ctx sai hoặc ciphertext bị sửa. */
export async function decrypt(gid: string, keys: Record<string, AttrKey>, env: Envelope, ctx: string): Promise<Uint8Array | null> {
  const dek = await unwrapDek(gid, keys, env);
  if (!dek) return null;
  return gcmDec(dek, hexToBytes(env.iv), ctx, hexToBytes(env.ciphertext));
}

/** DEK của một phong bì riêng (để bọc thêm cho phụ huynh). null = không thoả policy. */
export const openDek = unwrapDek;

/** Bọc lại DEK dưới policy/epoch mới; dữ liệu (iv, ciphertext) giữ nguyên. Người gọi phải đang giải mã được. */
export async function rewrap(gid: string, keys: Record<string, AttrKey>, env: Envelope, pks: Record<string, AuthorityPublic>, newPolicy: string): Promise<Envelope | null> {
  const dek = await unwrapDek(gid, keys, env);
  if (!dek) return null;
  const { header, key } = encapsulate(pks, newPolicy);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  return { ...env, abe: header, wrapIv: bytesToHex(wrapIv), wrappedDek: bytesToHex(await gcmEnc(key, wrapIv, newPolicy, dek)) };
}

// ---------- Khoá chung theo chính sách (KeyHeader) ----------
// Nhiều bản ghi CÙNG chính sách dùng chung MỘT header ABE: ABE chỉ chạy 1 lần cho cả lô (nhập 1.000 học sinh = 1 phép ABE),
// còn mỗi bản ghi mã hoá bằng khoá con HKDF(DEK, recordId). Người đọc được header thì đọc được cả lô - vốn đã đúng theo chính
// sách chung đó. Thu hồi chỉ cần bọc lại header (1 dòng) thay vì từng bản ghi.
export interface KeyHeader { policy: string; abe: AbeHeader; wrapIv: string; wrappedDek: string }
export interface SharedEnvelope { v: 3; headerId: string; iv: string; ciphertext: string }

const subKey = (dek: Uint8Array, recordId: string) => hkdf(sha256, dek, undefined, new TextEncoder().encode('medabe/rec/' + recordId), 32);

export async function newKeyHeader(pks: Record<string, AuthorityPublic>, policy: string): Promise<{ header: KeyHeader; dek: Uint8Array }> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const { header, key } = encapsulate(pks, policy);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  return { header: { policy, abe: header, wrapIv: bytesToHex(wrapIv), wrappedDek: bytesToHex(await gcmEnc(key, wrapIv, policy, dek)) }, dek };
}

/** null = khoá đang giữ không thoả policy của header. Ném lỗi nếu khoá sai epoch/GID hoặc header bị sửa. */
export async function openKeyHeader(gid: string, keys: Record<string, AttrKey>, h: KeyHeader): Promise<Uint8Array | null> {
  const key = decapsulate(gid, keys, h.abe);
  return key ? gcmDec(key, hexToBytes(h.wrapIv), h.policy, hexToBytes(h.wrappedDek)) : null;
}

/** Bọc lại cùng DEK dưới policy/epoch mới (người gọi phải đã mở được header, tức đang có `dek`). */
export async function rewrapKeyHeader(pks: Record<string, AuthorityPublic>, newPolicy: string, dek: Uint8Array): Promise<KeyHeader> {
  const { header, key } = encapsulate(pks, newPolicy);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  return { policy: newPolicy, abe: header, wrapIv: bytesToHex(wrapIv), wrappedDek: bytesToHex(await gcmEnc(key, wrapIv, newPolicy, dek)) };
}

/** Khoá nội dung riêng của một bản ghi trong lô dùng header chung (để bọc cho phụ huynh). */
export const sharedRecordKey = subKey;

export async function encryptShared(dek: Uint8Array, headerId: string, recordId: string, plaintext: Uint8Array, ctx: string): Promise<SharedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { v: 3, headerId, iv: bytesToHex(iv), ciphertext: bytesToHex(await gcmEnc(subKey(dek, recordId), iv, ctx, plaintext)) };
}

export async function decryptShared(dek: Uint8Array, recordId: string, env: SharedEnvelope, ctx: string): Promise<Uint8Array> {
  return gcmDec(subKey(dek, recordId), hexToBytes(env.iv), ctx, hexToBytes(env.ciphertext));
}
