import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts5 from "typescript";
import { tscJsxOracleEntry, wantsTscJsx } from "./jsx-oracle.js";

const cacheDir = join(import.meta.dirname, "../../node_modules/.cache/scriptc-tests");
const ENTRY_EXTS = ["ts", "js", "mjs", "cjs"];

// comptime(fn) executes fn() under Node so its result is the runtime oracle.
export const comptimeShim = pathToFileURL(join(import.meta.dirname, "comptime-shim.mjs")).href;

/** Only the first two lines carry corpus directives. */
export function directiveHead(file: string): string[] {
  return readFileSync(file, "utf8").split("\n", 2);
}

export function expectedExitCode(file: string): number {
  for (const line of directiveHead(file)) {
    const m = /^\/\/ @exit:\s*(\d+)\s*$/.exec(line);
    if (m) return Number(m[1]);
  }
  return 0;
}

/** Per-program variables apply to both the oracle and the compiled binary. */
export function programEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of directiveHead(file)) {
    const m = /^\/\/ @env:\s*(.+?)\s*$/.exec(line);
    if (m === null) continue;
    for (const pair of m[1]!.split(",")) {
      const eq = pair.indexOf("=");
      if (eq > 0) env[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
  return env;
}

/** Directory entries include nested modules and module-resolution configs in cache keys. */
export function programInputs(file: string): string[] {
  if (!/\/main\.(ts|js|mjs|cjs)$/.test(file)) return [file];
  return [
    ...[...ENTRY_EXTS, "tsx", "jsx"].flatMap((ext) => globSync(join(file, `../**/*.${ext}`))),
    ...globSync(join(file, "../**/tsconfig.json")),
    ...globSync(join(file, "../**/package.json")),
  ].sort();
}

export function requiresIcu(file: string): boolean {
  return directiveHead(file).some((l) => /^\/\/ @requires-icu\s*$/.test(l));
}

export function wantsPidNormalized(file: string): boolean {
  return directiveHead(file).some((l) => /^\/\/ @normalize-pid\s*$/.test(l));
}

export function withoutWarningPid(stderr: Buffer): Buffer {
  return Buffer.from(stderr.toString("utf8").replace(/^\(node:\d+\) /gm, "(node:PID) "), "utf8");
}

function wantsTransformTypes(file: string): boolean {
  if (directiveHead(file).some((l) => /^\/\/ @transform-types\s*$/.test(l))) return true;
  // Enums need Node's transform even without an explicit directive.
  return programInputs(file).some((f) => /\benum\s+[A-Za-z_$]/.test(readFileSync(f, "utf8")));
}

function wantsTscDecorators(file: string): boolean {
  return directiveHead(file).some((l) => /^\/\/ @tsc-decorators\s*$/.test(l));
}

/** The entry and file or directory to ship with it. JSX emits a directory
 * graph; decorators emit one ES2022 module, named for the Windows lane when supplied. */
export function nodeOracleProgram(
  file: string,
  { decoratorName }: { decoratorName?: string } = {},
): { entry: string; root: string } {
  if (wantsTscJsx(directiveHead(file))) {
    const entry = tscJsxOracleEntry(file, cacheDir);
    return { entry, root: dirname(entry) };
  }
  if (!wantsTscDecorators(file))
    return { entry: file, root: /\/main\.(ts|js|mjs|cjs)$/.test(file) ? dirname(file) : file };
  const src = readFileSync(file, "utf8");
  const out = ts5.transpileModule(src, {
    compilerOptions: { target: ts5.ScriptTarget.ES2022, module: ts5.ModuleKind.ESNext },
    fileName: file,
  }).outputText;
  const key = createHash("sha256")
    .update(ts5.version)
    .update("\0")
    .update(src)
    .digest("hex")
    .slice(0, 16);
  const path =
    decoratorName === undefined
      ? join(cacheDir, `dec-oracle-${key}.mjs`)
      : join(cacheDir, "win-dec-oracle", key, decoratorName);
  mkdirSync(dirname(path), { recursive: true });
  // Concurrent suites publish the same content without exposing partial writes.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, path);
  return { entry: path, root: path };
}

/** Lanes supply entry and preload paths in the executing host's dialect.
 * The lane selects its Node executable and owns environment, cwd and stdin. */
export function oracleInvocation(
  file: string,
  {
    command = "node",
    entry = nodeOracleProgram(file).entry,
    preload = ["--import", comptimeShim],
  }: { command?: string; entry?: string; preload?: string[] } = {},
): { command: string; args: string[] } {
  const head = directiveHead(file);
  const transform = wantsTransformTypes(file)
    ? ["--experimental-transform-types", "--disable-warning=ExperimentalWarning"]
    : [];
  const nodep = head.some((l) => /^\/\/ @no-deprecation\s*$/.test(l)) ? ["--no-deprecation"] : [];
  const codegen = head.some((l) => /^\/\/ @disallow-code-generation\s*$/.test(l))
    ? ["--disallow-code-generation-from-strings"]
    : [];
  // --import routes CJS throws through ESM and changes their exception origin.
  const shims = head.includes("// @no-node-shims") ? [] : preload;
  return { command, args: [...transform, ...nodep, ...codegen, ...shims, entry] };
}
