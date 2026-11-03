// Checked native values use typed-array semantics without a JS engine.
/** @param {any} input */
function construct(input) { return new Uint8Array(input); }
/** @param {any} input */
function from(input) { return Uint8Array.from(input); }
/** @param {Uint8Array} target @param {any} input @param {number} offset */
function set(target, input, offset = 0) { target.set(input, offset); }
/** @param {Uint8Array} value */
function dump(value) { return Buffer.from(value).toString("hex"); }

console.log("lengths", construct(3.9).length, construct("4").length, construct(null).length, construct(undefined).length, construct(true).length);
console.log("copy", dump(construct(new Uint8Array([1, 2, 255]))));
console.log("array", dump(construct([257, -1, "3", null, undefined, true])));
console.log("array-like", dump(construct({ length: "4.9", 0: 17, 2: "258" })));
console.log("from", dump(from("12💡3")), from(4).length, from(true).length);
console.log("from-array", dump(from([1, 258, -1])));
console.log("from-object", dump(from({ length: 3, 1: 7 })));

const target = new Uint8Array(6);
set(target, [257, -2, "3"], 1);
console.log("set-array", dump(target));
set(target, "45", 0);
console.log("set-string", dump(target));
set(target, { length: "2.9", 0: 8, 1: 9 }, 4);
console.log("set-object", dump(target));
set(target, 123);
set(target, false);
console.log("set-primitives", dump(target));

for (const input of [null, undefined]) {
  try { from(input); } catch (e) { console.log("from-error", e.name, e.message); }
  try { set(target, input); } catch (e) { console.log("set-error", e.name, e.message); }
}
for (const offset of [-1, Infinity, 6, NaN, -0.5]) {
  try { set(target, [42], offset); console.log("offset", dump(target)); }
  catch (e) { console.log("offset-error", e.name, e.message); }
}
try { construct(-1); } catch (e) { console.log("length-error", e.name, e.message); }

const converted = { valueOf() { return 259; } };
console.log("element-hook", dump(from([converted])));
const failing = { valueOf() { throw new Error("bad element"); } };
try { set(target, [21, failing], 2); }
catch (e) { console.log("partial", e.message, dump(target)); }
try { from([failing]); } catch (e) { console.log("from-hook-error", e.message); }

// TypedArray.from snapshots iterable values before conversion; array-like reads interleave it.
/** @type {any} */
const array = [converted, 7];
const changing = { valueOf() { array[1] = 9; return 1; } };
array[0] = changing;
console.log("iteration-order", dump(from(array)), Number(array[1]));
/** @type {any} */
const object = { length: 2, 0: converted, 1: 7 };
object[0] = { valueOf() { object[1] = 9; return 1; } };
console.log("array-like-order", dump(from(object)), object[1]);
array[0] = 0;
object[0] = 0;

/** @type {any} */
const constructorArray = [0, 7];
constructorArray[0] = { valueOf() { constructorArray[1] = 9; return 1; } };
console.log("constructor-snapshot", dump(construct(constructorArray)), constructorArray[1]);
constructorArray[0] = 0;
let lengthReads = 0;
const length = { valueOf() { lengthReads++; return 2; } };
console.log("length-hook", dump(from({ length, 0: 4, 1: 5 })), lengthReads);
try { set(target, { length: Infinity }, 0); } catch (e) { console.log("huge-set", e.name, e.message); }
try { set(target, null, -1); } catch (e) { console.log("negative-before-null", e.name, e.message); }
try { construct({ length: Infinity }); } catch (e) { console.log("huge-constructor", e.name, e.message); }
try { from({ length: Infinity }); } catch (e) { console.log("huge-from", e.name, e.message); }
