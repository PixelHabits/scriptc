// crypto.diffieHellman checks the KeyObject types before it reads either
// key: a null key, a secret or public KeyObject as the private key, and a
// secret KeyObject as the public key each throw Node's error, ahead of
// the key-type comparison and the key inputs.
const crypto = require("crypto");

function attempt(label, options) {
  try {
    console.log(label, crypto.diffieHellman(options).length);
  } catch (e) {
    console.log(label, e.name, e.code, e.message);
  }
}

const x = crypto.generateKeyPairSync("x25519");
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const secret = crypto.createSecretKey(Buffer.alloc(32, 1));

attempt("null private key", { privateKey: null, publicKey: x.publicKey });
attempt("null public key", { privateKey: x.privateKey, publicKey: null });
attempt("secret private key", { privateKey: secret, publicKey: x.publicKey });
attempt("secret public key", { privateKey: x.privateKey, publicKey: secret });
attempt("public private key", { privateKey: x.publicKey, publicKey: x.publicKey });
attempt("public private key, secret public key", { privateKey: x.publicKey, publicKey: secret });
attempt("secret public key, bad private key", { privateKey: 1, publicKey: secret });
attempt("mixed types", { privateKey: x.privateKey, publicKey: ec.publicKey });
attempt("private as public", { privateKey: x.privateKey, publicKey: x.privateKey });
attempt("x25519", { privateKey: x.privateKey, publicKey: x.publicKey });
