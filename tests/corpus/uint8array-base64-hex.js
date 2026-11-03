const bytes = new Uint8Array([255, 254]);
if (typeof Uint8Array.prototype.toBase64 === 'function') console.log(bytes.toBase64());
else console.log(Buffer.from(bytes).toString('base64'));
console.log(bytes.toHex(), bytes.toBase64({ alphabet: 'base64url', omitPadding: true }));
console.log([...Uint8Array.fromBase64('//4=')], [...Uint8Array.fromHex('ffFE')]);
const target = new Uint8Array(4);
console.log(target.setFromBase64('AQID'), [...target]);
console.log(target.setFromHex('fffe'), [...target]);
for (const alphabet of ['base64', 'base64url']) {
  for (const omitPadding of [false, true]) {
    for (const values of [[], [255], [255, 254], [255, 254, 253]]) {
      console.log('encode', alphabet, omitPadding, new Uint8Array(values).toBase64({ alphabet, omitPadding }));
    }
  }
}
for (const lastChunkHandling of ['loose', 'strict', 'stop-before-partial']) {
  for (const input of ['', ' Z g == \n', 'Zg', 'Z', 'Zh==', 'Zm9=', 'Zm8', 'Zg=', 'Zm9vZg', 'Zm9v!', '//4=', '__4=', 'Zg==x', 'Zg\v==', 'Zg\u00a0==']) {
    try { console.log('decode', lastChunkHandling, JSON.stringify(input), [...Uint8Array.fromBase64(input, { lastChunkHandling })]); }
    catch (e) { console.log('decode', lastChunkHandling, JSON.stringify(input), e.name, e.message); }
    for (const length of [0, 1, 2, 3, 4]) {
      const into = new Uint8Array(length).fill(99);
      try { console.log('set', length, into.setFromBase64(input, { lastChunkHandling }), [...into]); }
      catch (e) { console.log('set', length, e.name, e.message, [...into]); }
    }
  }
}
for (const input of ['__4=', '__4', '//4=', 'Zm9v']) {
  try { console.log('url', [...Uint8Array.fromBase64(input, { alphabet: 'base64url' })]); }
  catch (e) { console.log('url', e.name, e.message); }
}
for (const input of ['', '00aAFF', '0', '00xx', '00ffxx', ' 00', 'éé']) {
  try { console.log('hex', JSON.stringify(input), [...Uint8Array.fromHex(input)]); }
  catch (e) { console.log('hex', JSON.stringify(input), e.name, e.message); }
  for (const length of [0, 1, 2, 3]) {
    const into = new Uint8Array(length).fill(99);
    try { console.log('hex-set', into.setFromHex(input), [...into]); }
    catch (e) { console.log('hex-set', e.name, e.message, [...into]); }
  }
}
for (const options of [null, 1, 'x', { alphabet: 'other' }, { alphabet: null }, { lastChunkHandling: 'other' }]) {
  for (const run of [() => bytes.toBase64(options), () => Uint8Array.fromBase64('Zg==', options), () => target.setFromBase64('Zg==', options)]) {
    try { console.log('options', run()); } catch (e) { console.log('options', e.name, e.message); }
  }
}
for (const run of [() => Uint8Array.fromBase64(1), () => Uint8Array.fromHex(null), () => target.setFromBase64(), () => target.setFromHex({})]) {
  try { run(); } catch (e) { console.log('input', e.name, e.message); }
}
const order = [];
console.log(bytes.toBase64({ get alphabet() { order.push('alphabet'); return 'base64url'; }, get omitPadding() { order.push('padding'); return true; } }), order.join(','));
console.log('buffer', Buffer.from([255, 254]).toBase64(), Buffer.from([255, 254]).toHex());
const encode = bytes.toBase64;
console.log('borrow', encode.call(new Uint8Array([1, 2, 3])));
try { encode.call(new Uint16Array([1])); } catch (e) { console.log('receiver', e.name, e.message); }
for (const value of [new Uint8Array(), Buffer.alloc(0), new Uint16Array()]) {
  console.log('in', 'toBase64' in value, 'setFromHex' in value);
}
for (const method of ['toBase64', 'setFromBase64', 'toHex', 'setFromHex']) {
  const backing = new ArrayBuffer(2);
  const view = new Uint8Array(backing);
  backing.transfer();
  try { view[method](''); } catch (e) { console.log('detached', method, e.name, e.message); }
}
