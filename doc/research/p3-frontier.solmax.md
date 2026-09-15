---
type: Research
title: "jcona p3 frontier: preview3-shim, synchronous guests, JSPI, and fork decision F3"
description: Evidence for whether zena's first async host driver should target jco/JSPI before the native WASI Preview 3 callback ABI and wasmtime-p3.
resource: /doc/research/p3-frontier.solmax.md
tags: [zena, jco, jspi, wasi-preview3, component-model, async, browser]
status: draft
generated: { by: agent:openai/gpt-5.6-sol-max, at: 2026-09-15T21:16:29Z }
verified: { by: agent:openai/gpt-5.6-sol-max, at: 2026-09-15T21:16:29Z }
stale_after: 2026-12-15
sources:
  - id: jco
    resource: https://github.com/bytecodealliance/jco/tree/c03204df1c814253c5e88ae54ef6dbd80e961d0d
    title: bytecodealliance/jco at c03204df (2026-09-12)
  - id: component-model
    resource: https://github.com/WebAssembly/component-model/tree/c7176a512c0bbe4654849f4ba221c1a71c7cf514
    title: WebAssembly Component Model concurrency and Canonical ABI explainers
  - id: wasm-tools
    resource: https://github.com/bytecodealliance/wasm-tools/tree/77ea5b6f3f76de3178e87adbfe6cc4dee3a3c585
    title: wasm-tools 1.245.1 source and wit-component async name mangling
  - id: wasi-030
    resource: https://github.com/WebAssembly/WASI/tree/3ee2a590c766594ae44a54730fc74fc27da5c609
    title: WASI 0.3.0 WIT
  - id: zena-fork
    resource: file:///home/rektide/src/zena-jco-fork
    title: zena fork at 048e345c with pre-rec flat ABI and @exportName patches
---

# jcona p3 frontier

## Decision

**F3 is a bounded go: sequence jco/JSPI as zena's first async host driver; do
not make wasmtime-p3 or the full p3 callback ABI a prerequisite.**

The decisive experiment used an actual zena-produced WasmGC core module. A GC
array reference remained live in a core local while the guest made an ordinary,
straight-line call to a Promise-returning host import. The component WIT marked
the import and export `async`, but `wasm-tools component new` used synchronous
`canon lower` and `canon lift`. Stock jco 1.33.0 suspended and resumed it through
JSPI and returned `41` in both **Node 26.6.0** and **Chrome 150 without browser
flags**. This is exactly the cheap first driver contemplated by zena's plan of
record.

The go is deliberately narrower than “WASI p3 is browser-ready”:

- jco-generated async output has a **hard JSPI dependency**, not a fallback.
- Desktop Chrome has JSPI; Node 26 has it unflagged. Firefox 152 does not (the
  current compatibility target is Firefox 153), and Safari has none.
- `preview3-shim` is useful on Node, but its browser build is currently a
  skeleton with only random operational.
- jco's p3 machinery is moving quickly, has a known stackful conformance gap,
  and `jco run` currently fails to expose `preview3-shim` in its temporary
  runtime directory.

Therefore the first slice should be **zena async syntax/typing + linear JSPI
lowering + custom Promise host imports**, while retaining the proven p2 shim for
ordinary WASI. Native p3 callback lowering and wasmtime-p3 remain the second
portability/conformance driver, not the first implementation dependency.

## Scope and baselines

Primary source checkout and experiment versions:

| Item | Version / revision |
| --- | --- |
| jco source | `c03204df1c814253c5e88ae54ef6dbd80e961d0d` (2026-09-12) |
| installed jco | `@bytecodealliance/jco@1.33.0` / `jco-transpile@0.13.0` |
| installed preview3-shim | `0.6.0`, transitively under jco-transpile |
| wasm-tools | `1.245.1` |
| zena fork | `048e345ccdc4bce0d760fab4f23bb397731ad7c2` |
| Node | `v26.6.0` |
| browsers | Chrome `150.0.7871.46`; Firefox `152.0.4` |

The Component Model makes two independent choices that must not be conflated:

1. A WIT function can have the **`async` effect** (“may block”).
2. Core Wasm can call or implement that function with the **sync ABI** or the
   **async ABI** (stackless callback or stackful).

The spec explicitly says the async ABI can coexist with the p2 sync ABI and
that all sync/async caller/callee pairings compose
([`Concurrency.md:66-84`](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md#L66-L84)).
More importantly for zena, an `async` WIT export may be implemented with the
sync ABI and may synchronously call an `async` import; this is intended to let
traditional straight-line programs target p3 without a source-level rewrite
([`Concurrency.md:87-119`](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md#L87-L119)).

### Correction to prior local research

[`jco-host.glm53max.md`](./jco-host.glm53max.md) generalized a conditional
wrapper and `SuspendError` feature check into “JSPI always has fallbacks” and
inferred that Chrome was still flag-gated. Both conclusions are too broad:

- The conditional wrapper applies to ordinary non-async functions that may
  have been manually selected with `--async-imports`. Native p3 async imports
  and canonical operations emit unconditional `new WebAssembly.Suspending(...)`.
- `SuspendError` detection only normalizes illegal blocking during component
  initialization; it does not emulate suspension.
- jco's browser test still supplies old experimental flags, but Chrome shipped
  JSPI in 137 and Chrome 150 works here without either flag.

The corrected details and source sites are in [JSPI is required, not
polyfilled](#jspi-is-required-not-polyfilled).

## 1. `preview3-shim` reality

### Node: broad but explicitly experimental

The package README's entire product claim is “Experimental WASI Preview 3
implementations for Node.js”
([`preview3-shim/README.md:1-3`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/README.md#L1-L3)).
Its Node entry point exports `cli`, `clocks`, `filesystem`, `future`, `http`,
`random`, `sockets`, and `stream`
([`src/nodejs/index.ts:1-8`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/index.ts#L1-L8)).

Against released WASI 0.3.0, the runtime-facing surface is:

| WASI package | Implemented Node interfaces | Evidence / qualification |
| --- | --- | --- |
| `wasi:cli` | `environment`, `exit`, `stdin`, `stdout`, `stderr`, terminal resource/accessor interfaces | Environment and terminal pieces adapt preview2-shim; stdin/out/err use streams, futures, and resource workers ([`cli.ts:20-43,68-139`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/cli.ts#L20-L43)). `run` is normally a guest export, not a host import. |
| `wasi:clocks` | `system-clock`, `monotonic-clock` | p2 clocks are adapted; `wait-until`/`wait-for` return Promises ([`clocks.ts:1-24,29-98`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/clocks.ts#L1-L98)). The unstable 0.3 `timezone` interface is not exported. |
| `wasi:filesystem` | `preopens`, `types` / `descriptor` | Real `node:fs/promises`, worker-backed stream operations, and configurable preopens ([`descriptor.ts:1-23,102-149`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/filesystem/descriptor.ts#L1-L149), [`:1066-1095`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/filesystem/descriptor.ts#L1066-L1095)). |
| `wasi:http` | `types`, `client`, `handler` | Worker-backed client plus `HttpServer`; the host handler must be configured ([`http/client.ts:22-125`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/http/client.ts#L22-L125), [`http.ts:12-34`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/http.ts#L12-L34), [`server.ts:24-64`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/http/server.ts#L24-L64)). |
| `wasi:random` | `random`, `insecure`, `insecure-seed` | Adapted directly from preview2-shim ([`random.ts:1-14`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/random.ts#L1-L14)). |
| `wasi:sockets` | `types` (`TcpSocket`, `UdpSocket`), `ip-name-lookup` | Node TCP/UDP/DNS implementations exposed by the namespace ([`sockets.ts:1-14`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/nodejs/sockets.ts#L1-L14)). |

There is no p3 `wasi:io` package in this map: p3 streams, futures, waitables,
and error contexts are Component Model canonical built-ins. The package's
Node-only `future` and `stream` modules are host-authoring adapters between
those component values and JavaScript Promises/streams, not additional WIT
interfaces.

This is real implementation work, not merely stubs, but it is not mature in
the preview2-shim sense. There is no conformance claim in the README, the
package is `0.6.0`, and the archive's HEAD is an unreleased fix for retaining
bound TCP endpoints. jco's p3 bindgen also landed a dense sequence of async
correctness fixes immediately before this checkout. Its ported Component Model
suite selects 30 async WAST files but explicitly skips one pending stackful
async support
([`p3/ported/component-model/wast.ts:34-69`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/test/p3/ported/component-model/wast.ts#L34-L69)).

### Browser: an exported build, presently random-only

The npm package genuinely has conditional exports: Node resolves to
`dist/nodejs`, while the default/browser branch resolves to `dist/browser`
([`package.json:29-48`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/package.json#L29-L48)).
The browser index advertises `cli`, `clocks`, `filesystem`, `http`, `random`,
and `sockets`
([`src/browser/index.ts:1-6`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/index.ts#L1-L6)).

That advertised shape is mostly a compile-time skeleton:

- CLI environment, stdio, exit, run, and terminal accessors throw `Todo`
  (for example [`cli/environment.ts:1-19`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/cli/environment.ts#L1-L19) and
  [`cli/stdout.ts:1-11`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/cli/stdout.ts#L1-L11)).
- Both clocks are stubs
  ([`clocks/monotonic-clock.ts:1-26`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/clocks/monotonic-clock.ts#L1-L26)).
- Every filesystem descriptor operation and preopen lookup throws `Todo`
  ([`filesystem/types.ts:18-140`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/filesystem/types.ts#L18-L140)).
- HTTP client/handler/types and sockets/DNS are stubs
  ([`http/client.ts:1-11`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/http/client.ts#L1-L11),
  [`sockets/types.ts:12-141`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/sockets/types.ts#L12-L141)).
- The common `Todo` error literally says `TODO: not yet implemented`
  ([`common/errors.ts:1-5`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/common/errors.ts#L1-L5)).
- **Random is implemented** by delegating all three interfaces to the browser
  preview2-shim
  ([`random/random.ts:1-15`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/src/browser/random/random.ts#L1-L15)).

The package's Vitest configuration only discovers Node-loaded JavaScript tests,
and the jco browser suite says its generic cases instantiate against the
**preview2** browser shim
([`preview3-shim/test/vitest.ts:1-7`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim/test/vitest.ts#L1-L7),
[`jco-transpile/test/browser/index.ts:19-25`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/test/browser/index.ts#L19-L25)).
Empirically, the real p3 random fixture did run in Chrome when an import map
selected the browser builds; this confirms the one implemented browser slice,
not general browser parity.

### How jco chooses p2 versus p3

jco does **not** classify a whole component as p2 or p3. It builds an import
map per interface name and version:

- Unversioned `wasi:{cli,clocks,filesystem,http,io,random,sockets}/*` patterns
  first map to preview2-shim.
- Exact wildcard patterns for `0.3.0-rc-2026-03-15` and `0.3.0` then map the
  six p3 packages (everything above except `io`) to preview3-shim.
- User mappings are assigned last and override defaults.

See [`transpile.ts:246-278`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/src/transpile.ts#L246-L278),
including the two-element supported-version list at
[`transpile.ts:171`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/src/transpile.ts#L171).
This naturally supports mixed components: the tested random fixture generated
imports from preview3-shim for `wasi:random@0.3.0` and preview2-shim for its
remaining `@0.2.12` dependencies.

Two packaging caveats matter now:

1. `preview3-shim@0.6.0` is installed here only as a transitive dependency of
   `jco-transpile`. Generated files import it directly. Under pnpm's strict
   layout, a product using p3 should declare it directly; the experiment used
   a scratch symlink rather than touching the in-flight lockfile.
2. `jco run` creates a temporary `node_modules` and symlinks preview2-shim, but
   never preview3-shim
   ([`run.ts:297-340`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco/src/cmd/run.ts#L297-L340)).
   The real p3 random fixture therefore failed with
   `ERR_MODULE_NOT_FOUND: Cannot find package '@bytecodealliance/preview3-shim'`.
   Direct `jco transpile` plus resolvable dependencies works.

## 2. Synchronous guests in p3 worlds

### Yes: async WIT does not force the async core ABI

The p3 async import ABI has a distinct core signature (four flat-parameter
limit, result buffer, packed status), but the default synchronous signature is
still valid for an `async func`
([`Concurrency.md:862-928`](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md#L862-L928)).
Likewise, an async-typed export can be synchronously lifted from the same flat
core signature used in p2
([`Concurrency.md:971-1049`](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md#L971-L1049)).

This is what `wit-component` does for an ordinary core module: Standard32 name
mangling supports the sync ABI, while explicit legacy prefixes select callback
or stackful async
([`wit-parser/src/lib.rs:1179-1238`](https://github.com/bytecodealliance/wasm-tools/blob/77ea5b6f3f76de3178e87adbfe6cc4dee3a3c585/crates/wit-parser/src/lib.rs#L1179-L1238)).
The local zena experiment imported `$root::delay` and exported `run` with plain
flat signatures. After embed/new, the component contained:

```wat
(type (func async (param "value" u32) (result u32)))
(core func $delay (canon lower (func $delay))) ; no `async` option
(func $run (canon lift (core func $run)))       ; no `async` option
```

It instantiated and genuinely blocked across a delayed Promise under jco.

This does **not** mean an existing p2 WASI guest can be relabelled p3. p3's
interfaces changed. For example, p3 stdout accepts `stream<u8>` and returns a
`future<result<...>>`, rather than p2's pointer/length blocking-write call
([`wasi:cli stdio.wit:15-64`](https://github.com/WebAssembly/WASI/blob/3ee2a590c766594ae44a54730fc74fc27da5c609/proposals/cli/wit/stdio.wit#L15-L64)).
The p2-direct zena libraries therefore remain p2; only the *calling convention
for an otherwise matching async function* can stay synchronous.

### What jco does at each boundary

| Boundary | Current behavior |
| --- | --- |
| Host JS calls an async-typed, sync-lifted guest export | JS sees a Promise. jco wraps the reachable core export with `WebAssembly.promising`, even when the core function itself is entirely synchronous. |
| Sync core guest calls an async-typed host import | jco creates an async task/subtask, wraps the lower trampoline in `new WebAssembly.Suspending`, and suspends the core stack until the host Promise resolves. The containing component function must be async-typed so blocking is legal. |
| Async-lowered core guest calls an async host import | The core call receives the packed `STARTING`/`STARTED`/`RETURNED` status and optional subtask handle. It can join that handle to a waitable set and return `WAIT`; jco later invokes its callback. |
| Async ABI caller calls a sync-lifted component callee | jco can run the callee directly and report eager completion. If it may suspend transitively, jco drives it through a promising activation. A sync-lifted callee retains its exclusive lock for the whole call. |
| Host implementation returns a non-Promise | JSPI's contract passes the value through without suspending; the async wrapper still exists. |

The relevant code is unusually explicit:

- p3 `LowerImport` emits an unconditional Suspending wrapper whenever either
  the canonical lowering or the WIT function type is async
  ([`transpile_bindgen.rs:2789-2916`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/transpile_bindgen.rs#L2789-L2916)).
- A sync-lowered call to an async-lifted component callee is itself wrapped as
  Suspending because it must block until `task.return`
  ([`transpile_bindgen.rs:2736-2756`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/transpile_bindgen.rs#L2736-L2756),
  [`host.rs:760-770`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/intrinsics/p3/host.rs#L760-L770)).
- jco caches `WebAssembly.promising(callee)`, drives callback/no-callback
  callees, and races a synchronous caller only until `task.return`
  ([`host.rs:878-968`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/intrinsics/p3/host.rs#L878-L968)).

### What traps or degrades

1. **A non-async component task may not synchronously call an async-typed
   import.** This traps even if that particular call would have completed
   immediately; an async lowering is allowed because it does not itself block
   ([`CanonicalABI.md:3466-3477`](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/CanonicalABI.md#L3466-L3477)).
2. **Core/component start functions are implicitly synchronous.** Blocking
   during start traps with `cannot block a synchronous task before returning`
   ([`Concurrency.md:842-859`](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md#L842-L859)). jco translates a native
   `SuspendError` at instantiation into that message.
3. **Without JSPI, current jco async output fails before useful execution.**
   It does not downgrade to a blocking syscall, a callback polyfill, or a
   resolved Promise wrapper.
4. **Sync lifting preserves semantics, not concurrency.** The core stack and
   synchronous component-instance exclusion stay live across the suspension.
   This is excellent for the smallest driver but is not the scalable task model
   zena ultimately wants.
5. **Calling an async export without awaiting is not a trap, but the value is a
   Promise**, not the WIT result.
6. **Streams/futures are not ordinary guest references.** They are `i32`
   handles under both ABIs, but reads, writes, cancellation, ownership, and
   result-buffer lifetime require the canonical built-ins
   ([`Concurrency.md:943-968`](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md#L943-L968)).

## 3. JSPI status

### JSPI is required, not polyfilled

jco's output has two modes:

- Fully synchronous output contains no JSPI calls (jco has a regression test
  asserting this at
  [`codegen.ts:36-48`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/test/codegen.ts#L36-L48)).
- Async-selected or p3-async output directly invokes the host's
  `WebAssembly.Suspending` and `WebAssembly.promising` APIs. Async core exports
  are assigned with no feature check
  ([`transpile_bindgen.rs:434-455`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/transpile_bindgen.rs#L434-L455)).

The often-seen check:

```js
if (typeof WebAssembly.SuspendError === 'function' &&
    e instanceof WebAssembly.SuspendError) { ... }
```

only recognizes a native engine error while normalizing illegal blocking in a
start function
([`transpile_bindgen.rs:560-569,628-637`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/transpile_bindgen.rs#L560-L569)).
jco's test helper rejects a requested JSPI test when `Suspending` is absent
instead of installing a fallback
([`helpers.ts:237-246`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/test/helpers.ts#L237-L246)).

The no-JSPI simulation confirmed the failure surfaces:

```text
sync-lift: TypeError: WebAssembly.promising is not a function
sync-import: TypeError: WebAssembly.Suspending is not a constructor
```

### Engine matrix at this checkout

| Engine | Status | Evidence |
| --- | --- | --- |
| Chrome desktop | **Shipped since 137; no flag needed.** | Current MDN browser-compat data records Chrome 137, Firefox 153, and no Safari support ([`Suspending.json`](https://github.com/mdn/browser-compat-data/blob/main/webassembly/api/Suspending.json#L11-L38)). Chrome 150 exposed all three JSPI globals and ran every experiment without flags. |
| jco Chrome harness | Still passes two old flags unconditionally. | Exact args: `--enable-experimental-webassembly-jspi` and `--enable-features=WebAssemblyExperimentalJSPI` ([`browser/index.ts:60-68`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/test/browser/index.ts#L60-L68)). These are now redundant, not evidence of a current Chrome gate. |
| Node 26 | **Unflagged and functional.** | jco's LTS config only considers adding the experimental flag below Node 26 ([`vitest.lts.ts:10-14`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/test/vitest.lts.ts#L10-L14)). Node 26.6.0 exposed `Suspending`, `promising`, and `SuspendError`; a raw JSPI core-module probe returned `42`. |
| Firefox 152 | **Not enabled.** Firefox 153 is the current compatibility floor. | The local 152.0.4 page reported all three globals `undefined`, and every jco async component failed. Mozilla source keeps `javascript.options.wasm_js_promise_integration` default `false` while implementation work lands ([`StaticPrefList.yaml`](https://github.com/mozilla/gecko-dev/blob/master/modules/libpref/init/StaticPrefList.yaml#L9063-L9067)); browser-compat data records Firefox 153. |
| Safari | **No support recorded.** | Current MDN browser-compat data records `false` for Safari and Safari iOS mirrors it. |

The JSPI proposal is now standards-track rather than a V8-only experiment. Its
two core concepts are precisely this use case: mark a Promise-returning import
with `Suspending`, and mark a reachable Wasm export with `promising`; a
non-Promise import result passes through synchronously
([proposal overview](https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md#core-concepts)).

## 4. What a zena async guest needs

### Path A — first driver: sync core ABI over JSPI

For a sequential `async`/`await` v1, the core ABI can remain almost exactly the
proven `@external` + flat ABI:

1. Parse and type-check `async`/`await`, distinguish async imports, and propagate
   the effect to exported component functions. Today `async` and `await` are
   only reserved and explicitly “not yet parsed”
   ([`tokenizer.zena:203-207`](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/tokenizer.zena#L203-L207)).
2. Emit an ordinary core import and ordinary straight-line call for each await.
   For a root WIT function, the module/name can remain `$root` / `delay`; for an
   interface, use the usual versioned interface module.
3. Emit an ordinary core export and embed WIT that marks the public function
   `async`. `wit-component` then produces sync `canon lower`/`lift`; jco sees
   the async component type and inserts JSPI.
4. Require a JSPI-capable host up front and give a clear feature error before
   evaluating generated bindings.

This path preserves the whole Wasm stack, including GC locals, over an await.
It requires no callback, task-return, waitable, stream, or future machinery in
zena. Its deliberate limitations are retained stack memory, serialized access
to a non-reentrant instance, and no natural internal `spawn`/fan-out. Those are
acceptable boundaries for a first host driver if v1 is scoped to sequential
awaits.

### Path B — native p3 stackless callback ABI

There is a real hand-writable core shape. Async ABI name mangling uses:

- import `[async-lower]foo` for an async-lowered call;
- export `[async-lift]foo` for the entry function;
- export `[callback][async-lift]foo` with core signature
  `(i32, i32, i32) -> i32`;
- import `[export]$root` / `[task-return]foo` (or the corresponding exported
  interface module) to return the result;
- `$root` imports such as `[waitable-set-new]`, `[waitable-join]`,
  `[waitable-set-wait]`, `[subtask-drop]`, and the typed future/stream
  operations.

These names are defined by wit-component's ABI selection
([`wit-parser/src/lib.rs:1194-1224`](https://github.com/bytecodealliance/wasm-tools/blob/77ea5b6f3f76de3178e87adbfe6cc4dee3a3c585/crates/wit-parser/src/lib.rs#L1194-L1224)), task-return naming
([`wit-parser/src/lib.rs:1381-1411`](https://github.com/bytecodealliance/wasm-tools/blob/77ea5b6f3f76de3178e87adbfe6cc4dee3a3c585/crates/wit-parser/src/lib.rs#L1381-L1411)), and its intrinsic recognizer
([`wit-component/validation.rs:2137-2217`](https://github.com/bytecodealliance/wasm-tools/blob/77ea5b6f3f76de3178e87adbfe6cc4dee3a3c585/crates/wit-component/src/validation.rs#L2137-L2217)).
The upstream fixtures show the minimal entry/callback exports
([`async-export-with-callback/module.wat:1-8`](https://github.com/bytecodealliance/wasm-tools/blob/77ea5b6f3f76de3178e87adbfe6cc4dee3a3c585/crates/wit-component/tests/components/async-export-with-callback/module.wat#L1-L8)) and the canonical built-in imports
([`async-builtins/module.wat:1-27`](https://github.com/bytecodealliance/wasm-tools/blob/77ea5b6f3f76de3178e87adbfe6cc4dee3a3c585/crates/wit-component/tests/components/async-builtins/module.wat#L1-L27)).

The recent fork patches remove the naming/type-identity blockers:

- `@external` accepts arbitrary module and field strings, while flat numeric
  imports now receive standalone pre-rec function types
  ([`functions.ts:643-660`](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/codegen/functions.ts#L643-L660)).
- `@exportName` exists specifically so core exports can spell component-mangled
  names containing `[]:#@`
  ([`parser.ts:4356-4400`](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/parser.ts#L4356-L4400)).

The experiment therefore hand-authored two progressively stronger zena guests:

1. An eager async callback export that called `[task-return]run` and returned
   `EXIT` worked unchanged through embed/new/jco.
2. A genuinely waiting guest called `[async-lower]delay`, received packed
   `STARTED | (subtask << 4)`, joined the subtask to a waitable set, returned
   `WAIT | (set << 4)`, received the `SUBTASK/RETURNED` callback, read the result
   buffer, dropped the handles, called `task.return`, and returned `EXIT`. It
   produced `41` in Node and Chrome.

So the proven pattern stretches all the way to a hand-written p3 async guest.
What breaks is not core expressibility but maintainability and semantics. The
toy stores one task's state in globals and is unsafe for overlapping calls. A
production lowering needs:

- the G1-derived per-task CPS frame and callback dispatcher;
- task-local/context-local state instead of globals;
- result buffers kept alive through `STARTING`/`STARTED` and reclaimed after
  `RETURNED`;
- waitable-set/subtask cleanup on success, trap, and cancellation;
- generated future/stream element lowering, ownership, and cancellation;
- `task.return` generation for every result shape;
- backpressure, reentrancy, and post-return rules.

That is the native p3 driver. It should follow, not block, the much smaller
JSPI-first path.

## 5. Experiment log

All scratch source, generated components, outputs, browser harnesses, and logs
are under [`.test-agent/w7/`](/.test-agent/w7/) (gitignored). No fork files or
in-flight telemetry paths were changed.

### A. Actual zena WasmGC, sync ABI, async WIT, delayed host Promise

The zena guest imports `$root::delay`, exports `run`, allocates a GC array, and
keeps that array live across the call. Commands:

```console
node ~/src/zena-jco-fork/packages/cli/lib/cli.js build \
  .test-agent/w7/sync-guest.zena \
  -o .test-agent/w7/sync-guest-zena-core.wasm --target host --dce

wasm-tools component embed --world sync-guest \
  .test-agent/w7/sync-guest.wit \
  .test-agent/w7/sync-guest-zena-core.wasm \
  -o .test-agent/w7/sync-guest-zena-embedded.wasm
wasm-tools component new .test-agent/w7/sync-guest-zena-embedded.wasm \
  -o .test-agent/w7/sync-guest-zena-component.wasm

jco transpile .test-agent/w7/sync-guest-zena-component.wasm \
  -o .test-agent/w7/out-zena-sync-guest -I async --no-wasi-shim \
  --no-typescript --bindgen-enable-wasm-exnref
```

`-I async` is **async instantiation**, not `--async-mode jspi`. No manual JSPI
selection was passed; jco inferred it from the p3 function types. Inspection
showed a GC array type plus `array.new_fixed`/`array.get`, and the component
showed plain sync `canon lower`/`canon lift` around an async component type.

Results with host `delay(x) = await timer; x * 2`:

```text
Node 26.6.0:
{"isPromise":true,"value":41,"eventLoopAdvanced":true}

Chrome 150, no JSPI flags:
{"testCase":"zena-sync-import","ok":true,"isPromise":true,
 "value":41,"eventLoopAdvanced":true}

Firefox 152:
{"testCase":"zena-sync-import","ok":false,
 "error":"TypeError: WebAssembly.Suspending is not a constructor"}
```

### B. Actual zena, full p3 stackless callback protocol

`stackless-await.zena` uses only current `@external`, `@exportName`, flat
numeric types, and `zena:memory`. Its core import/export inventory was:

```text
import "$root"         "[async-lower]delay"
import "$root"         "[waitable-set-new]"
import "$root"         "[waitable-set-drop]"
import "$root"         "[waitable-join]"
import "$root"         "[subtask-drop]"
import "[export]$root" "[task-return]run"
export "[async-lift]run"
export "[callback][async-lift]run"
export "memory"
```

`wasm-tools component new` turned these into `canon lower ... async`, the
waitable/subtask built-ins, `canon task.return`, and `canon lift ... async
(callback ...)`. The delayed-host run returned:

```text
Node 26.6.0:                  {"isPromise":true,"value":41}
Chrome 150, no JSPI flags:    {"ok":true,"isPromise":true,"value":41,
                               "eventLoopAdvanced":true}
Firefox 152:                  TypeError: WebAssembly.Suspending is not a constructor
```

With `JCO_DEBUG=1`, jco reported packed initial status `17` (`STARTED=1`,
subtask handle `1`), waitable-set handle `2`, then callback event
`{code: SUBTASK=1, payload0: 1, payload1: RETURNED=2}` before `task.return(41)`.

### C. Real jco p3 fixture and preview3-shim mapping

Transpiling jco's `p3-random-imports.wasm` produced:

```js
import { environment, exit, stderr, stdin, stdout }
  from '@bytecodealliance/preview2-shim/cli';
import { preopens, types }
  from '@bytecodealliance/preview2-shim/filesystem';
import { error, streams }
  from '@bytecodealliance/preview2-shim/io';
import { insecure, insecureSeed, random }
  from '@bytecodealliance/preview3-shim/random';
```

With the transitive p3 package made resolvable in scratch, Node's
`await mod.run.run()` completed. An import map selecting both browser builds
also completed in unflagged Chrome 150, proving the browser random slice. In
contrast:

```console
$ jco run p3-random-imports.wasm
Error [ERR_MODULE_NOT_FOUND]: Cannot find package
'@bytecodealliance/preview3-shim' imported from /tmp/.../p3-random-imports.js
```

### D. Direct JSPI engine probe and no-JSPI simulation

```text
Node 26.6.0:  Suspending=function promising=function SuspendError=function
raw JSPI call: 42

Chrome 150:   all three functions, no flags
Firefox 152:  all three undefined
```

Deleting those globals before instantiating the two minimal generated modules
gave the expected hard failures (`promising is not a function`, `Suspending is
not a constructor`).

## 6. F3 recommendation and sequencing

### Go criteria met

- **Core feasibility:** proven with zena-generated WasmGC, including a GC
  reference live across real suspension.
- **Host feasibility:** proven in the target JavaScript environments: Node 26
  and desktop Chrome without flags.
- **Component compatibility:** both sync canonical ABI and true p3 callback ABI
  survive `embed -> component new -> jco transpile` today.
- **Fork leverage:** the recent pre-rec and `@exportName` patches already expose
  every low-level naming/type seam needed.
- **Architectural fit:** JSPI is expressly designed to run synchronous-looking
  Wasm over Promise APIs, while zena's G1 split pass can later supply the native
  callback implementation.

### Recommended slices

1. **Define “async v1” narrowly:** sequential await of host imports; no spawn,
   racing, detached tasks, stream combinators, or cancellation guarantee.
2. **Add a jco/JSPI codegen mode:** async source functions become normal linear
   core functions; awaited host calls remain normal calls. Emit/associate WIT
   with `async` effects so blocking is legal, and package via the existing
   sync canonical ABI.
3. **Feature-gate at load time:** require `WebAssembly.Suspending` and
   `WebAssembly.promising`; support Node 26+ and desktop Chrome 137+ initially.
   Do not silently run async components as sync.
4. **Keep WASI p2 for the first slice:** use custom mapped Promise host imports
   for genuinely async operations. Do not couple language async to the mostly
   stubbed preview3 browser shim.
5. **Use the hand-written callback guest as the conformance seed:** turn its
   entry/status/callback sequence into tests around the G1 frame machinery.
6. **Add native p3 lowering next:** generate async-lower calls, callbacks,
   task-return, waitables, per-task state, streams/futures, and cancellation;
   then make wasmtime-p3 the independent conformance host.
7. **Only then call p3 a browser host surface:** after the required browser
   shim interfaces exist (or jcona supplies explicit replacements) and the
   engine support floor is accepted.

### Why wasmtime-p3 is not unavoidable first

Wasmtime is essential later because it tests the native Component Model ABI
without JSPI and forces correct task/cancellation/resource semantics. It is not
needed to answer the first-driver question: jco already runs the intended
straight-line lowering, and the native callback shape is independently
expressible. Requiring wasmtime first would force the largest runtime/codegen
slice before zena can validate its source-level async design.

## Open questions

1. Is async v1 explicitly limited to sequential awaits, or must it include
   `spawn`/`all`/`race`? The latter materially changes the first driver's shape
   and pulls the G1/CPS scheduler forward.
2. Is a Chrome-first browser floor acceptable until Firefox 153 reaches the
   supported channel, and is Safari a required target?
3. Should jcona pin a custom WIT package for early Promise host imports, or add
   an `@asyncExternal`-style compiler marker before WIT bindgen exists?
4. How should zena detect that an ordinary core call is only legal inside an
   async-typed component task, especially through transitive helper calls?
5. What stack/heap limits and reentrancy policy are acceptable while JSPI keeps
   straight-line Wasm stacks suspended?
6. Which p3 browser capability should be implemented first locally: clocks,
   stdout/stderr, or HTTP client? The upstream package currently offers no
   operational choice beyond random.
7. Upstream jco issues worth filing: symlink preview3-shim in `jco run`; remove
   or explain obsolete Chrome flags; expose a clean JSPI capability error;
   document p3 browser stubs; close the skipped stackful WAST case.
8. jco maps only released `0.3.0` and one RC. What version policy should jcona
   use when future WASI 0.3.x interfaces appear?

## Cross-references

- [`work-outline.glm53max.md`](./work-outline.glm53max.md) defines W7/F3 and the
  p2-direct posture this recommendation preserves.
- [`jco-host.glm53max.md`](./jco-host.glm53max.md) proves WasmGC/EH hosting and
  the broader Node/browser transpile pipeline; this document corrects its JSPI
  fallback and Chrome-flag conclusions.
- [`zena-targets.glm53max.md`](./zena-targets.glm53max.md) explains why p2
  remains the initial general WASI target even though the first *language async
  driver* can be JSPI-first.
- [`jco-telemetry.glm53flash.md`](./jco-telemetry.glm53flash.md) identifies the
  task IDs, component state, and debug hooks visible in the p3 scheduler; the
  `JCO_DEBUG=1` callback experiment exercised those exact paths.
- [`getting-started.glm53max.md`](./getting-started.glm53max.md) records the
  original synchronous component evidence. Its “JSPI paths are feature
  detected, not required” statement remains true for that synchronous fixture,
  not for async/p3 output.

## References

- [Component Model concurrency explainer](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md)
- [Component Model Canonical ABI](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/CanonicalABI.md)
- [WASI 0.3.0 WIT](https://github.com/WebAssembly/WASI/tree/3ee2a590c766594ae44a54730fc74fc27da5c609/proposals)
- [JSPI proposal overview](https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md)
- [MDN browser compatibility: `WebAssembly.Suspending`](https://github.com/mdn/browser-compat-data/blob/main/webassembly/api/Suspending.json)
- [jco preview3-shim](https://github.com/bytecodealliance/jco/tree/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/preview3-shim)
- [jco p3 transpile tests](https://github.com/bytecodealliance/jco/tree/c03204df1c814253c5e88ae54ef6dbd80e961d0d/packages/jco-transpile/test/p3)
