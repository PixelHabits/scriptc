// process.throwDeprecation throws DEP0169 on the next tick. Invalid ports
// throw synchronously. Both reach an uncaughtException handler; neither
// reaches warning listeners. An unhandled deprecation ends the child.
"use strict";
const { spawnSync } = require("child_process");
const url = require("url");

const mode = process.argv[2];
if (mode === "handled") {
  process.on("warning", (warning) => console.log("listener:", warning.name));
  process.on("uncaughtException", (error) => {
    console.log("uncaught:", error.name, error.code, error instanceof Error);
    console.log(error.message);
  });
  process.throwDeprecation = true;
  console.log(url.parse("http://example.com:x/a").pathname);
  console.log(process.throwDeprecation, "end of turn");
} else if (mode === "unhandled") {
  process.throwDeprecation = true;
  console.log(url.parse("http://example.com/b").href);
  setTimeout(() => console.log("not reached"), 0);
} else {
  for (const child of ["handled", "unhandled"]) {
    const run = spawnSync(process.execPath, [process.argv[1], child], { encoding: "utf8" });
    console.log(`${child} status: ${run.status}`);
    console.log(run.stdout);
  }
}
