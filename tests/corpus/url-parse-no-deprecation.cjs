"use strict";
const { spawnSync } = require("node:child_process");
const url = require("node:url");

if (process.argv[2] === "silenced") {
  process.on("warning", (warning) => {
    console.log("listener", warning.name, warning.code, warning.message);
  });
  process.noDeprecation = true;
  console.log(url.parse("http://example.com:8080/a").port);
  process.emitWarning("ordinary warning while silenced");
  setTimeout(() => {
    process.noDeprecation = false;
    console.log(url.parse("http://example.com/b").hostname);
    process.emitWarning("direct deprecation after restore", "DeprecationWarning", "DEP_URL_1");
  }, 0);
} else if (process.argv[2] === "late") {
  process.on("warning", (warning) => console.log("listener", warning.name, warning.code));
  console.log(url.parse("http://example.com/late").path);
  process.noDeprecation = true;
  console.log("end of turn", process.noDeprecation);
} else {
  for (const mode of ["silenced", "late"]) {
    const child = spawnSync(process.execPath, [process.argv[1], mode], { encoding: "utf8" });
    console.log(mode, child.status);
    console.log(child.stdout);
    console.log(child.stderr.replace(/\(node:\d+\)/g, "(node:<pid>)"));
  }
}
