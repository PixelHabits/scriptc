/* Both LLVM optimization modes must compile every corpus program and match
 * Node's stdout, successful stderr, and expected exit status. Any backend
 * refusal is a failure. SCRIPTC_SAN=1 instruments emitted code and runtime.
 * SCRIPTC_CPU_DISPATCH=1 builds with runtime CPU dispatch and runs each
 * executable at SCRIPTC_CPU_LEVEL=0 and 3, the baseline and x86-64-v3 copies.
 * SCRIPTC_TARGET_CPU=<level> builds for that `--target-cpu` level. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { corpusSelect, shardSuffix } from "./shard.js";
import { libnodePack, requiresLibnode } from "./libnode.js";
import {
  expectedExitCode,
  oracleInvocation,
  programEnv,
  programInputs,
  requiresIcu,
  wantsPidNormalized,
  withoutWarningPid,
} from "./node-oracle.js";

type TargetCpu = NonNullable<NonNullable<Parameters<typeof compile>[1]>["targetCpu"]>;

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const corpusDir = join(repoRoot, "tests/corpus");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

// Same corpus, same SCRIPTC_TEST_SHARD slice as differential.test.ts (the
// two files split identically, so a shard's compile cache serves both lanes).
const ENTRY_EXTS = ["ts", "js", "mjs", "cjs"];
const files = corpusSelect(
  ENTRY_EXTS.flatMap((ext) => [
    ...globSync(join(corpusDir, `*.${ext}`)),
    ...globSync(join(corpusDir, `*/main.${ext}`)),
  ]).sort(),
  (f) => f.slice(corpusDir.length + 1),
  process.env["SCRIPTC_SAN"] === "1",
);
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const cpuDispatch = process.env["SCRIPTC_CPU_DISPATCH"] === "1";
const targetCpu = process.env["SCRIPTC_TARGET_CPU"] as TargetCpu | undefined;
const cpuLevels: readonly (string | undefined)[] = cpuDispatch ? ["0", "3"] : [undefined];
const requestedMode = process.env["SCRIPTC_LLVM_TEST_MODE"];
if (requestedMode !== undefined && requestedMode !== "release" && requestedMode !== "dev") {
  throw new Error("SCRIPTC_LLVM_TEST_MODE must be release or dev when set");
}
// Combined CI lanes cover release in differential.test.ts. Standalone and
// packaged-artifact runs retain both modes unless one is explicitly selected.
const optimizationModes: readonly ("release" | "dev")[] =
  requestedMode === undefined ? ["release", "dev"] : [requestedMode];

// Same known-env contract as the main differential suite.
process.env["SCRIPTC_TEST_ENV"] = "from-harness";

interface RunResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

function icuAvailable(): boolean {
  return process.platform === "linux" && process.arch === "x64";
}

async function runBinary(
  cmd: string,
  args: string[],
  cpuLevel?: string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  // Linux fork/exec race (observed on the sandbox lane): a sibling
  // worker's fork can inherit the freshly-linked binary's write fd across
  // its own spawn window, and exec answers ETXTBSY until that fd closes.
  // The condition is transient by construction — retry briefly, the
  // npm/cargo stance.
  for (let attempt = 0; ; attempt++) {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
    if (cpuLevel !== undefined) env["SCRIPTC_CPU_LEVEL"] = cpuLevel;
    const pending = execFileAsync(cmd, args, {
      encoding: "buffer",
      ...(cpuLevel === undefined && Object.keys(extraEnv).length === 0 ? {} : { env }),
    });
    pending.child.stdin?.end();
    try {
      const { stdout, stderr } = await pending;
      return { stdout, stderr, exitCode: 0 };
    } catch (err) {
      const e = err as { code?: unknown; stdout?: Buffer; stderr?: Buffer };
      if (e.code === "ETXTBSY" && attempt < 10) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      if (typeof e.code !== "number" || !Buffer.isBuffer(e.stdout) || !Buffer.isBuffer(e.stderr)) {
        throw err;
      }
      return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
    }
  }
}

function comparableStderr(stderr: Buffer): Buffer {
  if (!sanitize) return stderr;
  const lines = stderr.toString("utf8").split("\n");
  const kept = lines.filter(
    (l) =>
      !l.startsWith("scriptc RC audit skipped:") &&
      // Linux ASan's once-per-process fiber-swapcontext warning (see
      // differential.test.ts's comparableStderr).
      !/^==\d+==WARNING: ASan doesn't fully support makecontext\/swapcontext/.test(l),
  );
  return Buffer.from(kept.join("\n"), "utf8");
}

/** `// @normalize-pid` (differential.test.ts): Node's process warnings
 * compare with the pid replaced on both sides. */
function pidFree(file: string, stderr: Buffer): Buffer {
  return wantsPidNormalized(file) ? withoutWarningPid(stderr) : stderr;
}

async function build(file: string, optimization: "release" | "dev") {
  const hash = createHash("sha256");
  for (const f of programInputs(file)) hash.update(f).update(readFileSync(f));
  const key = hash
    .update(sanitize ? "san" : "plain")
    .update("llvm-" + optimization)
    .update(cpuDispatch ? "cpu-dispatch" : "")
    .update(targetCpu === undefined ? "" : `target-cpu-${targetCpu}`)
    .digest("hex")
    .slice(0, 16);
  const outDir = join(cacheDir, key);
  mkdirSync(outDir, { recursive: true });
  return compile(file, {
    outPath: join(outDir, `program-llvm-${optimization}${sanitize ? "-san" : ""}`),
    outDir,
    sanitize,
    optimization,
    ...(cpuDispatch ? { cpuDispatch } : {}),
    ...(targetCpu === undefined ? {} : { targetCpu }),
  });
}

describe(`llvm differential corpus (${files.length} programs, ${optimizationModes.join("+")}${sanitize ? ", sanitized" : ""}${cpuDispatch ? ", CPU dispatch" : ""}${targetCpu === undefined ? "" : `, ${targetCpu}`}${shardSuffix()})`, () => {
  test.for(files.map((f) => [f.slice(corpusDir.length + 1), f] as const))(
    "%s",
    async ([rel, file], { skip }) => {
      // Programs that call into Node need a libnode pack (libnode.ts).
      if (requiresLibnode(file) && libnodePack() === null) skip();
      if (requiresIcu(file) && !icuAvailable()) skip();
      const { command, args } = oracleInvocation(file, { command: process.execPath });
      const oracle = await runBinary(command, args, undefined, programEnv(file));
      const expectedExit = expectedExitCode(file);
      expect(oracle.exitCode).toBe(expectedExit);
      for (const optimization of optimizationModes) {
        const result = await build(file, optimization);
        if (!result.ok)
          throw new Error(
            `${rel} (${optimization}): ` +
              result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "),
          );
        expect(result.backend).toBe("llvm");
        expect(result.llvmPath.endsWith(".ll")).toBe(true);
        for (const level of cpuLevels) {
          const actual = await runBinary(result.binaryPath, [], level, programEnv(file));
          const lane = level === undefined ? optimization : `${optimization} level ${level}`;
          expect(actual.stdout, `${lane} stdout`).toEqual(oracle.stdout);
          if (expectedExit === 0)
            expect(pidFree(file, comparableStderr(actual.stderr)), `${lane} stderr`).toEqual(
              pidFree(file, oracle.stderr),
            );
          expect(actual.exitCode, `${lane} exit status`).toBe(expectedExit);
        }
      }
    },
  );
});
