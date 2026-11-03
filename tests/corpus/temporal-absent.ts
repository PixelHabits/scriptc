// Temporal presence and identity are available without native member use.
console.log(typeof Temporal, typeof globalThis.Temporal);
const hasTemporal = typeof Temporal !== "undefined";
console.log("hasTemporal", hasTemporal);
console.log(Temporal === globalThis.Temporal);
const scope = globalThis as Record<string, unknown>;
const key: string = "Temporal";
console.log(typeof scope[key], key in scope, scope[key] === Temporal);
console.log(Object.getOwnPropertyNames(globalThis).includes(key));
console.log(Reflect.ownKeys(globalThis).includes(key));
console.log(Object.keys(globalThis).includes(key));
const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)!;
console.log(typeof descriptor.value, descriptor.value === Temporal);
console.log(descriptor.writable, descriptor.enumerable, descriptor.configurable);
