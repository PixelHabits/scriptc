// Valid under this project's own tsc (its "lib" is esnext): the errors
// come from scriptc's fixed type world and say so.
const values = new Map<string, number>();
console.log(values.getOrInsert("value", 1));
const runtime = typeof Deno === "undefined" ? "node" : "other";
console.log(runtime);
