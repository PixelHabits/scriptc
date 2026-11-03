// SubtleCrypto's validation order: algorithm dictionaries convert first
// and their hashes normalize after the other members, key usages are
// checked before the algorithm's own rules (HMAC and AES lengths, RSA
// modulus and exponent, EC curves), the cipher and derivation rules run
// after the key checks, and importKey converts keyData by its type before
// it checks the format.
const raw = new Uint8Array(16);

async function attempt(label, run) {
  try {
    const value = await run();
    console.log(label, "resolves", value instanceof ArrayBuffer ? `ArrayBuffer(${value.byteLength})` : value);
  } catch (e) {
    console.log(label, e.name, e.code, e.message);
  }
}

const hmac = { name: "HMAC", hash: "SHA-256" };
await attempt("hmac generate zero length, bad usage", () => crypto.subtle.generateKey({ ...hmac, length: 0 }, true, ["encrypt"]));
await attempt("hmac generate zero length, no usages", () => crypto.subtle.generateKey({ ...hmac, length: 0 }, true, []));
await attempt("hmac generate md5, NaN length", () => crypto.subtle.generateKey({ name: "HMAC", hash: "MD5", length: NaN }, true, ["sign"]));
await attempt("hmac generate hash without name", () => crypto.subtle.generateKey({ name: "HMAC", hash: {} }, true, ["sign"]));
await attempt("hmac import zero length, bad usage", () => crypto.subtle.importKey("raw", raw, { ...hmac, length: 0 }, true, ["encrypt"]));
await attempt("hmac import zero length, md5", () => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "MD5", length: 0 }, true, ["sign"]));
await attempt("hmac import zero length, spki", () => crypto.subtle.importKey("spki", raw, { ...hmac, length: 0 }, true, ["sign"]));
await attempt("aes generate 100, bad usage", () => crypto.subtle.generateKey({ name: "AES-GCM", length: 100 }, true, ["sign"]));
await attempt("aes generate 100, no usages", () => crypto.subtle.generateKey({ name: "AES-GCM", length: 100 }, true, []));
await attempt("aes generate 128, no usages", () => crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, []));

const exponent = new Uint8Array([1, 0, 1]);
const pss = (params) => ({ name: "RSA-PSS", hash: "SHA-256", modulusLength: 1024, publicExponent: exponent, ...params });
await attempt("rsa md5, small modulus", () => crypto.subtle.generateKey(pss({ hash: "MD5", modulusLength: 100 }), true, ["sign"]));
await attempt("rsa small modulus, bad usage", () => crypto.subtle.generateKey(pss({ modulusLength: 100 }), true, ["encrypt"]));
await attempt("rsa exponent 1", () => crypto.subtle.generateKey(pss({ publicExponent: new Uint8Array([1]) }), true, ["sign"]));
await attempt("rsa exponent past 32 bits", () => crypto.subtle.generateKey(pss({ publicExponent: new Uint8Array([1, 0, 0, 0, 0, 1]) }), true, ["sign"]));
await attempt("rsa even exponent past 32 bits", () => crypto.subtle.generateKey(pss({ publicExponent: new Uint8Array([1, 0, 0, 0, 0, 2]) }), true, ["sign"]));
await attempt("rsa exponent with leading zeros", () =>
  crypto.subtle.generateKey(pss({ modulusLength: 512, publicExponent: new Uint8Array([0, 0, 0, 0, 1, 0, 1]) }), true, ["sign"]).then((pair) => pair.privateKey.algorithm.modulusLength),
);
await attempt("rsa small modulus, even exponent", () => crypto.subtle.generateKey(pss({ modulusLength: 100, publicExponent: new Uint8Array([4]) }), true, ["sign"]));
await attempt("ec bad curve, bad usage", () => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-999" }, true, ["encrypt"]));
await attempt("ec bad curve", () => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-999" }, true, ["sign"]));

const gcm = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
const cbc = await crypto.subtle.importKey("raw", raw, "AES-CBC", false, ["encrypt"]);
const ctr = await crypto.subtle.importKey("raw", raw, "AES-CTR", false, ["decrypt"]);
await attempt("gcm bad tag, wrong key", () => crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12), tagLength: 100 }, cbc, raw));
await attempt("gcm bad tag, no usage", () => crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(12), tagLength: 100 }, gcm, raw));
await attempt("gcm bad tag", () => crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12), tagLength: 100 }, gcm, raw));
await attempt("cbc short iv, wrong key", () => crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(8) }, gcm, raw));
await attempt("cbc short iv, no usage", () => crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(8) }, cbc, raw));
await attempt("ctr length 0, no usage", () => crypto.subtle.encrypt({ name: "AES-CTR", counter: new Uint8Array(16), length: 0 }, ctr, raw));
await attempt("ctr short counter", () => crypto.subtle.decrypt({ name: "AES-CTR", counter: new Uint8Array(8), length: 64 }, ctr, raw));
for (const size of [0, 1, 11, 128, 129]) {
  await attempt(`gcm iv ${size}`, () => crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(size) }, gcm, raw));
}

const pbkdf2 = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
const hkdf = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits", "deriveKey"]);
const pb = (params) => ({ name: "PBKDF2", hash: "SHA-256", salt: raw, iterations: 1, ...params });
const hk = (params) => ({ name: "HKDF", hash: "SHA-256", salt: raw, info: raw, ...params });
await attempt("pbkdf2 0 iterations, length 7", () => crypto.subtle.deriveBits(pb({ iterations: 0 }), pbkdf2, 7));
await attempt("pbkdf2 0 iterations, null length", () => crypto.subtle.deriveBits(pb({ iterations: 0 }), pbkdf2));
await attempt("pbkdf2 0 iterations, length 0", () => crypto.subtle.deriveBits(pb({ iterations: 0 }), pbkdf2, 0));
await attempt("pbkdf2 2^31 iterations, length 0", () => crypto.subtle.deriveBits(pb({ iterations: 2 ** 31 }), pbkdf2, 0));
await attempt("pbkdf2 2^31 iterations, length 8", () => crypto.subtle.deriveBits(pb({ iterations: 2 ** 31 }), pbkdf2, 8));
await attempt("pbkdf2 0 iterations, wrong key", () => crypto.subtle.deriveBits(pb({ iterations: 0 }), hkdf, 8));
await attempt("pbkdf2 md5, no salt", () => crypto.subtle.deriveBits({ name: "PBKDF2", hash: "MD5", iterations: 1 }, pbkdf2, 8));
await attempt("pbkdf2 md5", () => crypto.subtle.deriveBits(pb({ hash: "MD5" }), pbkdf2, 8));
await attempt("pbkdf2 hash without name, no salt", () => crypto.subtle.deriveBits({ name: "PBKDF2", hash: {}, iterations: 1 }, pbkdf2, 8));
const info = new Uint8Array(1025);
await attempt("hkdf long info, length 7", () => crypto.subtle.deriveBits(hk({ info }), hkdf, 7));
await attempt("hkdf long info", () => crypto.subtle.deriveBits(hk({ info }), hkdf, 8));
await attempt("hkdf long info, wrong key", () => crypto.subtle.deriveBits(hk({ info }), pbkdf2, 8));
await attempt("hkdf long info, length 0", () => crypto.subtle.deriveBits(hk({ info }), hkdf, 0));
await attempt("hkdf too long", () => crypto.subtle.deriveBits(hk(), hkdf, 255 * 256 + 8));
await attempt("derive aes 100, wrong usage", () => crypto.subtle.deriveKey(hk(), pbkdf2, { name: "AES-GCM", length: 100 }, true, ["encrypt"]));
await attempt("derive aes 100", () => crypto.subtle.deriveKey(hk(), hkdf, { name: "AES-GCM", length: 100 }, true, ["encrypt"]));
await attempt("derive hmac 0, bad usage", () => crypto.subtle.deriveKey(hk(), hkdf, { ...hmac, length: 0 }, true, ["encrypt"]));
await attempt("derive hmac 7", () => crypto.subtle.deriveKey(hk(), hkdf, { ...hmac, length: 7 }, true, ["sign"]));
await attempt("derive hmac md5", () => crypto.subtle.deriveKey(hk(), hkdf, { name: "HMAC", hash: "MD5" }, true, ["sign"]));
await attempt("derive aes, no usages", () => crypto.subtle.deriveKey(hk(), hkdf, { name: "AES-GCM", length: 128 }, true, []));
await attempt("derive pbkdf2 key", () => crypto.subtle.deriveKey(hk(), hkdf, "PBKDF2", false, ["deriveBits"]));

await attempt("raw string", () => crypto.subtle.importKey("raw", "abc", hmac, true, ["sign"]));
await attempt("raw number", () => crypto.subtle.importKey("raw", 5, hmac, true, ["sign"]));
await attempt("raw null", () => crypto.subtle.importKey("raw", null, hmac, true, ["sign"]));
await attempt("raw empty object", () => crypto.subtle.importKey("raw", {}, hmac, true, ["sign"]));
await attempt("raw jwk object", () => crypto.subtle.importKey("raw", { kty: "oct", k: "AAAA" }, hmac, true, ["sign"]));
await attempt("raw object, bad algorithm", () => crypto.subtle.importKey("raw", {}, { name: "nope" }, true, ["sign"]));
await attempt("jwk Uint8Array", () => crypto.subtle.importKey("jwk", new Uint8Array(4), hmac, true, ["sign"]));
await attempt("jwk ArrayBuffer", () => crypto.subtle.importKey("jwk", new ArrayBuffer(4), hmac, true, ["sign"]));
await attempt("jwk string", () => crypto.subtle.importKey("jwk", "x", hmac, true, ["sign"]));
await attempt("jwk key_ops number", () => crypto.subtle.importKey("jwk", { key_ops: 5 }, hmac, true, ["sign"]));
await attempt("jwk ext 0", () => crypto.subtle.importKey("jwk", { kty: "oct", k: "AAAA", ext: 0 }, hmac, true, ["sign"]));
const ecdsa = { name: "ECDSA", namedCurve: "P-256" };
await attempt("ecdsa spki object", () => crypto.subtle.importKey("spki", {}, ecdsa, true, ["verify"]));
await attempt("ecdsa jwk buffer", () => crypto.subtle.importKey("jwk", raw, ecdsa, true, ["verify"]));
await attempt("ecdsa jwk string", () => crypto.subtle.importKey("jwk", "x", ecdsa, true, ["verify"]));
await attempt("ecdsa spki object, bad curve", () => crypto.subtle.importKey("spki", {}, { name: "ECDSA", namedCurve: "P-999" }, true, ["verify"]));
await attempt("ecdsa raw, bad curve", () => crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-999" }, true, ["verify"]));
await attempt("ecdsa jwk ext 0", () => crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", ext: 0 }, ecdsa, true, ["verify"]));

const rsa = await crypto.subtle.generateKey(pss({ modulusLength: 512 }), true, ["sign", "verify"]);
await attempt("rsa private raw export", () => crypto.subtle.exportKey("raw", rsa.privateKey));
await attempt("rsa public raw export", () => crypto.subtle.exportKey("raw", rsa.publicKey));
const ec = await crypto.subtle.generateKey(ecdsa, true, ["sign", "verify"]);
await attempt("ecdsa private raw export", () => crypto.subtle.exportKey("raw", ec.privateKey));
await attempt("ecdsa sign md5", () => crypto.subtle.sign({ name: "ECDSA", hash: "MD5" }, ec.privateKey, raw));
await attempt("ecdsa sign hash without name", () => crypto.subtle.sign({ name: "ECDSA", hash: {} }, ec.privateKey, raw));
