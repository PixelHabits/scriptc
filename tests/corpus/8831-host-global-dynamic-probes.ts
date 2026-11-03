// Absent host capabilities and the present Temporal namespace keep Node answers.
declare const Bun: { readonly version?: string } | undefined;
declare const Deno: { readonly version: { deno: string } } | undefined;
declare const HostEventStream: unknown;

const scope = globalThis as Record<string, unknown>;
const probes = ["Bun", "Deno", "Temporal", "HostEventStream"];
for (const name of probes) console.log(name, typeof scope[name], name in scope);
console.log(typeof globalThis["Temporal"], "Temporal" in globalThis);
console.log(typeof Bun, typeof Deno, typeof HostEventStream);
const runtime = typeof Deno === "object" ? "deno" : typeof Bun === "object" ? "bun" : "node";
console.log(runtime);
const key: string = "Bun";
console.log(key in globalThis, typeof scope[key]);
