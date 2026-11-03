// @transform-types
// An alias used only as a type is erased with its namespace.
namespace T {
  export interface I {
    a: number;
  }
}

console.log("before the alias");
import P = T;
console.log("after the alias");
const unused: P.I = { a: 1 };
console.log(unused.a);
