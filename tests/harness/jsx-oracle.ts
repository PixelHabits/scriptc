import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";
import ts5 from "typescript";

// The emitter bytes distinguish patched builds with the same package version.
export const tscOracleIdentity = createHash("sha256")
  .update(readFileSync(createRequire(import.meta.url).resolve("typescript")))
  .update(readFileSync(import.meta.filename))
  .digest("hex");

export function wantsTscJsx(head: readonly string[]): boolean {
  return head.some((line) => /^\/\/ @tsc-jsx\s*$/.test(line));
}

/** Transpile a single module or a directory graph for the Node oracle. */
export function tscOracleProgram(
  file: string,
  cacheDir: string,
  name?: string,
): { entry: string; root: string } {
  const root = dirname(file);
  const directory = /\/main\.(ts|js|mjs|cjs)$/.test(file);
  const files = directory ? listFiles(root) : [file];
  const hash = createHash("sha256").update(tscOracleIdentity);
  const entryName = directory ? "main.js" : (name ?? `${basename(file)}.mjs`);
  hash.update("\0").update(entryName);
  for (const path of files)
    hash.update("\0").update(relative(root, path)).update("\0").update(readFileSync(path));
  const dir = join(cacheDir, `tsc-oracle-${hash.digest("hex").slice(0, 16)}`);
  const entry = join(dir, entryName);
  const program = { entry, root: directory ? dir : entry };
  if (existsSync(entry)) return program;
  const configPath = join(root, "tsconfig.json");
  const config = existsSync(configPath)
    ? ts5.parseJsonConfigFileContent(
        ts5.readConfigFile(configPath, ts5.sys.readFile).config ?? {},
        ts5.sys,
        root,
      ).options
    : {};
  const compilerOptions: ts5.CompilerOptions = {
    target: ts5.ScriptTarget.ES2022,
    module: ts5.ModuleKind.ESNext,
    rewriteRelativeImportExtensions: true,
    jsx: config.jsx,
    jsxFactory: config.jsxFactory,
    jsxFragmentFactory: config.jsxFragmentFactory,
    jsxImportSource: config.jsxImportSource,
    reactNamespace: config.reactNamespace,
  };
  // Atomic publish: build beside the final directory, then rename it into
  // place; a concurrent suite that wins the rename leaves the same content.
  const staging = `${dir}.${process.pid}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  for (const path of files) {
    const target = join(staging, relative(root, path));
    mkdirSync(dirname(target), { recursive: true });
    if (/\.(?:[cm]?ts|tsx|jsx?|[cm]js)$/.test(path) && !/\.d\.[cm]?ts$/.test(path)) {
      const output = ts5.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions,
        fileName: path,
      }).outputText;
      writeFileSync(
        directory
          ? target
              .replace(/\.(?:ts|tsx|jsx)$/, ".js")
              .replace(/\.mts$/, ".mjs")
              .replace(/\.cts$/, ".cjs")
          : join(staging, entryName),
        output,
      );
    } else if (/(^|\/)package\.json$/.test(path)) {
      // Import and export targets follow their files: .ts, .tsx and .jsx
      // become .js.
      const renamed = (value: unknown): unknown =>
        typeof value === "string"
          ? /\.d\.[cm]?ts$/.test(value)
            ? value
            : value
                .replace(/\.(?:ts|tsx|jsx)$/, ".js")
                .replace(/\.mts$/, ".mjs")
                .replace(/\.cts$/, ".cjs")
          : Array.isArray(value)
            ? value.map(renamed)
            : value !== null && typeof value === "object"
              ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renamed(item)]))
              : value;
      writeFileSync(
        target,
        `${JSON.stringify(renamed(JSON.parse(readFileSync(path, "utf8"))), null, 2)}\n`,
      );
    } else {
      copyFileSync(path, target);
    }
  }
  if (!existsSync(join(staging, "package.json")))
    writeFileSync(join(staging, "package.json"), '{ "type": "module" }\n');
  try {
    renameSync(staging, dir);
  } catch {
    rmSync(staging, { recursive: true, force: true });
  }
  return program;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  visit(root);
  return out;
}
