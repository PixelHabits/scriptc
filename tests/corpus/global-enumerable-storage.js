// @no-node-shims
console.log(Object.hasOwn(globalThis, 'sessionStorage'), Object.keys(globalThis).includes('sessionStorage'));
console.log(Object.keys(globalThis).join(','));
