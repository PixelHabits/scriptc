# Bun support design

Status: proposal. Claims carry a label: **measured** (read in source or run), **inferred** (a conclusion from measured facts), or **unknown**.

## Goal

scriptc compiles TypeScript and JavaScript ahead of time to native executables and WebAssembly modules for speed and low memory, with no JavaScript engine at run time. This design adds Bun as a second source runtime: a program written for Bun compiles with scriptc and behaves as it does under `bun`, and scriptc's aims stay the same. Bun programs gain the same benefits Node programs have today, such as fast cold starts and small resident memory.

The target is Bun's public behavior at a pinned release, Bun 1.4.4 (tag `bun-v1.4.4`, commit `38afee6c84`, released 2026-10-22). Only operations that evaluate new source text at run time, or that expose the engine itself, are out of scope by design (see [Compatibility ledger](#compatibility-ledger)).

## Summary

- A **Bun runtime profile** selects Bun behavior at compile time. `--runtime bun` selects it explicitly; automatic detection from the compiled code follows in the next slice. Node builds keep linking exactly what they link today.
- Bun APIs are **reimplemented in scriptc's C runtime** on top of its existing HTTP, fetch, web streams, filesystem, TLS, compression, and scheduler code. Bun's runtime is not linked: its server, SQL, and file code is built around JavaScriptCore objects. Bun's MIT-licensed algorithms can still be ported where they fit.
- Algorithm-heavy families link **standalone libraries** where one exists with a C ABI and a compatible license, such as `temporal_capi` for Temporal and SQLite for `bun:sqlite`. Each new dependency needs approval when its slice starts.
- A **Bun differential lane** runs each program in `tests/corpus-bun/` under `bun run --no-env-file` and as a compiled binary, with the existing byte-for-byte comparison and isolated state per execution.
- A **Bun compatibility ledger** pins Bun 1.4.4. It is seeded from the published declarations and extended with the behavior declarations miss, using the same status contract as the Node ledger, per target.
- Work proceeds in vertical slices, one API per slice. The first slice is a `Bun.serve` hello world that answers one `fetch`.

## Runtime profile

A build has one runtime profile, `node` or `bun`. The profile is a compile-time choice: it selects declarations, global presence, module resolution conditions, lowering, and runtime units. No surveyed difference between Bun and Node needs a switch evaluated while the program runs (inferred from 31 probes run under both runtimes).

### Selecting the profile

scriptc picks the profile in this order and prints the choice and its reason, for example `runtime: bun (src/server.ts:3 imports "bun")`:

1. `--runtime bun` or `--runtime node` on `scriptc build`, `run`, or `coverage`, or the `runtime` option of the compiler API.
2. The compiled code itself. Any of these selects Bun:
   - a static import, re-export, `require`, or literal dynamic `import()` of `bun` or a `bun:*` module in any resolved module, excluding type-only imports that compile away;
   - a reference to the global `Bun`, or another Bun-only global, in first-party code (code whose real path is outside `node_modules`). The binder decides what a name refers to, so a local variable named `Bun` does not count. A guarded reference such as `typeof Bun !== "undefined"` does count, because its author wrote Bun-aware code;
   - a package whose `exports` offer a `bun` condition and no branch Node resolution can use;
   - an entry whose first line is a shebang that runs `bun`.
3. Otherwise `node`, which is today's behavior.

Package-manager files such as `bun.lock`, `bunfig.toml`, and `packageManager` do not select the profile. They describe how dependencies are installed, not which runtime runs the program. `@types/bun` does not select it either, because projects often install it only for `bun test`. Dependencies that only probe the runtime do not count: libraries such as consola and Sentry test `typeof Bun` and also run under Node.

The profile changes module resolution, because Bun applies the `bun` exports condition. Detection scans first-party sources before it resolves packages. If the graph resolved under Node conditions then shows a Bun signal, the switch to Bun happens once and the frontend rebuilds the whole graph under Bun conditions. The switch only goes from Node to Bun, so it cannot oscillate. The frontend already rebuilds with a changed decision for Node islands (measured: `packages/compiler/src/executable/prepare.ts:84-110`).

A program that uses no Bun API but is run with `bun` builds as Node. Its console formatting and error text then follow Node. `--runtime bun` covers that case.

### Profile identity

The profile and the Bun pin are part of every identity that a profile can change (inferred): resolution with its separate export-condition worlds (measured: `packages/compiler/src/frontend/resolve.ts:409-422,900-906`, `cjs-resolve.ts:127`), checker and lowering reuse, the executable cache (measured: `packages/compiler/src/executable/executable-cache.ts:416-435,470-493`), and runtime-pack selection.

Runtime objects arrive prebuilt in runtime packs, so an application compile flag cannot change their behavior (measured). Where Bun's behavior differs inside shared C code, such as console formatting or error text, the Bun variant is a separate runtime function or unit variant that lowering selects. Node executables then link the same objects as before. Changes in M1 run the zero-cost gate with `--strict` to prove that.

### What the profile changes

Bun 1.4.4 and Node 24 differ on surfaces they share (measured by probes under `bun` 1.4.4 and `node` 24.22.1). Under the Bun profile these follow Bun:

| Area | Difference | scriptc owner today |
| --- | --- | --- |
| Console | Multiline objects, quote style, collection layout, sparse holes, Error rendering, Promise markers | `packages/compiler/src/frontend/lowering/lower-console.ts:243-319`, `packages/runtime/src/scr_inspect.c` |
| Engine error messages | JavaScriptCore text differs from V8 for property access, calls, array length, `JSON.parse`, `repeat`, BigInt, URI, const assignment | `packages/compiler/src/frontend/lowering/primitive-throws.ts:149-162`, `scr_json.c`, `scr_array.c`, `scr_string.c` |
| Stacks and fatal output | Frame format, source snippets, headings, runtime footer | `packages/runtime/src/scr_exception.c:693-757`, `scr_async.c:6309-6378` |
| Process identity | `process.version` is `v26.3.0` under Bun; `versions`, `release`, `title`, `execPath`, `navigator.userAgent` differ | `packages/runtime/src/scr_lib.c:622-778`, `builtins/process.ts`, `builtins/navigator.ts` |
| Environment | `bun run` loads `.env` files automatically | `packages/runtime/src/scr_lib.c:781-807` |
| Globals | 23 globals exist only in Bun, including `Bun`, `Temporal`, `HTMLRewriter`, `self`, `reportError`, `Worker` | `packages/compiler/src/frontend/lowering/global-values.ts:125-140,339-369` |
| Modules | `require` inside ESM, CJS namespace shape, bare JSON and text imports, the `bun` exports condition, tsconfig `paths` at run time | `packages/compiler/src/frontend/resolve.ts`, `cjs-resolve.ts`, `lower-node-module.ts` |
| `import.meta` | `dir`, `file`, `path`, `env`, `require` aliases | `packages/compiler/src/frontend/lowering/import-meta.ts:30-60` |
| fetch and web classes | `User-Agent: Bun/1.4.4`, br and zstd advertised, default headers, `Headers.toJSON`, request and response defaults | `packages/runtime/src/scr_fetch.c` |
| Shared `node:` modules | Loose `assert` results, dotfile globbing, debuglog metadata, and v8 serialization differ in samples | `scr_assert.c`, `scr_glob.c`, `scr_util_callable.c` |

`util.inspect` matched Node on every sampled value, so it stays shared (measured).

### The `Bun` object

`Bun` is a real object whose properties are function values, as in Bun. Programs and libraries can replace them: the Sentry Bun integration wraps `Bun.serve` in a `Proxy` and replaces `server.reload` (measured in `@sentry/bun`). Every spelling (`Bun.serve`, `import { serve } from "bun"`, aliases, destructuring) reaches the same function. A direct call compiles to the native operation only when whole-program analysis shows that nothing writes the property (inferred).

### Node islands

Node islands load libnode and run Node semantics, and the `Bun` global does not exist inside them (measured: `packages/libnode-common/bridge/scr_node_bridge.cc`). Under the Bun profile, automatic islands are off, and explicit `@scriptc/node` calls and forced island configuration are refused. Code outside the native subset gets a diagnostic instead of moving to Node. Native dynamic value operations remain available; they are compiled code, not an engine.

## Architecture

### Reuse of Bun's native code

The deciding question for each part of Bun is how tightly it is bound to JavaScriptCore (JSC), Bun's engine. Sizes and couplings below were measured at Bun `origin/main` (`3bf1a06469`, 2026-11-02). The server and SQL couplings were rechecked at `bun-v1.4.4`: the server holds JSC globals and a VM (`src/runtime/server/mod.rs:227-247`), and the live SQL crate depends on `bun_jsc` while the protocol crate does not (`src/sql_jsc/Cargo.toml:12-32`, `src/sql/Cargo.toml:12-23`).

| Bun component | JSC coupling | Verdict |
| --- | --- | --- |
| uSockets and uWebSockets forks (`packages/bun-usockets`, `packages/bun-uws`) | Light, but they call Bun internals and JSC heap hooks | Not needed: scriptc already has native sockets, an HTTP/1.1 parser, HTTP/2 framing with HPACK, and TLS |
| `Bun.serve` (`src/runtime/server/`, about 23,000 lines of Rust) | Heavy | Reimplement over scriptc's HTTP server and web objects |
| Postgres client (`src/sql_jsc/postgres/`, about 6,000 lines) | Heavy; the protocol framing crate (`src/sql/postgres/`, about 2,000 lines) is not | Reimplement the adapter; see [Database clients](#database-clients) |
| `Bun.file` and `Bun.write` (`src/runtime/webcore/Blob.rs` and `blob/`) | Heavy | Reimplement over scriptc's filesystem and Blob code |
| Temporal (WebKit's C++ implementation) | Heavy | Use `temporal_capi` instead |
| Event loop and BoringSSL integration | Heavy and light | Keep scriptc's scheduler and mbedTLS |

Bun's MIT-licensed pure algorithms, such as its semver, ANSI, and shell-parsing code, remain candidates to port where scriptc has nothing equivalent (inferred).

scriptc's native foundations already cover the transport layer: an epoll, kqueue, and WSAPoll scheduler with native promises (`packages/runtime/src/scr_async.c`, `scr_loop_epoll.c`), a hand-written HTTP/1.1 server and client (`scr_http.c`), HTTP/2 framing with HPACK (`scr_http2.c`), fetch with native Request, Response, Headers and body streams (`scr_fetch.c`, `scr_webstreams.c`), mbedTLS 3.6.7 (`scr_tls.c`), zlib, Brotli and Zstandard, and ICU 78.3 for a restricted Intl slice (measured).

### Third-party libraries

Each family uses scriptc's own code first. A family adds a library only when the algorithm is large, a maintained C ABI exists, and the license allows static linking into an Apache-2.0 runtime. Candidates by family (inferred; each needs approval when its slice starts):

| Family | Candidate | License |
| --- | --- | --- |
| Temporal | `temporal_capi` 0.2.6 (Rust, generated C API, compiled time-zone data) | MIT or Apache-2.0 |
| `bun:sqlite`, SQLite in `Bun.SQL` | SQLite amalgamation | Public domain |
| PostgreSQL in `Bun.SQL` | libpq with OpenSSL, or a C client; see below | PostgreSQL License, Apache-2.0 |
| HTMLRewriter | lol-html C API | BSD-3-Clause |
| TOML, YAML, Markdown | tomlc17, libyaml, md4c | MIT |
| `Bun.password` | Argon2 reference, crypt_blowfish | CC0 or Apache-2.0, public domain |
| `Bun.Archive` | libarchive | BSD-2-Clause |

A Rust library such as `temporal_capi` needs its own packaging work. The published crate declares no `staticlib` target and uses `no_std` with `alloc` (measured), so a small wrapper crate builds the static archive and sets the panic and allocator policy. The archive ships inside the platform runtime pack behind an owning `scr_<unit>.c` wrapper. ICU is the precedent for a non-C archive in a pack, and it ships for Linux x64 GNU only today (measured: `packages/runtime/vendor/README.md:112-120`). Runtime-pack builds then need a Rust toolchain; user builds do not.

### Database clients

`Bun.SQL` behavior lives in an adapter that scriptc owns in every option: pooling, reservations, transactions, COPY, cancellation, result metadata, type decoding, and Bun's error codes. The open question is who owns the PostgreSQL wire connection and its TLS.

- **libpq with OpenSSL.** A maintained client with an asynchronous API that can join scriptc's readiness loop. It supports TLS only through OpenSSL, which adds a second TLS stack to executables that use SQL. Its footprint and cross-target build cost are unknown.
- **A C client over scriptc's sockets and mbedTLS.** One TLS stack and full control, at the cost of owning SCRAM, TLS negotiation, framing, codecs, and cancellation.

The choice is made at the start of the PostgreSQL slice with a measured spike: executable size, cross-target build, and parity on the consumer-relevant behaviors above. libpq is the default unless the spike shows a concrete reason against it. MySQL gets its own decision in its slice, because common MySQL client libraries are GPL or LGPL.

### Where Bun code lives

Bun lowering lives in its own files (`lower-bun-*.ts`) and runtime units (`scr_bun_*.c`, `scr_bun_*.h`), with narrow hooks into shared code. Upstream scriptc moves fast: 7,549 commits since 2026-07-22 (measured), so keeping Bun code in separate files keeps rebases onto `upstream/main` tractable.

Each Bun API follows scriptc's existing path for a runtime API: declarations, one semantic lowering under every spelling, `IrLibFn` signatures, LLVM symbol mappings, the C unit, runtime-feature predicates in the pack matrix, corpus programs, and ledger evidence. `bun` must not be added to the Node builtin list as is, because its canonicalizer would also accept `node:bun` (measured: `packages/compiler/src/frontend/builtin-modules.ts:76-108`).

## Compatibility ledger

The Bun ledger mirrors the Node one under `internal/compatibility` and pins Bun 1.4.4. Bun publishes no machine-readable API document like Node's, so the published `bun-types` declarations at the tag seed the denominator. Declarations miss public behavior, so the ledger adds rows from:

- Bun's pinned docs and public export tables, for exports the declarations omit;
- JSC's Temporal surface, which `bun-types` does not declare;
- loader contracts, such as text, TOML, and HTML imports;
- Bun's behavior on shared Node APIs, where it differs from Node 24, as separate rows with their own evidence.

An export found only in source stays `unreviewed` until docs or tests establish it. Rows use the existing statuses (`supported`, `partial`, `refused`, `not-implemented`, `by-design`, `unreviewed`, `not-applicable`) and record native and wasm32-wasi separately. The inventory groups the API into 56 families (inferred grouping).

The policy is set per operation. `by-design` covers operations that evaluate new source text at run time or expose the engine:

- realms and source evaluation, such as `ShadowRealm` and evaluating newly supplied modules;
- `Bun.plugin` and hot module reload when a callback returns source text at run time;
- `Bun.build` when the running program bundles and then executes new source;
- `bun:jsc` and other JSC heap, JIT, or garbage-collector contracts;
- `cc` in `bun:ffi`, which compiles C at run time;
- browser automation, which needs a browser engine.

Operations that only transform data stay in scope even when they sound like compiler features. `Bun.Transpiler.transform` takes source text and returns source text without executing it (measured: `packages/bun-types/bun.d.ts:3086-3100`), so a native transformer can implement it. It is `not-implemented` with a low priority, not `by-design`. Build-time forms also stay in scope where they fit ahead-of-time compilation: static loaders, feature flags, macros expanded at build time, and prebuilt HTML. Compiling WebAssembly supplied at run time is decided when that family is reached (unknown whether scriptc's runtime can host it).

WebAssembly here means WASI Preview 1, and the wasm runtime pack omits sockets, HTTP, fetch, child processes, and TLS (measured: `packages/runtime-wasm32-wasi/scripts/build.mjs:9-45`). Network and process families are native only until that changes. Data, hashing, parsing, and in-memory families can serve both targets.

## Bun differential lane

- **Location.** Bun programs live in `tests/corpus-bun/`, as flat files or `<name>/main.ts` directories, named like corpus programs. The runtime follows from the root. Both corpus runners hard-code `tests/corpus` today (measured: `tests/harness/differential.test.ts:31-50`, `llvm-differential.test.ts:24-37`), so they learn a second root rather than a third test file.
- **Oracle.** The reference is `bun run --no-env-file <entry>`, run live with closed stdin and the same environment as the binary. Packaging behavior of `bun build --compile` executables (argv slots, virtual paths, `.env` loading) gets its own contract later.
- **Working directory and env files.** Both processes run in a per-case working directory that holds no env files. `--no-env-file` keeps the oracle from loading the repository's own env files. Once the binary implements Bun's automatic `.env` loading, cases that test it carry fixture env files with dummy values in their own directory, and the oracle runs without `--no-env-file` for those cases.
- **Comparison.** The contract matches the existing corpus: stdout and exit code always, stderr when the expected exit code is 0 (measured: `differential.test.ts:471-496`). Once Bun fatal output is implemented, the lane can compare stderr on nonzero exits too.
- **Pin.** Bun 1.4.4 is pinned once (`ARG BUN_VERSION` in `Dockerfile.sandbox`, read by `scripts/sandbox-bootstrap.sh` and CI). The harness fails with a clear message when `bun --version` differs.
- **Types.** scriptc forces `types: []` and loads `@types/node` explicitly (measured: `packages/compiler/src/frontend/program.ts:362-367,973-990`). Under the Bun profile it loads the project's `bun-types` the same way. The corpus gets `bun-types@1.4.4` as a root dev dependency. Nobody has yet verified that `bun-types` coexists with scriptc's own ambient declarations (unknown). The first slice proves it.
- **Fixture checks.** Bun entries get namespaced cost keys under `tests/harness/corpus-costs/` and join `pnpm test:ts7 --baselines-only` discovery.
- **Services.** The harness starts throwaway services itself, only for programs that declare them, and owns their readiness, timeouts, and cleanup. The runner executes the oracle and the binary concurrently (measured: `differential.test.ts:471`), so each execution gets its own fresh state: a separate database created from a template, and a separate Redis server or database index. A retry resets state too. PostgreSQL starts with a Unix socket; a TLS-capable fixture lands with the TLS behavior, and MySQL with its family. This works the same on a workstation and in a Sandbox, where containers may be unavailable (inferred).
- **Servers.** Programs that run a server and a client in one process bind port 0 and print no port numbers, as existing corpus programs do (measured: `tests/corpus/2954-http-outgoing-headers.ts`). Each child process gets an explicit timeout.

## Work order

The order follows dependencies first, then how widely Bun programs use each family. Usage ranks are inferred from Bun's docs and guides; no usage telemetry exists. Adjacent ranks are weak judgments, so a consumer's needs may reorder families inside a milestone. A useful server path comes before every error-reporting detail is finished.

| Milestone | Families | Size (inferred lines) |
| --- | --- | --- |
| M0 Foundation | Explicit `--runtime`; Bun lane and pin; `bun-types` loading; `Bun` global and `bun` module recognition; `Bun.serve` hello world; then automatic detection, `bun` exports-condition resolution, and profile identity in caches and pack selection | 3k to 8k |
| M1 Shared surface | Console formatting, JSC error messages, stacks and fatal output, process identity, `.env` loading, global presence, module rules, `import.meta`, fetch and web-class defaults, shared `node:` differences | 8k to 34k |
| M2 Core I/O | `Bun.env`/`argv`/`main`/`version`; `Bun.file`; `Bun.write`; streams and direct streams; web-class extensions; cookies; fetch options; full HTTP/1 `Bun.serve` (routes, static responses, errors, `requestIP`, body limits); `Bun.spawn`; module metadata and static loaders | 28k to 86k |
| M3 Data and services | `Bun.CryptoHasher`, `Bun.hash`, `Bun.password`, UUID v5/v7 and CSRF; `bun:sqlite`; `Bun.SQL` (PostgreSQL, then MySQL and SQLite); `Bun.RedisClient`; XML parsing and request signing; `Bun.S3Client`; WebSockets | 20k to 65k |
| M4 Time | Temporal through `temporal_capi`, including `Date.prototype.toTemporalInstant`, IANA time zones, and `toLocaleString` with Intl options; `Bun.cron` | 10k to 28k |
| M5 Breadth | HTTP/2 and HTTP/3 for `Bun.serve` and fetch, shell (`Bun.$`), TOML/YAML/JSON5/Markdown, glob, filesystem router, archive, HTMLRewriter, compression extras, TCP/UDP/DNS, workers, `bun:test`, terminal, secrets, images, FFI ABI calls, `Bun.Transpiler`, inspection and color utilities | 70k to 225k |

A bounded Temporal slice can move ahead of M4 when a consumer needs it at module load or for SQL date normalization. HTTP/2 builds on scriptc's existing framing; HTTP/3 needs QUIC and is a separate architectural decision.

Size classes come from the API inventory: S under 500 lines, M 500 to 2,000, L 2,000 to 8,000, XL above 8,000, counting runtime and lowering and excluding tests and vendored code. The range is speculative implementation volume, not a delivery estimate: roughly 140k to 450k lines in total, and 40k to 130k for M0 to M2, the part every Bun server needs (inferred). For scale, scriptc today has about 290k lines of C runtime and 565k lines of compiler TypeScript (measured with `wc -l`).

### First slice

The first slice proves the compiler path from declarations to a linked executable, with the smallest program:

```ts
const server = Bun.serve({ port: 0, fetch: () => new Response("hello from Bun.serve") });
const response = await fetch(server.url);
console.log(response.status, await response.text());
server.stop();
```

It lands with these parts:

- `--runtime bun` and the compiler API option, with the printed reason;
- the `tests/corpus-bun/` root, the Bun oracle, and the Bun pin;
- `bun-types` loading;
- recognition of `Bun.serve` and `import { serve } from "bun"`;
- a runtime unit `scr_bun_serve.c` that adapts scriptc's HTTP server to Bun's handler contract: `fetch(request)` returns a `Response` or a promise of one, unlike Node's `(req, res)` listener (measured: `lower-server.ts:178-181`);
- the server object's `url`, `port`, and `stop()`.

Its corpus programs cover a synchronous handler, an async handler that suspends before it responds, the `bun` module spelling, reading the request method, URL, and body in the handler, and `typeof Bun` under each profile. The existing corpus keeps proving `typeof Bun === "undefined"` for Node builds.

The hello world proves the path, not that a real Bun server compiles. After M0, a bounded server slice exercises what real servers depend on: suspended handlers, body ownership and streaming, a replaced `Bun.serve` property, and graceful shutdown.

## Risks

- **Language coverage dominates real programs.** Bun APIs are necessary but not sufficient. A coverage run on one TanStack Start and Effect 4 server found 90 blocker groups at 271 sites. The largest groups are Sentry and OpenTelemetry packages (108 sites), Temporal (35), and Effect generic function values. A standalone Effect 4 probe compiled 99% of its statements statically (measured from the coverage run's raw output). These gaps are general compiler work shared with Node programs.
- **Library parity.** `temporal_capi` and Bun's JSC Temporal both target the specification but can differ in edge cases and in error text (unknown until the lane runs). Error messages need a mapping layer either way.
- **Bun's Node layer moves.** Bun 1.4.4 reports Node `v26.3.0`, and scriptc implements Node 24. Under the Bun profile, `node:` modules follow Bun. The lane shows each difference, and each is fixed when it appears.
- **Upstream rebases.** Lowering files change daily upstream. Separate Bun files and narrow hooks limit conflicts. Each slice starts from a fresh rebase.
- **Unmeasured costs.** Detection and rebuild cost, executable footprint, and performance under the Bun profile are unknown until M0 lands.
- **Validation cost.** The full gate needs Vercel Sandbox credentials or the slower local lanes.

## Open decisions

1. Approve the approach: reimplementation over scriptc's runtime, standalone libraries per family, and no linking of Bun's runtime.
2. Approve `bun-types@1.4.4` as a root dev dependency (MIT, published by Oven, Bun's maintainer). M0 needs it.
3. Approve the M0 order: explicit `--runtime bun` in the first slice, automatic detection in the next one.
4. Order after M2: let a consumer's needs reorder M3 and M4 (recommended), or follow the inferred usage ranks strictly.
5. Under the Bun profile, refuse Node islands, both automatic and explicit (recommended).
6. Approve the `by-design` policy above.
