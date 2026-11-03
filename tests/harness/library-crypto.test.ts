import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compileLibrary } from "@scriptc/compiler";

test("library hashes accept SHAKE and a runtime algorithm name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-library-crypto-"));
  const sanitize = process.env["SCRIPTC_SAN"] === "1";
  try {
    const entry = join(dir, "entry.ts");
    await writeFile(
      entry,
      `import { createHash, hash } from "node:crypto";
export function result(algorithm: string): number {
  return createHash("shake128").update("abc").digest("hex").length
    + createHash(algorithm).update("abc").digest("hex").length
    + hash("shake128", "abc").length + hash(algorithm, "abc").length;
}
`,
    );
    const profilePath = join(dir, "profile.json");
    await writeFile(
      profilePath,
      JSON.stringify({
        profile_format: 2,
        name: "hashes",
        entry,
        emission: "llvm",
        abi: { prefix: "app_", init_symbol: "app_init", sink_register_symbol: "app_sink" },
        exports: [{ export: "result", symbol: "app_result", params: ["cstring"], returns: "f64" }],
      }),
    );
    const result = await compileLibrary({ profilePath, outDir: dir, sanitize });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const host = join(dir, "host.c");
    const binary = join(dir, "host");
    await writeFile(
      host,
      '#include <stdio.h>\nvoid app_init(void); double app_result(const char *);\nint main(void) { app_init(); printf("%.0f\\n", app_result("sha256")); app_init(); }\n',
    );
    execFileSync("clang", [
      host,
      result.archivePath,
      "-lm",
      ...(sanitize ? ["-fsanitize=address"] : []),
      "-o",
      binary,
    ]);
    const reference = execFileSync(
      process.execPath,
      [
        "--no-warnings",
        "--input-type=module",
        "-e",
        `import { result } from ${JSON.stringify(entry)}; console.log(result("sha256"));`,
      ],
      { encoding: "utf8" },
    );
    expect(execFileSync(binary, { encoding: "utf8" })).toBe(reference);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
