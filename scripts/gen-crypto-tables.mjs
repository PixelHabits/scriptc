// Revalidate the baked crypto inventories against the pinned Node release.
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";

const path = new URL(
  "../packages/compiler/src/frontend/lowering/crypto-tables.ts",
  import.meta.url,
);
const source = readFileSync(path, "utf8");
for (const [name, value] of [
  ["CRYPTO_CONSTANTS", { ...crypto.constants }],
  ["CRYPTO_CIPHERS", crypto.getCiphers()],
  ["CRYPTO_HASHES", crypto.getHashes()],
  ["CRYPTO_CURVES", crypto.getCurves()],
]) {
  const match = source.match(new RegExp(`export const ${name}[^=]+ = ([\\s\\S]*?);`));
  deepStrictEqual(JSON.parse(match[1].replace(/,\s*([}\]])/g, "$1")), value, name);
}
writeFileSync(path, source.replaceAll(/Node v[\d.]+/g, `Node ${process.version}`));
const header = new URL("../packages/runtime/src/scr_cipher_names.h", import.meta.url);
const names = readFileSync(header, "utf8");
const known = names.split("#define SCR_CIPHER_KNOWN_NAMES")[1].split("\n\n")[0];
deepStrictEqual(
  [...known.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  crypto.getCiphers(),
);
writeFileSync(header, names.replaceAll(/Node 24(?:\.22)?/g, `Node ${process.versions.node}`));
console.log("revalidated crypto constants, ciphers, hashes, and curves");
