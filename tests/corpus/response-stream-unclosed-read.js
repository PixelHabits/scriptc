async function main() {
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([42])); }
  }));
  const reader = response.body.getReader();
  const { done, value } = await reader.read();
  console.log(done, value[0]);
  reader.read();

  const pending = new Response(new ReadableStream({
    start(controller) {
      setTimeout(() => controller.enqueue(new Uint8Array([43])), 10);
    }
  })).body.getReader().read();
  const delayed = await pending;
  console.log(delayed.done, delayed.value[0]);

  const bridged = new Response(new ReadableStream({
    start(controller) {
      setTimeout(() => controller.enqueue(new Uint8Array([44])), 10);
    }
  }));
  const [branch] = bridged.body.tee();
  const forwarded = await branch.getReader().read();
  console.log(forwarded.done, forwarded.value[0]);
}
main();
