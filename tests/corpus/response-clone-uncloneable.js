process.on('uncaughtException', e => console.log('caught', e.name));
const response = new Response(new ReadableStream({ start(c) { c.enqueue(() => {}); } }));
response.clone().body.getReader().read();
setTimeout(() => console.log('timer'), 20);
