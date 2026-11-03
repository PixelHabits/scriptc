// @normalize-pid
import * as url from "node:url";

process.on("warning", (warning) => {
  if ("code" in warning) console.log("warning", warning.name, warning.code, warning.message);
});
Promise.resolve().then(() => console.log("promise reaction"));
console.log(url.parse("http://example.com/a").host);
console.log(url.format("http://example.com/b"));
console.log(url.resolve("http://example.com/c/d", "../e"));
console.log("sync end");
setTimeout(() => console.log(url.parse("http://later.example/").href), 0);
