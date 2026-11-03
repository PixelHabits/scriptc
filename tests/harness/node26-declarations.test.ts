import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { analyze, compile } from "@scriptc/compiler";
const sanitize = process.env["SCRIPTC_SAN"] === "1";
function comparableStderr(text: string): string {
  return sanitize
    ? text.replace(
        /^==\d+==WARNING: ASan doesn't fully support makecontext\/swapcontext functions and may produce false positives in some cases!\n/gm,
        "",
      )
    : text;
}

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const source = `import { createRequire } from "node:module";
import { ExportBuffer } from "./alias.mjs";
import { Buffer as BareBuffer, Blob as BareBlob, File as BareFile } from "buffer";
import { Buffer as NodeBuffer, Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { TextEncoder as Encoder, TextDecoder as Decoder } from "node:util";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { setTimeout as timeout } from "node:timers";
const b = BareBuffer.from("abca");
const require = createRequire(import.meta.url);
const { Buffer: RequiredBuffer } = require("node:buffer") as typeof import("node:buffer");
const builtinBuffer = process.getBuiltinModule("buffer") as typeof import("buffer");
console.log(BareBuffer === NodeBuffer, RequiredBuffer === NodeBuffer, ExportBuffer === NodeBuffer, builtinBuffer.Buffer === NodeBuffer);
console.log(typeof ErrorEvent, ErrorEvent.name, ErrorEvent.length, typeof Storage, typeof QuotaExceededError, typeof sessionStorage, typeof globalThis.sessionStorage);
console.log(typeof Temporal, typeof globalThis.Temporal, Temporal === globalThis.Temporal, "Temporal" in globalThis);
console.log(JSON.stringify(process.versions), JSON.stringify(process.release));
console.log(b.indexOf("a", 1, "utf8"), b.lastIndexOf("a"), b.includes("bc"));
console.log(new Decoder().decode(new Encoder().encode("typed globals")));
timeout(() => console.log("timer"), 1);
console.log(typeof console.log, typeof URL, typeof TextEncoder);
const events = new EventEmitter();
events.on("value", (value: number) => console.log(value));
events.emit("value", 42);
const stream = Readable.from(["a", "b"]);
console.log(stream.read(), new BareBlob(["hi"]).size, new BareFile(["hi"], "x").name);
console.log(new NodeBlob(["ok"]).size, new NodeFile(["ok"], "y").name);
console.log(structuredClone(new NodeBlob(["clone"])).size);
process.emitWarning = (...args: unknown[]) => console.log("warning", args[0], args[1]);
console.log(typeof localStorage, typeof globalThis.localStorage);

`;

for (const adopted of [false, true]) {
  test(`Node declarations: ${adopted ? "project" : "bundled"} imports and globals`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-node26-types-"));
    try {
      if (adopted) {
        mkdirSync(join(dir, "node_modules"));
        symlinkSync(join(repoRoot, "node_modules/@types"), join(dir, "node_modules/@types"));
        writeFileSync(
          join(dir, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { strict: true, types: ["node"] } }),
        );
      }
      const entry = join(dir, "main.ts");
      writeFileSync(
        join(dir, "alias.mjs"),
        'export { Buffer as ExportBuffer } from "node:buffer";',
      );
      writeFileSync(entry, source);
      const result = await compile(entry, { outPath: join(dir, "program"), outDir: dir, sanitize });
      expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics) : "").toBe(true);
      if (!result.ok) return;
      const [native, node] = await Promise.all([
        execFileAsync(result.binaryPath),
        execFileAsync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", entry]),
      ]);
      expect(native.stdout).toBe(node.stdout);
      expect(comparableStderr(native.stderr)).toBe(node.stderr);
      for (const expression of [
        'b.indexOf("a", 0, 1)',
        'b.lastIndexOf("a", 0, 1, "utf8")',
        'b.includes("a", 0, 1)',
      ]) {
        writeFileSync(entry, `const b = Buffer.from("abca"); console.log(${expression});`);
        const result = analyze(entry);
        expect(
          result.coverage.diagnostics.some(
            (d) => d.code === "SC2020" && d.message.includes("with an end bound"),
          ),
        ).toBe(true);
      }
      for (const source of [
        "console.log(Temporal.Now.instant());",
        'import { statSync } from "node:fs"; console.log(statSync("package.json").atimeInstant);',
        "console.log(new Date(0).toTemporalInstant());",
      ]) {
        writeFileSync(entry, source);
        const result = analyze(entry);
        expect(
          result.coverage.diagnostics.some(
            (d) => d.code === "SC2020" && d.message === "Temporal is not compiled natively yet",
          ),
          JSON.stringify(result.coverage.diagnostics),
        ).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
