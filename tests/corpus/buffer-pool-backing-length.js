const b = Buffer.allocUnsafe(32).fill(42);
console.log(Buffer.poolSize, b.buffer.byteLength);
