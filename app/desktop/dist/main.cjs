"use strict";

// app/desktop/main.ts
var import_promises = require("node:dns/promises");

// security/src/network/discovery.ts
var import_node_crypto = require("node:crypto"), import_node_dgram = require("node:dgram");

// security/src/network/lan.ts
var import_node_os = require("node:os"), VIRTUAL = /vmware|virtual|vethernet|vbox|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|bluetooth|wireguard|tunnel|tap-|tun\d/i;
function normalizeIPv4(address) {
  let value = address.toLowerCase().replace(/^::ffff:/, "");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  let parts = value.split(".").map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts.join(".") : null;
}
var integer = (address) => {
  let normalized = normalizeIPv4(address);
  return normalized === null ? null : normalized.split(".").reduce((n, octet) => (n << 8 | Number(octet)) >>> 0, 0);
}, isLoopback = (address) => address === "::1" || address === "0:0:0:0:0:0:0:1" || normalizeIPv4(address)?.startsWith("127.") === !0;
function sameSubnet(address, localAddress, netmask) {
  let peer = integer(address), local = integer(localAddress), mask = integer(netmask);
  if (peer === null || local === null || mask === null || mask === 0) return !1;
  let inverse = ~mask >>> 0;
  return (inverse + 1 & inverse) !== 0 ? !1 : (peer & mask) === (local & mask);
}
function localIPv4() {
  return Object.entries((0, import_node_os.networkInterfaces)()).filter(([name]) => !VIRTUAL.test(name)).flatMap(([, addresses]) => (addresses ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal && normalizeIPv4(entry.address) !== null && entry.netmask !== "0.0.0.0").map(({ address, netmask }) => ({ address, netmask })));
}
function parseZones(raw) {
  return raw.split(",").map((x) => x.trim()).filter(Boolean).map((item) => {
    let i = item.indexOf(":"), [ip, bits] = item.slice(i + 1).split("/"), net = i > 0 ? integer(ip ?? "") : null, prefix = Number(bits);
    if (net === null || !/^[A-Za-z0-9_-]{1,40}$/.test(item.slice(0, i)) || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) throw new Error("MEDABE_NETWORK_ZONES sai \u0111\u1ECBnh d\u1EA1ng (TEN:CIDR): " + item);
    return { name: item.slice(0, i), net, prefix };
  });
}
var maskOf = (prefix) => prefix === 0 ? 0 : 4294967295 << 32 - prefix >>> 0;
function zoneOf(address, zones = parseZones(process.env.MEDABE_NETWORK_ZONES ?? ""), sameSubnetFallback) {
  if (isLoopback(address)) return "LOOPBACK";
  let normalized = normalizeIPv4(address);
  if (!normalized || normalized === "0.0.0.0" || normalized === "255.255.255.255" || Number(normalized.split(".")[0]) >= 224) return null;
  let v = integer(normalized);
  for (let z of zones) if ((v & maskOf(z.prefix)) >>> 0 === (z.net & maskOf(z.prefix)) >>> 0) return z.name;
  let env = process.env.MEDABE_NETWORK_SAME_SUBNET;
  return (sameSubnetFallback ?? (env ? env === "true" : zones.length === 0)) && localIPv4().some((entry) => sameSubnet(normalized, entry.address, entry.netmask)) ? "LOCAL-SUBNET" : null;
}
function isLanPeer(address) {
  return zoneOf(address) !== null;
}
function broadcastAddresses() {
  return [...new Set(localIPv4().flatMap(({ address, netmask }) => {
    let ip = integer(address), mask = integer(netmask);
    if (ip === null || mask === null || !sameSubnet(address, address, netmask)) return [];
    let value = (ip | ~mask) >>> 0;
    return [[24, 16, 8, 0].map((shift) => value >>> shift & 255).join(".")];
  }))];
}

// security/src/network/discovery.ts
var DISCOVERY_PORT = 43821, PK = /^[0-9a-f]{64}$/;
function discoverServers(timeoutMs = 1500) {
  return new Promise((resolve2) => {
    let socket = (0, import_node_dgram.createSocket)("udp4"), nonce = (0, import_node_crypto.randomBytes)(32).toString("hex"), request = Buffer.from(JSON.stringify({ type: "medabe-discover", v: 1, nonce })), found = /* @__PURE__ */ new Map(), finished = !1, repeat, finish = () => {
      if (!finished) {
        finished = !0, clearTimeout(timer), clearTimeout(repeat);
        try {
          socket.close();
        } catch {
        }
        resolve2([...found.values()]);
      }
    }, timer = setTimeout(finish, Math.max(100, Math.min(5e3, timeoutMs)));
    socket.on("error", finish), socket.on("message", (message, remote) => {
      if (!(finished || message.length > 2048 || remote.port !== DISCOVERY_PORT || !isLanPeer(remote.address)))
        try {
          let response = JSON.parse(message.toString("utf8")), address = normalizeIPv4(remote.address);
          if (!address || response.type !== "medabe-server" || response.v !== 1 || response.nonce !== nonce || !PK.test(response.registryPk ?? "") || !Number.isInteger(response.port) || response.port < 1 || response.port > 65535) return;
          let server = { url: `http://${address}:${response.port}`, registryPk: response.registryPk };
          found.set(server.url + "|" + server.registryPk, server);
        } catch {
        }
    }), socket.bind(0, "0.0.0.0", () => {
      if (finished) return;
      socket.setBroadcast(!0), socket.setTTL(1);
      let send = () => {
        if (!finished)
          for (let target of /* @__PURE__ */ new Set(["127.0.0.1", ...broadcastAddresses(), "255.255.255.255"])) socket.send(request, DISCOVERY_PORT, target, () => {
          });
      };
      send(), repeat = setTimeout(send, 350);
    });
  });
}

// node_modules/@noble/hashes/_u64.js
var U32_MASK64 = BigInt(4294967295), _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = !1) {
  return le ? { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) } : { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = !1) {
  let len = lst.length, Ah = new Uint32Array(len), Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    let { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0, fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
  let h = fromNumH(n), l = fromNumL(n);
  view.setUint32(byteOffset, isLE ? l : h, isLE), view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}
var shrSH = (h, _l, s) => h >>> s, shrSL = (h, l, s) => h << 32 - s | l >>> s, rotrSH = (h, l, s) => h >>> s | l << 32 - s, rotrSL = (h, l, s) => h << 32 - s | l >>> s, rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32, rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  let l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0), add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0, add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0), add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0, add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0), add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n != "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  length !== void 0 && anumber(length, "length");
  let bytes = isBytes(value), ofLen = length !== void 0 ? ` of length ${length}` : "", got = bytes ? `length=${value.length}` : `type=${typeof value}`, message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  throw bytes ? new RangeError(message) : new TypeError(message);
}
var aobject = (value, label) => {
  if (value === null || typeof value != "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
}, aopts = (value, label) => {
  aobject(value, label);
  let proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = !0) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  let min = instance.outputLen;
  if (!(out.length >= min))
    throw new RangeError('"output" expected length >= ' + min);
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++)
    arrays[i].fill(0);
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var hasHexBuiltin = /* @ts-ignore */ typeof Uint8Array.from([]).toHex == "function" && typeof Uint8Array.fromHex == "function", hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  if (abytes(bytes), hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++)
    hex += hexes[bytes[i]];
  return hex;
}
function asciiToBase16(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - 55 : ch >= 97 && ch <= 102 ? ch - 87 : void 0;
}
function hexToBytes(hex) {
  if (typeof hex != "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      throw error instanceof SyntaxError ? new RangeError(error.message) : error;
    }
  let hl = hex.length, al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  let array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    let n1 = asciiToBase16(hex.charCodeAt(hi)), n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      let char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    let a = arrays[i];
    abytes(a), sum += a.length;
  }
  let res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    let a = arrays[i];
    res.set(a, pad), pad += a.length;
  }
  return res;
}
function checkOpts(defaults, opts, title = "opts") {
  return aopts(defaults, "defaults"), opts !== void 0 && aopts(opts, title), Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons != "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  let hashC = (msg, opts) => hashCons(opts).update(msg).digest(), tmp = hashCons(void 0);
  return hashC.outputLen = tmp.outputLen, hashC.blockLen = tmp.blockLen, hashC.canXOF = tmp.canXOF, hashC.create = (opts) => hashCons(opts), Object.assign(hashC, info), Object.freeze(hashC);
}
function randomBytes2(bytesLength = 32) {
  anumber(bytesLength, "bytesLength");
  let cr = typeof globalThis == "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues != "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = !1;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = !1;
  length = 0;
  pos = 0;
  destroyed = !1;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen, this.outputLen = outputLen, this.padOffset = padOffset, this.isLE = isLE, this.buffer = new Uint8Array(blockLen), this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this), abytes(data);
    let { view, buffer, blockLen } = this, len = data.length, processed = !1;
    for (let pos = 0; pos < len; ) {
      let take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        let dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = !0;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos), this.pos += take, pos += take, this.pos === blockLen && (this.process(view, 0), this.pos = 0, processed = !0);
    }
    return this.length += data.length, processed && this.roundClean(), this;
  }
  digestInto(out) {
    aexists(this), aoutput(out, this), this.finished = !0;
    let { buffer, view, blockLen, isLE } = this, { pos } = this;
    buffer[pos++] = 128, buffer.fill(0, pos), this.padOffset > blockLen - pos && (this.process(view, 0), buffer.fill(0)), setU64FromNum(view, blockLen - 8, this.length * 8, isLE), this.process(view, 0), this.roundClean();
    let oview = out === buffer ? view : createView(out), len = this.outputLen, outLen = len / 4, state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    let { buffer, outputLen } = this;
    this.digestInto(buffer);
    let res = buffer.slice(0, outputLen);
    return this.destroy(), res;
  }
  _cloneIntoMeta(to) {
    let { buffer, length, finished, destroyed, pos } = this;
    return to.destroyed = destroyed, to.finished = finished, to.length = length, to.pos = pos, pos && to.buffer.set(buffer), to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// node_modules/@noble/hashes/sha2.js
var K512 = split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))), SHA512_Kh = K512[0], SHA512_Kl = K512[1], SHA512_W_H = /* @__PURE__ */ new Uint32Array(80), SHA512_W_L = /* @__PURE__ */ new Uint32Array(80), SHA2_64B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // h -- high 32 bits, l -- low 32 bits
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and slows hashing down (measured on sha256).
  Ah = 0;
  Al = 0;
  Bh = 0;
  Bl = 0;
  Ch = 0;
  Cl = 0;
  Dh = 0;
  Dl = 0;
  Eh = 0;
  El = 0;
  Fh = 0;
  Fl = 0;
  Gh = 0;
  Gl = 0;
  Hh = 0;
  Hl = 0;
  constructor(outputLen, IV) {
    super(128, outputLen, 16, !1), this.Ah = IV[0] | 0, this.Al = IV[1] | 0, this.Bh = IV[2] | 0, this.Bl = IV[3] | 0, this.Ch = IV[4] | 0, this.Cl = IV[5] | 0, this.Dh = IV[6] | 0, this.Dl = IV[7] | 0, this.Eh = IV[8] | 0, this.El = IV[9] | 0, this.Fh = IV[10] | 0, this.Fl = IV[11] | 0, this.Gh = IV[12] | 0, this.Gl = IV[13] | 0, this.Hh = IV[14] | 0, this.Hl = IV[15] | 0;
  }
  // prettier-ignore
  get() {
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0, this.Al = Al | 0, this.Bh = Bh | 0, this.Bl = Bl | 0, this.Ch = Ch | 0, this.Cl = Cl | 0, this.Dh = Dh | 0, this.Dl = Dl | 0, this.Eh = Eh | 0, this.El = El | 0, this.Fh = Fh | 0, this.Fl = Fl | 0, this.Gh = Gh | 0, this.Gl = Gl | 0, this.Hh = Hh | 0, this.Hl = Hl | 0;
  }
  _cloneInto(to) {
    return (to ||= new this.constructor()).set(...this.get()), this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA512_W_H[i] = view.getUint32(offset), SHA512_W_L[i] = view.getUint32(offset += 4);
    for (let i = 16; i < 80; i++) {
      let W15h = SHA512_W_H[i - 15] | 0, W15l = SHA512_W_L[i - 15] | 0, s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7), s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7), W2h = SHA512_W_H[i - 2] | 0, W2l = SHA512_W_L[i - 2] | 0, s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6), s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6), SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]), SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0, SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      let sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41), sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41), CHIh = Eh & Fh ^ ~Eh & Gh, CHIl = El & Fl ^ ~El & Gl, T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]), T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]), T1l = T1ll | 0, sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39), sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39), MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch, MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0, Hl = Gl | 0, Gh = Fh | 0, Gl = Fl | 0, Fh = Eh | 0, Fl = El | 0, { h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0), Dh = Ch | 0, Dl = Cl | 0, Ch = Bh | 0, Cl = Bl | 0, Bh = Ah | 0, Bl = Al | 0;
      let All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh), Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0)), { h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0), { h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0), { h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0), { h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0), { h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0), { h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0), { h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0), this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    this.destroyed = !0, clean(this.buffer), this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}, _SHA512 = class extends SHA2_64B {
  constructor() {
    super(64, SHA512_IV);
  }
};
var sha512 = /* @__PURE__ */ createHasher(
  () => new _SHA512(),
  /* @__PURE__ */ oidNist(3)
);

// node_modules/@noble/curves/utils.js
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes2 = (value, length, title) => abytes(value, length, title), anumber2 = anumber;
function aobject2(value, title = "object") {
  if (value === null || typeof value != "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value != "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex2 = bytesToHex, concatBytes2 = (...arrays) => concatBytes(...arrays), hexToBytes2 = (hex) => hexToBytes(hex), isBytes2 = isBytes, randomBytes3 = (bytesLength) => randomBytes2(bytesLength), _0n = /* @__PURE__ */ BigInt(0), _1n = /* @__PURE__ */ BigInt(1), atitle2 = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value != "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n == "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber2(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value != "number") {
    let prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    let prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function hexToNumber(hex) {
  if (typeof hex != "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  if (anumber(len), len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  let expectedLen = len * 2, hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
function isPosBig(n) {
  return typeof n == "bigint" && _0n <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n ? 0 : n.toString(2).length;
}
var bitMask = (n) => (asafenumber(n, "n"), (_1n << BigInt(n)) - _1n);
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title), aobject2(fields, "fields"), aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    let label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`, val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function"))
      throw new TypeError(`${label} is invalid: expected own property`);
    if (isOpt && val === void 0)
      return;
    let current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  let iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, !1), iter(optFields, !0);
}

// node_modules/@noble/curves/abstract/modular.js
var _0n2 = /* @__PURE__ */ BigInt(0), _1n2 = /* @__PURE__ */ BigInt(1), _2n = /* @__PURE__ */ BigInt(2), _3n = /* @__PURE__ */ BigInt(3), _4n = /* @__PURE__ */ BigInt(4), _5n = /* @__PURE__ */ BigInt(5), _7n = /* @__PURE__ */ BigInt(7), _8n = /* @__PURE__ */ BigInt(8), _9n = /* @__PURE__ */ BigInt(9), _15n = /* @__PURE__ */ BigInt(15), _16n = /* @__PURE__ */ BigInt(16), POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  let result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power != "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return _1n2;
  if (power === _1n2)
    return num;
  let d = num % modulo;
  if (d < _0n2 && (d += modulo), power < POW_WINDOWED_MIN) {
    let p2 = _1n2;
    for (; power > _0n2; )
      power & _1n2 && (p2 = p2 * d % modulo), d = d * d % modulo, power >>= _1n2;
    return p2;
  }
  let digits = [];
  for (; power > _0n2; )
    digits.push(Number(power & _15n)), power >>= _4n;
  let table = new Array(16);
  table[0] = _1n2, table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo, p = p * p % modulo, p = p * p % modulo, p = p * p % modulo;
    let digit = digits[w];
    digit !== 0 && (p = p * table[digit] % modulo);
  }
  return p;
}
function pow2(x, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  for (; power-- > _0n2; )
    res *= res, res %= modulo;
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n2)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo), b = modulo, x = _0n2, u = _1n2;
  for (; a !== _0n2; ) {
    let q = b / a, r = b - a * q, m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  if (b !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp2, root, n) {
  let F = Fp2;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n2) === _0n2)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp2, n) {
  let F = Fp2, p1div4 = (F.ORDER + _1n2) / _4n, root = F.pow(n, p1div4);
  return assertIsSquare(F, root, n), root;
}
function sqrt5mod8(Fp2, n) {
  let F = Fp2, p5div8 = (F.ORDER - _5n) / _8n, n2 = F.mul(n, _2n), v = F.pow(n2, p5div8), nv = F.mul(n, v), i = F.mul(F.mul(nv, _2n), v), root = F.mul(nv, F.sub(i, F.ONE));
  return assertIsSquare(F, root, n), root;
}
function sqrt9mod16(P) {
  let Fp_ = Field(P), tn = tonelliShanks(P), c1 = tn(Fp_, Fp_.neg(Fp_.ONE)), c2 = tn(Fp_, c1), c3 = tn(Fp_, Fp_.neg(c1)), c4 = (P + _7n) / _16n;
  return ((Fp2, n) => {
    let F = Fp2, tv1 = F.pow(n, c4), tv2 = F.mul(tv1, c1), tv3 = F.mul(tv1, c2), tv4 = F.mul(tv1, c3), e1 = F.eql(F.sqr(tv2), n), e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1), tv2 = F.cmov(tv4, tv3, e2);
    let e3 = F.eql(F.sqr(tv2), n), root = F.cmov(tv1, tv2, e3);
    return assertIsSquare(F, root, n), root;
  });
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P, "tonelliShanks");
  let Q = P - _1n2, S = 0;
  for (; Q % _2n === _0n2; )
    Q /= _2n, S++;
  let Z = _2n, _Fp = Field(P);
  for (; FpLegendre(_Fp, Z) === 1; )
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q), Q1div2 = (Q + _1n2) / _2n;
  return function(Fp2, n) {
    let F = Fp2;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S, c = F.mul(F.ONE, cc), t = F.pow(n, Q), R = F.pow(n, Q1div2);
    for (; !F.eql(t, F.ONE); ) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1, t_tmp = F.sqr(t);
      for (; !F.eql(t_tmp, F.ONE); )
        if (i++, t_tmp = F.sqr(t_tmp), i === M)
          throw new Error("Cannot find square root");
      let exponent = _1n2 << BigInt(M - i - 1), b = F.pow(c, exponent);
      M = i, c = F.sqr(b), t = F.mul(t, c), R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  return aoddModulus(P, "Fp.sqrt"), P % _4n === _3n ? sqrt3mod4 : P % _8n === _5n ? sqrt5mod8 : P % _16n === _9n ? sqrt9mod16(P) : tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2, FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  if (aobject2(field, "field"), typeof field.ORDER != "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES"), asafenumber(field.BITS, "BITS");
  for (let name of FIELD_FIELDS)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch(Fp2, nums, passZero = !1) {
  validateField(Fp2), aarray(nums, "nums"), abool(passZero, "passZero");
  let F = Fp2, inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0), multipliedAcc = nums.reduce((acc, num, i) => F.is0(num) ? acc : (inverted[i] = acc, F.mul(acc, num)), F.ONE), invertedAcc = F.inv(multipliedAcc);
  return nums.reduceRight((acc, num, i) => F.is0(num) ? acc : (inverted[i] = F.mul(acc, inverted[i]), F.mul(acc, num)), invertedAcc), inverted;
}
function FpLegendre(Fp2, n) {
  validateField(Fp2);
  let F = Fp2;
  aoddModulus(F.ORDER, "FpLegendre");
  let p1mod2 = (F.ORDER - _1n2) / _2n, powered = F.pow(n, p1mod2), yes = F.eql(powered, F.ONE), zero = F.eql(powered, F.ZERO), no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0 && anumber2(nBitLength), n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  let bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  let _nBitLength = nBitLength !== void 0 ? nBitLength : bits, nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap(), _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength;
    this.isLE = !1, opts != null && typeof opts == "object" && (typeof opts.BITS == "number" && (_nbitLength = opts.BITS), typeof opts.sqrt == "function" && Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: !0 }), typeof opts.isLE == "boolean" && (this.isLE = opts.isLE), opts.allowedLengths && (this._lengths = Object.freeze(opts.allowedLengths.slice())), typeof opts.modFromBytes == "boolean" && (this._mod = opts.modFromBytes));
    let { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER, this.BITS = nBitLength, this.BYTES = nByteLength, Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num != "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    return sqrt || FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER)), sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = !1) {
    abytes2(bytes);
    let { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES)
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      let padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE ? 0 : padded.length - bytes.length), bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes && (scalar = mod(scalar, ORDER)), !skipValidation && !this.isValid(scalar))
      throw new Error("invalid field element: outside of range 0..ORDER");
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst, !0);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    return abool(condition, "condition"), condition ? b : a;
  }
};
function Field(ORDER, opts = {}) {
  return Object.freeze(_Field.prototype), new _Field(ORDER, opts);
}

// node_modules/@noble/curves/abstract/curve.js
var _0n3 = /* @__PURE__ */ BigInt(0), _1n3 = /* @__PURE__ */ BigInt(1), _4n2 = /* @__PURE__ */ BigInt(4), BLIND_BYTES = 16, BLIND_BITS = 128, FW_WINDOW = 5, TABLE_BYTES_MAX = 2 ** 31;
function validatePointCons(Point) {
  let pc = Point;
  if (typeof pc != "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine"), afunction(pc.fromBytes, "Point.fromBytes"), afunction(pc.fromHex, "Point.fromHex"), aobject2(pc.BASE, "Point.BASE"), aobject2(pc.ZERO, "Point.ZERO"), validateField(pc.Fp), validateField(pc.Fn);
}
function normalizeZ(c, points) {
  validatePointCons(c), validateMSMPoints(points, c);
  let invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  let bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes4, length) {
  if (randomBytes4 !== void 0) {
    afunction(randomBytes4, "randomBytes");
    try {
      let probe = randomBytes4(length);
      if (!isBytes2(probe) || probe.length !== length)
        return;
    } catch {
      return;
    }
    return randomBytes4;
  }
}
function validateMSMPoints(points, c) {
  aarray(points, "points"), points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!(maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P) {
  return pointWindowSizes.get(P) || 1;
}
function oddMultiples(p, size) {
  let dbl = p.double(), t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  let size = 2 ** W, half = size / 2, mask = BigInt(size - 1), d = [];
  for (; n > _0n3; ) {
    let w = 0;
    n & _1n3 && (w = Number(n & mask), w >= half && (w -= size), n -= BigInt(w)), d.push(w), n >>= _1n3;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  let size = 2 ** W, half = size / 2, mask = BigInt(size - 1), shiftBy = BigInt(W), d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy, v > half && (v -= size, n += _1n3), d.push(v);
  }
  if (n !== _0n3)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (let d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    bit !== max - 1 && (acc = acc.double());
    for (let i = 0; i < digits.length; i++) {
      let w = digits[i][bit];
      if (w) {
        let item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = /* @__PURE__ */ new WeakMap();
  baseCanBeBlinded;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes4) {
    validatePointCons(Point), this.randomBytes = probeRandomBytes(randomBytes4, BLIND_BYTES), this.Point = Point, this.BASE = Point.BASE, this.ZERO = Point.ZERO, this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    let windows = Math.ceil(bits / W) + 1, half = 2 ** (W - 1), comp = [], base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++)
        comp.push(acc), acc = acc.add(base);
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    let { W, windows, comp } = precomputes, half = 2 ** (W - 1), digits = signedWindowDigits(n, W, windows), p = this.ZERO, f = this.BASE;
    for (let w = 0; w < windows; w++) {
      let digit = digits[w], start = w * half, idx = Math.abs(digit) - 1, sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      let neg = sel.negate();
      digit === 0 ? f = f.add(comp[start]) : p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point), comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    return comp || (comp = this.buildWnafTable(point, W, bits), typeof transform == "function" && (comp = { ...comp, comp: transform(comp.comp) }), entries || (entries = [], this.wnafPrecomputes.set(point, entries)), entries.push(comp)), comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    if (this.assertPoint(point), !inRange(scalar, _1n3, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    let W = getWindowSize(point);
    return W === 1 ? this.fixedWindowCT(point, n, bits) : this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    return this.validateMulInput(point, scalar), this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    if (this.validateMulInput(point, scalar), this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    let bits = this.Point.Fn.BITS + BLIND_BITS, blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes2(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    let n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    let W = FW_WINDOW, size = 1 << W, mask = bitMask(W), table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    let windows = Math.ceil(bits / W), acc = this.ZERO;
    for (let window = windows - 1; window >= 0; window--) {
      if (window !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      let digit = Number(n >> BigInt(window * W) & mask), sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    return this.randomBytes === void 0 ? !1 : cofactor === _1n3 ? !0 : point !== this.BASE ? !1 : (this.baseCanBeBlinded === void 0 && (this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0()), this.baseCanBeBlinded);
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    if (this.assertPoint(point), !isPosBig(scalar))
      throw new Error("invalid scalar");
    let W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], !0);
    let precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point), validateW(W, this.bits);
    let windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES), pointWindowSizes.set(point, W), this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = !1) {
  if (validatePointCons(c), validateMSMPoints(points, c), abool(allowOversized, "allowOversized"), validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : void 0), points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  let tables = points.map((p) => oddMultiples(p, 4)), digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    return validateField(field), field;
  } else
    return Field(order, { isLE });
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0 && (FpFnLE = type === "edwards"), !CURVE || typeof CURVE != "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject(curveOpts);
  for (let p of ["p", "n", "h"]) {
    let val = CURVE[p];
    if (!(isPosBig(val) && val !== _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  let Fp2 = createField(CURVE.p, curveOpts.Fp, FpFnLE), Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE), params = ["Gx", "Gy", "a", type === "weierstrass" ? "b" : "d"];
  for (let p of params)
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  return CURVE = Object.freeze(Object.assign({}, CURVE)), { CURVE, Fp: Fp2, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function(seed) {
    let secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@noble/curves/abstract/edwards.js
var _0n4 = /* @__PURE__ */ BigInt(0), _1n4 = /* @__PURE__ */ BigInt(1), _2n2 = /* @__PURE__ */ BigInt(2), _4n3 = /* @__PURE__ */ BigInt(4), _8n2 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp2, CURVE, x, y) {
  let x2 = Fp2.sqr(x), y2 = Fp2.sqr(y), left = Fp2.add(Fp2.mul(CURVE.a, x2), y2), right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  validateObject(extraOpts, {}, {}, "extraOpts");
  let opts = extraOpts, validated = createCurveFields("edwards", params, opts, opts.FpFnLE), { Fp: Fp2, Fn } = validated, CURVE = validated.CURVE, { h: cofactor } = CURVE;
  if (FpLegendre(Fp2, CURVE.a) !== 1)
    throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
  if (FpLegendre(Fp2, CURVE.d) !== -1)
    throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
  validateObject(opts, {}, { uvRatio: "function", randomBytes: "function" });
  let randomBytes4 = opts.randomBytes === void 0 ? randomBytes3 : opts.randomBytes, MASK = _2n2 << BigInt(Fp2.BYTES * 8) - _1n4;
  function isOdd(n) {
    if (!Fp2.isOdd)
      throw new Error("Field does not have .isOdd()");
    return Fp2.isOdd(n);
  }
  let uvRatio2 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: !0, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch {
      return { isValid: !1, value: _0n4 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  let mulA = Fp2.eql(CURVE.a, Fp2.neg(Fp2.ONE)) ? (x) => Fp2.neg(x) : Fp2.eql(CURVE.a, Fp2.ONE) ? (x) => x : (x) => Fp2.mul(CURVE.a, x);
  function acoord(title, n, banZero = !1) {
    let min = banZero ? _1n4 : _0n4;
    return aInRange("coordinate " + title, n, min, MASK), n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp2.ONE, Fp2.mul(CURVE.Gx, CURVE.Gy));
    static ZERO = new Point(Fp2.ZERO, Fp2.ONE, Fp2.ONE, Fp2.ZERO);
    static Fp = Fp2;
    static Fn = Fn;
    X;
    Y;
    Z;
    T;
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X), this.Y = acoord("y", Y), this.Z = acoord("z", Z, !0), this.T = acoord("t", T), Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      let { x, y } = p || {};
      return acoord("x", x), acoord("y", y), new Point(x, y, Fp2.ONE, Fp2.mul(x, y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = !1) {
      let len = Fp2.BYTES, { a, d } = CURVE;
      bytes = copyBytes(abytes2(bytes, len, "point")), abool(zip215, "zip215");
      let normed = copyBytes(bytes), lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & -129;
      let y = bytesToNumberLE(normed), max = zip215 ? MASK : Fp2.ORDER;
      aInRange("point.y", y, _0n4, max);
      let y2 = Fp2.sqr(y), u = Fp2.sub(y2, Fp2.ONE), v = Fp2.sub(Fp2.mulN(d, y2), a), { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      let isXOdd = isOdd(x), isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && Fp2.is0(x) && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      return isLastByteOdd !== isXOdd && (x = Fp2.neg(x)), Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = !1) {
      return Point.fromBytes(hexToBytes2(hex), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 6, isLazy = !0) {
      return wnaf.setWindowSize(this, windowSize), isLazy || this.multiply(_2n2), this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      let p = this, { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      let { X, Y, Z, T } = p, X2 = Fp2.sqr(X), Y2 = Fp2.sqr(Y), Z2 = Fp2.sqr(Z), Z4 = Fp2.sqr(Z2), aX2 = Fp2.mul(X2, a), left = Fp2.mul(Fp2.add(aX2, Y2), Z2), right = Fp2.add(Z4, Fp2.mul(d, Fp2.mul(X2, Y2)));
      if (!Fp2.eql(left, right))
        throw new Error("bad point: equation left != right (1)");
      let XY = Fp2.mul(X, Y), ZT = Fp2.mul(Z, T);
      if (!Fp2.eql(XY, ZT))
        throw new Error("bad point: equation left != right (2)");
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
      let { X: X1, Y: Y1, Z: Z1 } = this, { X: X2, Y: Y2, Z: Z2 } = other, X1Z2 = Fp2.mul(X1, Z2), X2Z1 = Fp2.mul(X2, Z1), Y1Z2 = Fp2.mul(Y1, Z2), Y2Z1 = Fp2.mul(Y2, Z1);
      return Fp2.eql(X1Z2, X2Z1) && Fp2.eql(Y1Z2, Y2Z1);
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(Fp2.neg(this.X), this.Y, this.Z, Fp2.neg(this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      let { X: X1, Y: Y1, Z: Z1 } = this, A = Fp2.sqr(X1), B = Fp2.sqr(Y1), C = Fp2.mul(Fp2.sqr(Z1), _2n2), D = mulA(A), x1y1 = Fp2.addN(X1, Y1), E = Fp2.sub(Fp2.subN(Fp2.sqr(x1y1), A), B), G = Fp2.addN(D, B), F = Fp2.subN(G, C), H = Fp2.subN(D, B), X3 = Fp2.mul(E, F), Y3 = Fp2.mul(G, H), T3 = Fp2.mul(E, H), Z3 = Fp2.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aedpoint(other);
      let { d } = CURVE, { X: X1, Y: Y1, Z: Z1, T: T1 } = this, { X: X2, Y: Y2, Z: Z2, T: T2 } = other, A = Fp2.mul(X1, X2), B = Fp2.mul(Y1, Y2), C = Fp2.mul(Fp2.mulN(T1, d), T2), D = Fp2.mul(Z1, Z2), E = Fp2.sub(Fp2.subN(Fp2.mulN(Fp2.addN(X1, Y1), Fp2.addN(X2, Y2)), A), B), F = Fp2.subN(D, C), G = Fp2.addN(D, C), H = Fp2.sub(B, mulA(A)), X3 = Fp2.mul(E, F), Y3 = Fp2.mul(G, H), T3 = Fp2.mul(E, H), Z3 = Fp2.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      return aedpoint(other), this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      let { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      return scalar === _0n4 ? Point.ZERO : this.is0() || scalar === _1n4 ? this : wnaf.mulUnsafe(this, scalar, normalize);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Clears cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.mulUnsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      let p = this, iz = invertedZ;
      if (iz != null && typeof iz != "bigint")
        throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
      let { X, Y, Z } = p, is0 = p.is0();
      iz == null && (iz = is0 ? Fp2.create(_8n2) : Fp2.inv(Z));
      let x = Fp2.mul(X, iz), y = Fp2.mul(Y, iz), zz = Fp2.mul(Z, iz);
      if (is0)
        return { x: Fp2.ZERO, y: Fp2.ONE };
      if (!Fp2.eql(zz, Fp2.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      return cofactor === _1n4 ? this : cofactor === _2n2 ? this.double() : cofactor === _4n3 ? this.double().double() : cofactor === _8n2 ? this.double().double().double() : this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      let { x, y } = this.toAffine(), bytes = Fp2.toBytes(y);
      return bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0, bytes;
    }
    toHex() {
      return bytesToHex2(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  let normalize = (points) => normalizeZ(Point, points), wnaf = new ScalarMultiplier(Point, randomBytes4);
  return wnaf.bits >= 6 && Point.BASE.precompute(6), Object.freeze(Point.prototype), Object.freeze(Point), Point;
}
function eddsa(Point, cHash, eddsaOpts = {}) {
  if (validatePointCons(Point), typeof cHash != "function")
    throw new Error('"hash" function param is required');
  let hash = cHash, opts = eddsaOpts;
  validateObject(opts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    zip215: "boolean",
    mapToCurve: "function",
    toMontgomery: "function",
    toMontgomerySecret: "function"
  });
  let { prehash } = opts, { BASE, Fp: Fp2, Fn } = Point, outputLen = hash.outputLen, expectedLen = 2 * Fp2.BYTES;
  if (outputLen !== void 0 && (asafenumber(outputLen, "hash.outputLen"), outputLen !== expectedLen))
    throw new Error(`hash.outputLen must be ${expectedLen}, got ${outputLen}`);
  let randomBytes4 = opts.randomBytes === void 0 ? randomBytes3 : opts.randomBytes, toMontgomery2 = opts.toMontgomery, toMontgomerySecret2 = opts.toMontgomerySecret, adjustScalarBytes2 = opts.adjustScalarBytes === void 0 ? (bytes) => bytes : opts.adjustScalarBytes, domain = opts.domain === void 0 ? (data, ctx, phflag) => {
    if (abool(phflag, "phflag"), ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  } : opts.domain;
  function modN_LE(hash2) {
    return Fn.create(bytesToNumberLE(hash2));
  }
  function getPrivateScalar(key) {
    let len = lengths.secretKey;
    abytes2(key, lengths.secretKey, "secretKey");
    let hashed = abytes2(hash(key), 2 * len, "hashedSecretKey"), head = adjustScalarBytes2(hashed.slice(0, len)), prefix = hashed.slice(len, 2 * len), scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(secretKey) {
    let { head, prefix, scalar } = getPrivateScalar(secretKey), point = BASE.multiply(scalar), pointBytes = point.toBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey(secretKey) {
    return getExtendedPublicKey(secretKey).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    let msg = concatBytes2(...msgs);
    return modN_LE(hash(domain(msg, abytes2(context, void 0, "context"), !!prehash)));
  }
  function sign(msg, secretKey, options = {}) {
    validateObject(options, {}, {}, "options"), msg = copyBytes(abytes2(msg, void 0, "message")), prehash && (msg = prehash(msg));
    let { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey), r = hashDomainToScalar(options.context, prefix, msg), R = BASE.multiply(r).toBytes(), k = hashDomainToScalar(options.context, R, pointBytes, msg), s = Fn.create(r + k * scalar);
    if (!Fn.isValid(s))
      throw new Error("sign failed: invalid s");
    let rs = concatBytes2(R, Fn.toBytes(s));
    return abytes2(rs, lengths.signature, "result");
  }
  let verifyOpts = {
    zip215: opts.zip215
  };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    validateObject(options);
    let { context } = options, zip215 = options.zip215 === void 0 ? !!verifyOpts.zip215 : options.zip215, len = lengths.signature;
    sig = abytes2(sig, len, "signature"), msg = abytes2(msg, void 0, "message"), publicKey = abytes2(publicKey, lengths.publicKey, "publicKey"), zip215 !== void 0 && abool(zip215, "zip215"), prehash && (msg = prehash(msg));
    let mid = len / 2, r = sig.subarray(0, mid), s = bytesToNumberLE(sig.subarray(mid, len)), A, R, SB;
    try {
      A = Point.fromBytes(publicKey, zip215), R = Point.fromBytes(r, zip215), SB = BASE.multiplyUnsafe(s);
    } catch {
      return !1;
    }
    if (!zip215 && A.isSmallOrder())
      return !1;
    let k = hashDomainToScalar(context, r, publicKey, msg);
    return R.add(A.multiplyUnsafe(k)).subtract(SB).clearCofactor().is0();
  }
  let _size = Fp2.BYTES, lengths = {
    secretKey: _size,
    publicKey: _size,
    signature: 2 * _size,
    seed: _size
  };
  function randomSecretKey(seed) {
    return seed = seed === void 0 ? randomBytes4(lengths.seed) : seed, abytes2(seed, lengths.seed, "seed");
  }
  function isValidSecretKey(key) {
    return isBytes2(key) && key.length === lengths.secretKey;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point.fromBytes(key, zip215 === void 0 ? verifyOpts.zip215 : zip215);
    } catch {
      return !1;
    }
  }
  let utils = {
    getExtendedPublicKey,
    randomSecretKey,
    isValidSecretKey,
    isValidPublicKey,
    /** Converts an Edwards public key to a companion Montgomery public key. */
    toMontgomery(publicKey) {
      if (toMontgomery2 === void 0)
        throw new Error("Montgomery conversion is not supported for this curve");
      return toMontgomery2(Point.fromBytes(publicKey));
    },
    toMontgomerySecret(secretKey) {
      if (toMontgomerySecret2 === void 0)
        throw new Error("Montgomery conversion is not supported for this curve");
      return toMontgomerySecret2(secretKey);
    }
  };
  return Object.freeze(lengths), Object.freeze(utils), Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getPublicKey,
    sign,
    verify,
    utils,
    Point,
    lengths
  });
}

// node_modules/@noble/curves/ed25519.js
var _1n5 = /* @__PURE__ */ BigInt(1), _2n3 = /* @__PURE__ */ BigInt(2);
var _5n2 = /* @__PURE__ */ BigInt(5), _8n3 = /* @__PURE__ */ BigInt(8), ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed"), ed25519_CURVE = {
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
};
function ed25519_pow_2_252_3(x) {
  let _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80), P = ed25519_CURVE_p, b2 = x * x % P * x % P, b4 = pow2(b2, _2n3, P) * b2 % P, b5 = pow2(b4, _1n5, P) * x % P, b10 = pow2(b5, _5n2, P) * b5 % P, b20 = pow2(b10, _10n, P) * b10 % P, b40 = pow2(b20, _20n, P) * b20 % P, b80 = pow2(b40, _40n, P) * b40 % P, b160 = pow2(b80, _80n, P) * b80 % P, b240 = pow2(b160, _80n, P) * b80 % P, b250 = pow2(b240, _10n, P) * b10 % P;
  return { pow_p_5_8: pow2(b250, _2n3, P) * x % P, b2 };
}
function adjustScalarBytes(bytes) {
  return bytes[0] &= 248, bytes[31] &= 127, bytes[31] |= 64, bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  let P = ed25519_CURVE_p, v3 = mod(v * v * v, P), v7 = mod(v3 * v3 * v, P), pow3 = ed25519_pow_2_252_3(u * v7).pow_p_5_8, x = mod(u * v3 * pow3, P), vx2 = mod(v * x * x, P), root1 = x, root2 = mod(x * ED25519_SQRT_M1, P), useRoot1 = vx2 === u, useRoot2 = vx2 === mod(-u, P), noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  return useRoot1 && (x = root1), (useRoot2 || noRoot) && (x = root2), isNegativeLE(x, P) && (x = mod(-x, P)), { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio }), Fp = ed25519_Point.Fp;
function toMontgomery(point) {
  let { y } = point;
  return Fp.toBytes(Fp.div(_1n5 + y, _1n5 - y));
}
function toMontgomerySecret(secretKey) {
  let size = ed25519_Point.Fp.BYTES;
  return abytes(secretKey, size), adjustScalarBytes(sha512(secretKey.subarray(0, size))).subarray(0, size);
}
function ed(opts) {
  return eddsa(ed25519_Point, sha512, Object.assign({ adjustScalarBytes, toMontgomery, toMontgomerySecret, zip215: !0 }, opts));
}
var ed25519 = /* @__PURE__ */ ed({});

// security/src/client/connection.ts
function storageUrl(raw) {
  let u = new URL(raw.trim());
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== "/")
    throw new Error("Nh\u1EADp \u0111\u1ECBa ch\u1EC9 m\xE1y ch\u1EE7 d\u1EA1ng http://IP:8090");
  return u.origin;
}

// security/src/client/server-proof.ts
var ServerProofError = class extends Error {
}, normalizeAddress = (raw) => {
  let address = raw.toLowerCase().replace(/^\[|\]$/g, "");
  return address.startsWith("::ffff:") && (address = address.slice(7)), address === "0:0:0:0:0:0:0:1" ? "::1" : address;
}, isLoopback2 = (raw) => {
  let address = normalizeAddress(raw);
  return address === "localhost" || address === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}, isNumeric = (address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address) || address.includes(":"), newProofNonce = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
function verifyServerProof(base, nonce, proof, expectedRegistryPk) {
  try {
    if (!/^[0-9a-f]{64}$/.test(nonce)) throw new Error("nonce");
    let target = new URL(storageUrl(base)), host = normalizeAddress(target.hostname);
    if (!isNumeric(host) && host !== "localhost") throw new Error("numeric address required");
    if (!proof || typeof proof != "object") throw new Error("proof");
    let { payload, signature } = proof;
    if (typeof payload != "string" || payload.length > 1e5 || typeof signature != "string" || !/^[0-9a-f]{128}$/i.test(signature)) throw new Error("shape");
    let value = JSON.parse(payload);
    if (value.nonce !== nonce || !/^[0-9a-f]{64}$/i.test(value.registryPk) || value.config?.registryPk !== value.registryPk) throw new Error("identity");
    if (expectedRegistryPk && expectedRegistryPk.toLowerCase() !== value.registryPk.toLowerCase()) throw new Error("registry changed");
    let address = normalizeAddress(value.address);
    if (!(host === "localhost" ? isLoopback2(address) : host === address)) throw new Error("address mismatch");
    let port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    if (value.port !== port || !Number.isInteger(value.port)) throw new Error("port mismatch");
    if (!Number.isInteger(value.config.k) || value.config.k < 1 || !value.config.pk || !Array.isArray(value.config.nodes) || !value.config.nodes.every((node) => typeof node.org == "string" && typeof node.url == "string")) throw new Error("config");
    if (!ed25519.verify(hexToBytes(signature), new TextEncoder().encode("medabe/discovery/v1|" + payload), hexToBytes(value.registryPk))) throw new Error("signature");
    return value;
  } catch {
    throw new ServerProofError("Kh\xF4ng x\xE1c minh \u0111\u01B0\u1EE3c ch\u1EEF k\xFD, \u0111\u1ECBa ch\u1EC9 ho\u1EB7c danh t\xEDnh m\xE1y ch\u1EE7 KSK.");
  }
}
async function requestServerProof(base, fetcher, expectedRegistryPk, signal) {
  let address = storageUrl(base), nonce = newProofNonce(), response = await fetcher(address + "/api/discovery-proof?nonce=" + nonce, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5e3)]) : AbortSignal.timeout(5e3),
    cache: "no-store",
    redirect: "error"
  });
  if (!response.ok) throw new ServerProofError("M\xE1y ch\u1EE7 ch\u01B0a h\u1ED7 tr\u1EE3 x\xE1c minh k\u1EBFt n\u1ED1i ho\u1EB7c ch\u01B0a s\u1EB5n s\xE0ng.");
  return verifyServerProof(address, nonce, await response.json(), expectedRegistryPk);
}

// app/desktop/main.ts
var import_electron = require("electron"), import_node_child_process2 = require("node:child_process"), import_node_os3 = require("node:os"), import_node_fs = require("node:fs"), import_node_crypto3 = require("node:crypto"), import_node_path = require("node:path");

// security/src/hardware.ts
var import_node_child_process = require("node:child_process"), import_node_crypto2 = require("node:crypto"), import_node_os2 = require("node:os"), PLACEHOLDER = /^(|0|none|default string|to be filled by o\.e\.m\.?|system serial number|not specified|unknown|n\/a)$/i, clean2 = (s) => PLACEHOLDER.test(s.trim()) ? "" : s.trim().toUpperCase();
function matchHardware(stored, current) {
  let usable = ["cpu", "board", "bios", "disk"].filter((k) => clean2(stored[k]) && clean2(current[k])), matched = usable.filter((k) => clean2(stored[k]) === clean2(current[k])).length, available = usable.length;
  return { ok: available >= 2 && matched >= Math.ceil(available * 0.75), matched, available };
}
function hardwareHash(h) {
  return (0, import_node_crypto2.createHash)("sha256").update(["cpu", "board", "bios", "disk"].map((k) => clean2(h[k])).join("|")).digest("hex");
}
var run = (cmd, args) => new Promise((res) => {
  (0, import_node_child_process.execFile)(cmd, args, { timeout: 15e3, windowsHide: !0 }, (err, out) => res(err ? "" : out.trim()));
}), ps = (script) => new Promise((res) => {
  (0, import_node_child_process.execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15e3, windowsHide: !0 }, (err, out) => res(err ? "" : out.trim()));
});
function localMacs() {
  return Object.values((0, import_node_os2.networkInterfaces)()).flat().filter((i) => !!i && !i.internal && i.mac !== "00:00:00:00:00:00").map((i) => i.mac.toUpperCase()).filter((m, i, a) => a.indexOf(m) === i).sort();
}
async function collectHardware() {
  let base = { macs: localMacs(), host: (0, import_node_os2.hostname)() };
  if ((0, import_node_os2.platform)() === "win32") {
    let [cpu, board, bios, disk] = await Promise.all([
      ps("(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId"),
      ps("(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).SerialNumber"),
      ps("(Get-CimInstance Win32_BIOS | Select-Object -First 1).SerialNumber"),
      ps("(Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } | Select-Object -First 1).SerialNumber")
    ]);
    return { cpu, board, bios, disk, ...base };
  }
  if ((0, import_node_os2.platform)() === "darwin") {
    let [io, cpu] = await Promise.all([run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]), run("sysctl", ["-n", "machdep.cpu.brand_string"])]), field = (name) => new RegExp('"' + name + '" = "([^"]+)"').exec(io)?.[1] ?? "";
    return { cpu: cpu || (0, import_node_os2.cpus)()[0]?.model || "", board: field("IOPlatformUUID"), bios: field("IOPlatformSerialNumber"), disk: "", ...base };
  }
  if ((0, import_node_os2.platform)() === "linux") {
    let id = await run("cat", ["/etc/machine-id"]);
    return { cpu: (0, import_node_os2.cpus)()[0]?.model ?? "", board: id, bios: "", disk: "", ...base };
  }
  return { cpu: (0, import_node_os2.cpus)()[0]?.model ?? "", board: "", bios: "", disk: "", ...base };
}

// app/desktop/adminvault.ts
var BASE_LOCK_MS = 15 * 6e4, MAX_LOCK_MS = 24 * 36e5, IDLE_MS = 5 * 6e4, SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

// app/desktop/main.ts
process.env.MEDABE_USER_DATA && import_electron.app.setPath("userData", (0, import_node_path.resolve)(process.env.MEDABE_USER_DATA));
var DEBUG = !!process.env.MEDABE_DEBUG || !!process.env.MEDABE_TEST, UI = (0, import_node_path.join)(__dirname, "..", "..", "web", "dist", "index.html"), SERVER_DIR = (0, import_node_path.join)(process.resourcesPath ?? "", "server"), EMBEDDED = !1, MIGRATE_FROM_OLD = import_electron.app.getName() !== "KSK", serverData = () => (0, import_node_path.join)(import_electron.app.getPath("userData"), "server-data");
var lanIp = () => {
  if (process.env.MEDABE_PUBLIC_HOST) return process.env.MEDABE_PUBLIC_HOST;
  let bad = /vmware|virtual|vethernet|vbox|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|bluetooth/i, cand = Object.entries((0, import_node_os3.networkInterfaces)()).filter(([n]) => !bad.test(n)).flatMap(([n, a]) => (a ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ n, ip: i.address }))), rank = (c) => (/wi-?fi|wlan|wireless/i.test(c.n) ? 0 : /ethernet/i.test(c.n) ? 1 : 2) * 10 + (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c.ip) ? 0 : 5);
  return cand.sort((a, b) => rank(a) - rank(b))[0]?.ip ?? "127.0.0.1";
}, serverProc, up = async (url) => !!(await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null))?.ok, serverUp = async () => await up("http://127.0.0.1:8090/api/epochs") && await up("http://127.0.0.1:9001/info");
async function startServer() {
  if (!EMBEDDED) return !0;
  if (!await serverUp()) {
    let oldData = (0, import_node_path.join)(import_electron.app.getPath("appData"), "KSK", "server-data");
    if (MIGRATE_FROM_OLD && !(0, import_node_fs.existsSync)((0, import_node_path.join)(serverData(), "db", "medabe.mv.db")) && (0, import_node_fs.existsSync)((0, import_node_path.join)(oldData, "db", "medabe.mv.db")))
      try {
        (0, import_node_fs.cpSync)(oldData, serverData(), { recursive: !0, filter: (src) => !/medabe\.lock\.db$|app-updates|server\.log$/.test(src) });
      } catch {
      }
    (0, import_node_fs.mkdirSync)(serverData(), { recursive: !0 }), serverProc = (0, import_node_child_process2.spawn)(process.execPath, [(0, import_node_path.join)(SERVER_DIR, "server.mjs")], {
      windowsHide: !0,
      stdio: ["ignore", (0, import_node_fs.openSync)((0, import_node_path.join)(serverData(), "server.log"), "a"), (0, import_node_fs.openSync)((0, import_node_path.join)(serverData(), "server.log"), "a")],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NO_WEB: "1", MEDABE_ACCOUNTS: "1", PARENT_DIST: (0, import_node_path.join)(SERVER_DIR, "parent"), DATA_DIR: serverData(), JAR_PATH: (0, import_node_path.join)(SERVER_DIR, "medabe-storage.jar"), JAVA_BIN: (0, import_node_path.join)(SERVER_DIR, "jre", "bin", "java.exe"), PORT: "8090", PUBLIC_HOST: lanIp() }
    });
  }
  for (let i = 0; i < 240; i++) {
    if (await serverUp()) return !0;
    await new Promise((r) => setTimeout(r, 500));
  }
  return !1;
}
function stopServer() {
  serverProc?.pid && (0, import_node_child_process2.spawnSync)("taskkill", ["/PID", String(serverProc.pid), "/T", "/F"], { windowsHide: !0 }), serverProc = void 0;
}
var file = (n) => (0, import_node_path.join)(import_electron.app.getPath("userData"), n), atomicWrite = (p, data) => {
  (0, import_node_fs.mkdirSync)(import_electron.app.getPath("userData"), { recursive: !0 }), (0, import_node_fs.writeFileSync)(p + ".tmp", data, { mode: 384 }), (0, import_node_fs.renameSync)(p + ".tmp", p);
}, hwPromise, currentHw = () => hwPromise ??= process.env.MEDABE_TEST && process.env.MEDABE_FAKE_HW ? Promise.resolve(JSON.parse(process.env.MEDABE_FAKE_HW)) : collectHardware();
function trusted(e) {
  if (!(e.senderFrame?.url ?? "").startsWith("file://")) throw new Error("Ngu\u1ED3n kh\xF4ng \u0111\u01B0\u1EE3c tin c\u1EADy");
}
function handle(channel, fn) {
  import_electron.ipcMain.handle(channel, async (e, arg) => (trusted(e), fn(arg)));
}
handle("hw:info", async () => {
  let h = await currentHw();
  return { hash: hardwareHash(h), host: h.host, macs: h.macs };
});
handle("device:load", async () => {
  let p = file("device.bin");
  if (!(0, import_node_fs.existsSync)(p)) return null;
  if (!import_electron.safeStorage.isEncryptionAvailable()) throw new Error("H\u1EC7 \u0111i\u1EC1u h\xE0nh kh\xF4ng c\xF3 kho kho\xE1 an to\xE0n; t\u1EEB ch\u1ED1i ch\u1EA1y");
  let stored = JSON.parse(import_electron.safeStorage.decryptString((0, import_node_fs.readFileSync)(p))), r = matchHardware(stored.hw, await currentHw());
  if (!r.ok)
    throw new Error(`HARDWARE_MISMATCH: kho\xE1 thi\u1EBFt b\u1ECB n\xE0y \u0111\u01B0\u1EE3c t\u1EA1o tr\xEAn m\xE1y kh\xE1c (kh\u1EDBp ${r.matched}/${r.available} th\xE0nh ph\u1EA7n ph\u1EA7n c\u1EE9ng). C\u1EA7n \u0111\u0103ng k\xFD l\u1EA1i thi\u1EBFt b\u1ECB.`);
  return { hwHash: hardwareHash(stored.hw), sign: stored.sign, wrap: stored.wrap };
});
handle("device:save", async (d) => {
  if (!import_electron.safeStorage.isEncryptionAvailable()) throw new Error("H\u1EC7 \u0111i\u1EC1u h\xE0nh kh\xF4ng c\xF3 kho kho\xE1 an to\xE0n; t\u1EEB ch\u1ED1i l\u01B0u");
  let hw = await currentHw();
  return atomicWrite(file("device.bin"), import_electron.safeStorage.encryptString(JSON.stringify({ hw, sign: d.sign, wrap: d.wrap }))), { hwHash: hardwareHash(hw) };
});
handle("autounlock:get", async () => {
  let p = file("autounlock.bin");
  if (!(0, import_node_fs.existsSync)(p) || !import_electron.safeStorage.isEncryptionAvailable()) return null;
  try {
    let s = JSON.parse(import_electron.safeStorage.decryptString((0, import_node_fs.readFileSync)(p)));
    return matchHardware(s.hw, await currentHw()).ok ? s.pass : null;
  } catch {
    return null;
  }
});
handle("autounlock:set", async (pass) => {
  if (typeof pass != "string" || pass.length < 16) throw new Error("m\u1EADt kh\u1EA9u t\u1EF1 m\u1EDF kho\xE1 ph\u1EA3i d\xE0i \u2265 16 k\xFD t\u1EF1");
  if (!import_electron.safeStorage.isEncryptionAvailable()) throw new Error("H\u1EC7 \u0111i\u1EC1u h\xE0nh kh\xF4ng c\xF3 kho kho\xE1 an to\xE0n");
  atomicWrite(file("autounlock.bin"), import_electron.safeStorage.encryptString(JSON.stringify({ hw: await currentHw(), pass })));
});
handle("autounlock:clear", () => {
  (0, import_node_fs.rmSync)(file("autounlock.bin"), { force: !0 });
});
handle("vault:get", () => (0, import_node_fs.existsSync)(file("vault.json")) ? (0, import_node_fs.readFileSync)(file("vault.json"), "utf8") : null);
handle("vault:set", (v) => {
  if (typeof v != "string" || v.length > 5e6) throw new Error("vault sai");
  atomicWrite(file("vault.json"), v);
});
handle("vault:wipe", () => {
  for (let f of ["vault.json", "device.bin", "autounlock.bin"]) (0, import_node_fs.rmSync)(file(f), { force: !0 });
});
var settings = () => {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(file("settings.json"), "utf8"));
  } catch {
    return {};
  }
}, bakedServer = () => {
  try {
    return (0, import_node_fs.readFileSync)((0, import_node_path.join)(__dirname, "..", "server-url.txt"), "utf8").trim() || null;
  } catch {
    return null;
  }
};
handle("setting:get", (k) => settings()[k] ?? (k === "storage" ? bakedServer() : null));
handle("setting:set", ({ k, v }) => {
  if (!/^[a-z.]{1,40}$/.test(k)) throw new Error("kho\xE1 c\u1EA5u h\xECnh sai");
  atomicWrite(file("settings.json"), JSON.stringify({ ...settings(), [k]: v }));
});
handle("app:quit", () => import_electron.app.quit());
async function allowedLanServer(raw) {
  try {
    let host = new URL(storageUrl(raw)).hostname.replace(/^\[|\]$/g, ""), addresses = await (0, import_promises.lookup)(host, { all: !0 });
    return addresses.length > 0 && addresses.every((v) => isLanPeer(v.address));
  } catch {
    return !1;
  }
}
handle("network:allowed", (raw) => typeof raw == "string" && raw.length < 300 ? allowedLanServer(raw) : !1);
handle("network:probe", async (raw) => {
  if (typeof raw != "string" || !await allowedLanServer(raw)) throw new Error("M\xE1y ch\u1EE7 kh\xF4ng thu\u1ED9c m\u1EA1ng n\u1ED9i b\u1ED9 hi\u1EC7n t\u1EA1i.");
  return { registryPk: (await requestServerProof(raw, fetch, void 0, AbortSignal.timeout(2500))).registryPk };
});
var asarPath = () => (0, import_node_path.join)(process.resourcesPath ?? "", "app.asar");
handle("update:localHash", () => {
  let p = asarPath();
  return (0, import_node_fs.existsSync)(p) ? (0, import_node_crypto3.createHash)("sha256").update((0, import_node_fs.readFileSync)(p)).digest("hex") : null;
});
handle("update:apply", async (raw) => {
  if (typeof raw != "string" || !await allowedLanServer(raw)) throw new Error("M\xE1y ch\u1EE7 kh\xF4ng thu\u1ED9c m\u1EA1ng n\u1ED9i b\u1ED9 hi\u1EC7n t\u1EA1i.");
  let base = storageUrl(raw), infoRes = await fetch(`${base}/api/app/version?edition=user`, { signal: AbortSignal.timeout(5e3), redirect: "error" });
  if (!infoRes.ok) throw new Error("M\xE1y ch\u1EE7 ch\u01B0a c\xF3 b\u1EA3n c\u1EADp nh\u1EADt cho b\u1EA3n n\xE0y.");
  let info = await infoRes.json(), dlRes = await fetch(`${base}/api/app/download?edition=user`, { signal: AbortSignal.timeout(6e4), redirect: "error" });
  if (!dlRes.ok) throw new Error("T\u1EA3i b\u1EA3n c\u1EADp nh\u1EADt th\u1EA5t b\u1EA1i.");
  let buf = Buffer.from(await dlRes.arrayBuffer());
  if (buf.length !== info.size || (0, import_node_crypto3.createHash)("sha256").update(buf).digest("hex") !== info.hash) throw new Error("D\u1EEF li\u1EC7u t\u1EA3i v\u1EC1 kh\xF4ng kh\u1EDBp, th\u1EED l\u1EA1i.");
  let p = asarPath(), bak = p + ".bak", tmp = p + ".new";
  (0, import_node_fs.writeFileSync)(tmp, buf), (0, import_node_fs.rmSync)(bak, { force: !0 }), (0, import_node_fs.renameSync)(p, bak);
  try {
    (0, import_node_fs.renameSync)(tmp, p);
  } catch (e) {
    throw (0, import_node_fs.renameSync)(bak, p), e;
  }
  return setTimeout(() => {
    import_electron.app.relaunch(), import_electron.app.exit(0);
  }, 400), !0;
});
handle("network:discover", async () => {
  let found = await discoverServers(), verified = await Promise.all(found.map(async (server) => {
    try {
      if (!await allowedLanServer(server.url)) return null;
      let proof = await requestServerProof(server.url, fetch, server.registryPk, AbortSignal.timeout(2500));
      return { url: server.url, registryPk: proof.registryPk };
    } catch {
      return null;
    }
  })), unique = /* @__PURE__ */ new Map();
  for (let candidate of verified) candidate && !unique.has(candidate.registryPk) && unique.set(candidate.registryPk, candidate);
  return [...unique.values()];
});
function createWindow() {
  let win = new import_electron.BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "MedABE",
    backgroundColor: "#0e1815",
    webPreferences: {
      preload: (0, import_node_path.join)(__dirname, "preload.cjs"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !0,
      webSecurity: !0,
      devTools: DEBUG,
      spellcheck: !1,
      backgroundThrottling: !1
      // không giảm tốc khi cửa sổ bị che: khoá tự động và các tác vụ nền vẫn chạy đúng hạn
    }
  });
  return import_electron.app.isPackaged && process.env.MEDABE_BLOCK_CAPTURE && win.setContentProtection(!0), win.webContents.setWindowOpenHandler(() => ({ action: "deny" })), win.webContents.on("will-navigate", (e, url) => {
    url.startsWith("file://") || e.preventDefault();
  }), win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(!1)), win.loadFile(UI), win;
}
import_electron.Menu.setApplicationMenu(null);
!process.env.MEDABE_USER_DATA && !import_electron.app.requestSingleInstanceLock() && import_electron.app.quit();
import_electron.app.whenReady().then(async () => {
  if (currentHw(), EMBEDDED) {
    let splash = new import_electron.BrowserWindow({ width: 460, height: 300, frame: !1, resizable: !1, alwaysOnTop: !0, center: !0, skipTaskbar: !1, backgroundColor: "#0b2238", title: "KSK" }), logo = "";
    try {
      logo = "data:image/png;base64," + (0, import_node_fs.readFileSync)((0, import_node_path.join)(__dirname, "..", "..", "web", "dist", "ksk-logo.png")).toString("base64");
    } catch {
    }
    let page = `<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font:15px Segoe UI,sans-serif;color:#dbe9f6;background:linear-gradient(160deg,#12467a,#071c33);border:1px solid #2a5a8a;box-sizing:border-box">
      ${logo ? `<img src="${logo}" width="120" height="120" style="object-fit:contain;margin-bottom:10px">` : ""}
      <div style="font-size:20px;font-weight:600;letter-spacing:.5px">KH\xC1M S\u1EE8C KH\u1ECEE</div>
      <div style="margin:8px 0 18px;opacity:.85">\u0110ang kh\u1EDFi \u0111\u1ED9ng h\u1EC7 th\u1ED1ng b\u1EA3o m\u1EADt\u2026</div>
      <div style="width:240px;height:4px;background:#ffffff22;border-radius:3px;overflow:hidden"><div style="width:40%;height:100%;background:#e8c35a;border-radius:3px;animation:m 1.2s ease-in-out infinite"></div></div>
      <style>@keyframes m{0%{margin-left:-40%}100%{margin-left:100%}}</style></body>`;
    splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
    let ok = await startServer();
    if (splash.close(), !ok) {
      stopServer(), import_electron.app.quit();
      return;
    }
  }
  createWindow(), import_electron.app.on("activate", () => {
    import_electron.BrowserWindow.getAllWindows().length === 0 && createWindow();
  });
});
import_electron.app.on("window-all-closed", () => import_electron.app.quit());
import_electron.app.on("will-quit", stopServer);
/*! Bundled license information:

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/edwards.js:
@noble/curves/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
