// @exit: 1
process.on("exit", (code) => console.log("exit", code));
process.nextTick(() => console.log("next tick"));
setTimeout(() => console.log("timer"), 0);
queueMicrotask(() => console.log("microtask"));
Promise.resolve()
  .then(() => console.log("reaction 1"))
  .then(() => console.log("reaction 2"))
  .then(() => console.log("reaction 3"))
  .then(() => console.log("reaction 4"))
  .then(() => console.log("reaction 5"));
console.log("module");
throw new Error("module failure");
