// Packages can detect Temporal before attempting a refused native operation.
const temporal = typeof Temporal === "object" ? Temporal : null;
console.log(typeof temporal, typeof globalThis.Temporal, "Temporal" in globalThis);
console.log(temporal === globalThis.Temporal);
function probe(name) {
  const scope = globalThis;
  console.log(typeof scope[name], name in scope, scope[name] === temporal);
}
probe("Temporal");
console.log(Object.getOwnPropertyNames(globalThis).includes("Temporal"));
console.log(Reflect.ownKeys(globalThis).includes("Temporal"));
console.log(Object.keys(globalThis).includes("Temporal"));
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Temporal");
console.log(typeof descriptor.value, descriptor.value === temporal);
console.log(descriptor.writable, descriptor.enumerable, descriptor.configurable);
