import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { analyze, compile } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const message = "Temporal is not compiled natively yet";

test("Temporal member use refuses at compile time", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-temporal-static-"));
  try {
    const entry = join(dir, "main.ts");
    for (const source of [
      "Temporal.Instant;",
      'console.log(Temporal.PlainDate.from("2026-01-01"));',
      "console.log(typeof Temporal.Now);",
      "new Temporal.Duration(1);",
      "console.log(new Date(0).toTemporalInstant());",
      "const { Instant } = Temporal; console.log(Instant);",
      "function read(value: typeof Temporal) { return value.Now; } console.log(read(Temporal));",
      'import { statSync } from "node:fs"; console.log(typeof statSync("package.json").mtimeInstant);',
      'const temporal = Temporal; console.log(temporal["Instant"]);',
      'console.log(globalThis.Temporal["Now"]);',
      'import { statSync } from "node:fs"; console.log(statSync("package.json").atimeInstant);',
      'import { statSync } from "node:fs"; console.log(statSync("package.json", { bigint: true }).birthtimeInstant);',
    ]) {
      writeFileSync(entry, source);
      const result = analyze(entry);
      expect(
        result.coverage.diagnostics.some((d) => d.code === "SC2020" && d.message === message),
        JSON.stringify(result.coverage.diagnostics),
      ).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("npm JavaScript defers Temporal member refusal until execution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-temporal-npm-"));
  try {
    const pkg = join(dir, "node_modules/temporal-probe");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "temporal-probe", type: "module", exports: "./index.js" }),
    );
    writeFileSync(
      join(pkg, "index.js"),
      `
import { stat } from "node:fs";
function reportStats(error, stats) {
  if (error) throw error;
  const proto = Object.getPrototypeOf(stats);
  for (const name of ["atimeInstant", "mtimeInstant", "ctimeInstant", "birthtimeInstant"]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    console.log(name in stats, descriptor.enumerable, typeof descriptor.get, typeof descriptor.set);
    try { stats[name]; } catch (error) { console.log(error.message); }
    try { stats[name] = null; } catch (error) { console.log(error.message); }
  }
}
export function probe(key) {
  const scope = globalThis;
  console.log(typeof Temporal, typeof scope[key], key in scope);
  console.log(scope[key] === Temporal);
  console.log("loaded");
  try { scope[key].Now; } catch (error) { console.log(error.message); }
  try { Temporal.Instant; } catch (error) { console.log(error.message.startsWith("${message}")); }
  stat("package.json", reportStats);
  stat("package.json", { bigint: true }, reportStats);
  console.log(Object.getOwnPropertyNames(Date.prototype).includes("toTemporalInstant"));
  try { new Date(0)["to" + key + "Instant"](); } catch (error) { console.log(error.message.split(" [")[0]); }
}
`,
    );
    const entry = join(dir, "main.ts");
    writeFileSync(entry, 'import { probe } from "temporal-probe"; probe("Temporal");');
    const result = await compile(entry, {
      outPath: join(dir, "program"),
      outDir: dir,
      sanitize,
      npmStatic: ["temporal-probe"],
    });
    expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics) : "").toBe(true);
    if (!result.ok) return;
    const native = await execFileAsync(result.binaryPath);
    expect(native.stdout).toBe(
      [
        "object object true",
        "true",
        "loaded",
        `${message} [SC2020]`,
        "true",
        "true",
        message,
        ...Array.from({ length: 8 }, () => [
          "true true function function",
          `${message} [SC2020]`,
          `${message} [SC2020]`,
        ]).flat(),
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
