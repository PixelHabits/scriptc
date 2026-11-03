const assert = require('node:assert');
for (const run of [
  () => assert.strictEqual(1, 2, () => 'custom'),
  () => assert.ok(false, (a, e) => `got ${a} ${e}`),
  () => assert.ok(false, null),
  () => assert(false, null),
]) {
  try { run(); } catch (e) { console.log(e.name, e.code, e.generatedMessage, JSON.stringify(e.message)); }
}
let calls = 0;
for (const factory of [() => { calls++; return 'made'; }, () => undefined, () => 7, () => '', () => { throw new Error('ignored'); }]) {
  assert.strictEqual(1, 1, factory);
  for (const run of [() => assert.strictEqual(1, 2, factory), () => assert.notStrictEqual(1, 1, factory), () => assert.deepStrictEqual({ a: 1 }, { a: 2 }, factory), () => assert.ok(false, factory)]) {
    try { run(); } catch (e) { console.log('factory', e.name, e.code, e.generatedMessage, JSON.stringify(e.message)); }
  }
}
console.log('calls', calls);
const ok = assert.ok;
try { ok(false, null); } catch (e) { console.log('ok-value', e.name, e.code, e.generatedMessage); }
