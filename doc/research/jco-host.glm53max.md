---
type: Research
title: "jco as the host for zena: transpile pipeline, WASI shim surface, and WasmGC guest viability"
description: How jco (recent main, c03204df) transpiles and hosts WebAssembly components in Node and browsers, with an empirical verdict on GC/typed-reference/exception-handling guest core modules — the crux for running zena-compiled programs as components.
resource: file:///home/rektide/src/zena-jco/doc/research/jco-host.glm53max.md
tags: [zena, jco, wasm-gc, component-model, wasi, host-bindings]
status: draft
generated:
  by: agent:glm-5.3max (zai-coding-plan/glm-5.3)
  at: 2026-09-14T21:30:00Z
sources:
  - id: jco-archive
    resource: file:///home/rektide/archive/bytecodealliance/jco
    title: bytecodealliance/jco checkout @ c03204df (2026-09-12), plus empirical runs against @bytecodealliance/jco 1.33.0 installed in this repo
  - id: wasm-tools-archive
    resource: file:///home/rektide/archive/bytecodealliance/wasm-tools
    title: bytecodealliance/wasm-tools checkout (wit-component sources)
stale_after: 2027-03-14
---

# jco as the host for zena — research findings

Zená compiles to core Wasm **GC** modules (typed function references, GC structs/arrays, GC
exceptions). Today it runs via a bespoke Node JS-host (`--target host`) or wasmtime
(`--target wasi`, core module importing `wasi_snapshot_preview1`). This document investigates
the third option: wrap the core module as a **component** and let **jco** be the host
(`jco transpile` output + WASI shims) in both Node.js and browsers.

Primary source: the local jco checkout at [`/home/rektide/archive/bytecodealliance/jco`](/home/rektide/archive/bytecodealliance/jco)
(upstream main @ `c03204df`, 2026-09-12). Empirical runs used `@bytecodealliance/jco@1.33.0`
as installed in this repo's `node_modules`. A hand-written GC guest (see
[Verification log](#verification-log)) was pushed through the full pipeline.

**Headline verdict: the GC-guest-under-jco plan works.** A guest core module using GC
structs/arrays, typed function references, and `call_ref` transpiles and runs under jco with
**no special flags**, in Node 26, headless Chrome, and headless Firefox. The one caveat that
bites zena specifically: guests using **exception handling** (`try_table`/`throw`, i.e. the
new exnref proposal) fail to transpile *by default* and need `--bindgen-enable-wasm-exnref`.
Separately, `jco opt`/`--optimize` (binaryen) fails on GC guests unless explicit
`--enable-gc --enable-exception-handling …` flags are passed.

---

## 1. Transpile pipeline & guest assumptions

### What `jco transpile` emits

Documented in [`docs/src/transpiling.md`](/home/rektide/archive/bytecodealliance/jco/docs/src/transpiling.md)
(lines 15–63): `jco transpile component.wasm -o out-dir` emits, per component:

| File | Purpose |
| --- | --- |
| `<name>.js` | ESM bindings module (or an `instantiate()` function with `--instantiation async\|sync`, lines 254–299) |
| `<name>.d.ts` | TypeScript declarations (optional, `--no-typescript`) |
| `interfaces/*.d.ts` | Per-interface type declarations for component imports |
| `<name>.core*.wasm` | The component's core modules, emitted **verbatim** (see below) |

Core modules below the base64 cutoff are inlined into the JS as base64 (`--base64-cutoff`,
transpiling.md line 47); larger ones are emitted as `.core*.wasm` files loaded via
`fetchCompile(new URL('./x.core.wasm', import.meta.url))` — see
[`crates/js-component-bindgen/src/transpile_bindgen.rs:459-501`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/transpile_bindgen.rs).
In my GC test (tiny module) everything was inlined; in the `hello_stdout` fixture the core
modules were emitted as files. The generated file starts with the `"use components";`
directive (transpile_bindgen.rs:504).

Notable options: `--instantiation sync|async`, `--tla-compat`, `--js` (emit asm.js instead of
core Wasm!), `--map` (incl. wildcard/`#` sub-object mappings), `--valid-lifting-optimization`,
`--multi-memory`, `--bindgen-enable-wasm-exnref`, `--async-mode jspi` + `--async-imports/
--async-exports` (experimental), `--import-bindings js|optimized|hybrid|direct-optimized`
([`packages/jco/src/jco.ts:104-176`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/jco.ts);
optimized-bindings doc at [`docs/src/advanced/optimized-host-bindings.md`](/home/rektide/archive/bytecodealliance/jco/docs/src/advanced/optimized-host-bindings.md)).

### What the generated JS assumes at instantiation

- Core module instantiation is plain: `const instantiateCore = WebAssembly.instantiate`
  (sync mode: `(module, importObject) => new WebAssembly.Instance(...)`) —
  [`crates/js-component-bindgen/src/intrinsics/mod.rs:453`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/intrinsics/mod.rs),
  transpile_bindgen.rs:519-527. **The guest core module bytes are handed to the JS engine
  verbatim** — jco never re-encodes them (except the multi-memory polyfill case, §8).
- Node/browser compatibility is *detected*, not configured: `fetchCompile` checks
  `typeof process !== 'undefined' && process.versions.node` and uses `node:fs/promises`
  vs `fetch` + `WebAssembly.compileStreaming` (intrinsics/mod.rs:381-401); `base64Compile`
  checks for `Buffer` (mod.rs:309-328); `FinalizationRegistry` falls back to a no-op
  (mod.rs:370-379).
- **`WebAssembly.Function` / type reflection is never used** — `rg 'WebAssembly.Function'`
  over `crates/` + `packages/` finds zero hits. The JS↔Wasm boundary only crosses
  numerics/BigInt, so no engine type-reflection requirements are imposed on the host page.
- **JSPI is used, but always with fallbacks**: `WebAssembly.Suspending(...)` wrapping is
  conditional (`_trampolineN.manuallyAsync ? new WebAssembly.Suspending(...) : call`,
  transpile_bindgen.rs:2915 et al.), `WebAssembly.promising(...)` is wrapped in try/catch
  (observed in generated output around `cabi_import_realloc`; also
  transpile_bindgen.rs:3454, 3474), and `WebAssembly.SuspendError` is feature-detected at
  instantiation error time. So a non-JSPI engine still runs sync-shaped components.
  jco's own browser tests launch Chrome **with** `--enable-experimental-webassembly-jspi`
  + `--enable-features=WebAssemblyExperimentalJSPI`
  ([`packages/jco-transpile/test/browser/index.ts:66-72`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/test/browser/index.ts)),
  i.e. JSPI is still flag-gated in Chrome at this checkout.

### Does anything break for a GC/typed-ref/EH guest?

jco's bindgen validates the component during transpile using wasmtime-environ's translator
with this feature set ([`crates/js-component-bindgen/src/lib.rs:136-159`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/lib.rs)):

```rust
let mut features = WasmFeatures::WASM3
    | WasmFeatures::WIDE_ARITHMETIC
    | WasmFeatures::COMPONENT_MODEL
    | WasmFeatures::CM_ASYNC | ... ;
if !opts.supports_wasm_exnref {
    features = features.difference(WasmFeatures::EXCEPTIONS);
}
```

`WasmFeatures::WASM3` in wasmparser (jco pins wasmparser 0.258, root
[`Cargo.toml:55`](/home/rektide/archive/bytecodealliance/jco/Cargo.toml); definition verified
in the 0.252 local registry copy, `features.rs:373-382`) is
`WASM2 ∪ GC ∪ TAIL_CALL ∪ EXTENDED_CONST ∪ FUNCTION_REFERENCES ∪ MULTI_MEMORY ∪ RELAXED_SIMD ∪ THREADS ∪ EXCEPTIONS ∪ MEMORY64`.

Therefore:

1. **GC types/instructions and typed function references: enabled by default.** Nothing in
   bindgen inspects or transforms guest GC code — the module is emitted verbatim and the
   *engine* compiles it. (Verified end-to-end, §9.)
2. **Exception handling: disabled by default** (`supports_wasm_exnref` defaults to `false` —
   [`crates/js-component-bindgen-component/src/lib.rs:74`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen-component/src/lib.rs)
   `bindgen_enable_wasm_exnref.unwrap_or(false)`; CLI flag at
   [`packages/jco/src/jco.ts:165`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/jco.ts)).
   The rationale (lib.rs:152-156): wasmtime-environ's FACT-generated adapter code wraps calls
   in exception barriers (`try_table`), which today's JS engines only run behind a flag
   (e.g. `--experimental-wasm-exnref`). jco's CLI test for the flag is skipped on Node ≤ 22
   ([`packages/jco/test/cli.js:57`](/home/rektide/archive/bytecodealliance/jco/packages/jco/test/cli.js)),
   implying Node 23+ runs exnref EH unflagged (verified on Node 26, §9).
3. **Component-model-level GC (`CM_GC` 🛸) is not enabled** (features.rs: `cm_gc` defaults
   false) — but that only governs GC types *crossing the component boundary*. zena's GC types
   are internal to the guest core module, so irrelevant unless zena wants to export
   `eqref`-typed values in WIT someday.

## 2. Guest requirements to be componentizable

Two ways to wrap an existing core module (both exposed by jco without a system `wasm-tools`):

- **WIT-first (recommended for zena):** `wasm-tools component embed --world <w> wit/ core.wasm`
  then `wasm-tools component new`. jco equivalents: `jco embed --wit <wit> --world-name <w>`
  ([`packages/jco/src/jco.ts:437-446`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/jco.ts))
  and `jco new` / `jco tool core-to-component` (jco.ts:413-434) with `--adapt
  [NAME=]adapter`, `--wasi-command` / `--wasi-reactor`.
- **Adapter path for the existing wasi_snapshot_preview1 target:** `--adapt
  wasi_snapshot_preview1=<wasi_snapshot_preview1.wasm>` composes the p1→p2 adapter
  (implemented via `wit_component::ComponentEncoder::adapter(name, binary)` in
  [`crates/wasm-tools-component/src/lib.rs:34-57`](/home/rektide/archive/bytecodealliance/jco/crates/wasm-tools-component/src/lib.rs)).

**Canonical ABI expectations on the guest core module** (from component-model conventions as
observable in jco's generated instantiation code and the embed flow):

- Export the linear **memory** (observed: `memory0 = exportsN.memory` in generated `$init`;
  for composed p1 modules the adapter's memory is reused and passed back to the guest via an
  `env.memory` import — seen in the `hello_stdout` output).
- Export **`cabi_realloc`** (guest-owned realloc used by lifted string/list results when
  needed) and optionally **`cabi_post_<export>`** post-return functions. For
  string-*importing* worlds the generated code also uses a guest-exported
  **`cabi_import_realloc`** (observed: `realloc0 = exports2.cabi_import_realloc`, then
  `realloc0Async = WebAssembly.promising(...)` with fallback).
- Export names matching the WIT world functions (kebab-case, e.g. `get-answer` for
  `get-answer: func() -> u32`).
- **Import module naming:** for a guest that targets preview2 directly, import modules are
  the *versioned interface names* — observed verbatim in generated instantiation:
  `'wasi:cli/environment@0.2.3'`, `'wasi:cli/exit@0.2.3'`, `'wasi:filesystem/types@0.2.3'`,
  `'wasi:io/streams@0.2.3'`, plus `'env'` (memory) and `'__main_module__'` in composed p1
  cases (`wasi_snapshot_preview1` for the adapter module itself). The `cm32p2|…` style
  mangling is wit-component's "Standard32" ABI naming
  (`ManglingAndAbi::Standard32` used for dummy modules, wasm-tools-component lib.rs:248);
  it appears in *adapters/bindgen internals* (the FACT shim modules import under names like
  `''` with `$imports` + numeric keys, also observed).
- wit-component validates embeddings with **`WasmFeatures::all()`**
  ([`crates/wit-component/src/validation.rs:63`](/home/rektide/archive/bytecodealliance/wasm-tools/crates/wit-component/src/validation.rs),
  `encoding.rs:3372`, `targets.rs:39` in the wasm-tools archive) — so the *embed/new* stage
  accepts GC + EH guests unconditionally; the only GC-relevant gate is at *transpile* time
  (§1) and then the engine.

## 3. WASI host surface under jco

### preview2-shim (`@bytecodealliance/preview2-shim` v0.24.1) — Node AND browser

- One package, two builds selected by `exports` conditions: `"node"` → `dist/nodejs/*`,
  default (browser) → `dist/browser/*`
  ([`packages/preview2-shim/package.json`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/package.json)
  `exports` field). Source split: `src/nodejs/`, `src/browser/`, `src/common/`, `src/io/`,
  `src/synckit/`.
- Subsystems: `cli`, `clocks`, `random`, `io`, `filesystem`, `sockets`, `http` — the
  automatic default map is documented at
  [`docs/src/transpiling.md:168-183`](/home/rektide/archive/bytecodealliance/jco/docs/src/transpiling.md)
  (`--map wasi:cli/*@0.2.0=@bytecodealliance/preview2-shim/cli#*` etc.).
- Node support is "fully tested and conformant against the Wasmtime test suite"
  ([`packages/preview2-shim/README.md`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/README.md),
  opening lines).
- Browser matrix (README, "Browser support matrix" table): stdout/stderr → console (stdin
  closed), clocks → `performance.now`/`Date.now`, random → `crypto.getRandomValues`
  (incl. >64 KiB), I/O streams + poll implemented, **filesystem adapter-backed** (no
  implicit persistent storage; opt-in `InMemoryFilesystemAdapter`; an
  `OpfsFilesystemAdapter` ships in `src/browser/opfs-filesystem.ts`), outbound HTTP →
  `fetch` (buffered upload; opt-in streaming on Chromium), incoming HTTP adapter-backed
  (opt-in in-memory client), **TCP/UDP opt-in in-memory only**, DNS requires a host adapter.
  A `WASIShim` class (`@bytecodealliance/preview2-shim/instantiation`) provides per-instance
  overrides of any namespace (README + `src/common/instantiation.ts`).
- This is *capability-based virtualization in the shim itself*; WASI-Virt is a separate
  pre-processing tool and is not invoked by jco.

### preview3-shim (`@bytecodealliance/preview3-shim` v0.6.0) — experimental, Node-focused

README: "Experimental WASI Preview 3 implementations for Node.js"
([`packages/preview3-shim/README.md`](/home/rektide/archive/bytecodealliance/jco/packages/preview3-shim/README.md)).
There *is* a browser build (`src/browser/` exports cli/clocks/filesystem/http/random/sockets
namespaces; `src/browser/index.ts`), but Node has the richer surface (`src/nodejs/` includes
`workers/`, `finalization.ts`, `future.ts`, `stream.ts` — p3 async builtins). Supported p3
WIT versions are pinned in jco-transpile:
`SUPPORTED_P3_VERSIONS = ['0.3.0-rc-2026-03-15', '0.3.0']`
([`packages/jco-transpile/src/transpile.ts:171`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/src/transpile.ts)).
p3 runtime relies on JSPI-style async with the conditional fallbacks described in §1; a
recent commit (c03204df) fixed p3-shim TCP binding retention.

### jco-std, jco-node-fs, bare-jco (adjacent packages)

- `jco-std`: Node-builtin compatibility layer (`node:fs`, `node:vm`, `node:zlib`,
  `node:worker_threads`, `node:trace_events`, …) implemented as WIT-adjacent host providers
  under `src/wasi/0.2.x/node/24.x.x/…`, consumed by **guest JS components**
  (`jco componentize`) — not something a native zena guest needs unless it wants to expose
  node:* APIs.
- `jco-node-fs` / `bare-jco`: small helpers (Node FS preopen provider; bare-runtime-flavored
  jco entry).

## 4. `jco run` / `jco serve` semantics, and the recent node:vm & "VM limits" commits

**`jco run <component.wasm> [args…]`** ([`packages/jco/src/cmd/run.ts:60-84, 283-475`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/cmd/run.ts)):

1. Transpiles the component into a temp dir (or `--jco-dir`) with `wasiShim: true`,
   `noTypescript: true` (run.ts:299-309), writing a `package.json` with `"type": "module"`.
2. Symlinks `@bytecodealliance/preview2-shim` and `jco-std` host providers (child-process,
   console, dns — deny-by-default) into the temp `node_modules` (run.ts:318-404).
3. Writes `_run.js` which imports the transpiled module and calls `mod.run.run()` — the
   `wasi:cli/run` export — then `process.exit(0/1)` (run.ts:67-82). Args/env flow through
   the preview2-shim CLI/sockets namespaces.
4. Spawns a **child Node process** (`JCO_RUN_PATH`/`JCO_RUN_ARGS` overridable) and propagates
   the exit code (run.ts:454-465).

**`jco serve`** (run.ts:86-281): wraps `wasi:http/incoming-handler` with
`preview2-shim/http`'s `HTTPServer`; `--isolate-requests instance|worker` gives
request-per-instance (sync instantiation + cached core modules) or a pre-warmed
worker-thread pool (default 50, `--isolate-worker-pool-size`).

**Sandbox flags** (run.ts:477-532): `--sandbox` gates `--sandbox-env-set/-env-inherit`,
`--sandbox-fs-preopen HOST::GUEST`, `--sandbox-net-inherit`; without net inherit the setup
calls `_denyDnsLookup(); _denyTcp(); _denyUdp();` and clears env/cwd — deny-by-default.

**Recent commits (Sept 2026) — what they actually are:** the `node:vm` / "portable VM
support and engine limits" work (8d09b85b, b4dd700d, 5665691b, fc7935c2, 344d1120) is about
`jco-std` implementing a *portable subset of Node v24's `node:vm` API inside guest JS
components* — `Script`/`compileFunction` sharing the component's globals; `createContext`,
`runInContext`, `timeout`/`breakOnSigint` etc. throw `ERR_JCO_UNSUPPORTED_NODE_API` ("There
is no VM execution watchdog; these options fail before the code runs") — see
[`docs/src/interop/nodejs-builtins/supported-modules/vm.md:68-99`](/home/rektide/archive/bytecodealliance/jco/docs/src/interop/nodejs-builtins/supported-modules/vm.md),
plus a security warning that `node:vm` is not a sandbox (vm.md:15-23). **These commits do
not change core-module execution; "engine limits" = the guest-visible node:vm API surface,
not Wasm engine limits.** They matter to zena only as precedent for how jco-std stubs
unsupported Node APIs.

## 5. Browser delivery

- **In-page import + import maps** (the canonical path): the browser test harness maps
  `@bytecodealliance/preview2-shim/*` specifiers to the shim's `dist/browser/*` builds via a
  `<script type="importmap">`, then dynamic-imports the transpiled ESM —
  [`packages/jco-transpile/test/fixtures/browser/harness.html`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/test/fixtures/browser/harness.html).
  Because transpiled WASI imports are rewritten to those bare specifiers
  (transpiling.md:168-183), the import map (or the bundler) is the only wiring needed.
- **Bundler path:** [`packages/rolldown-plugin-jco`](/home/rektide/archive/bytecodealliance/jco/packages/rolldown-plugin-jco)
  transpiles each imported component during bundling (Rolldown *and* Rollup compatible),
  emits core Wasm as bundler-managed assets, and emits shim worker artifacts for Node
  targets (README).
- **Transpile-in-browser:** jco self-hosts bindgen as a component; import
  `@bytecodealliance/jco/component` to transpile *inside* the browser
  (transpiling.md:65-76; exercised by
  [`packages/jco-transpile/test/browser/index.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/test/browser/index.ts)
  + `test/fixtures/browser/transpile.js`, which runs `$init` of the vendored
  `js-component-bindgen-component` in-page).
- **Examples:** [`examples/components/browser-p2-shims`](/home/rektide/archive/bytecodealliance/jco/examples/components/browser-p2-shims)
  documents the full flow (`jco componentize` → `jco transpile --instantiation async` →
  Puppeteer test) and notes "A web server is required because browsers do not allow the
  generated Wasm files to be loaded directly from a `file:` URL".
- **Constraint summary:** no real FS (adapters/OPFS opt-in), no raw sockets, fetch-only HTTP
  (§3); TLA needed unless `--tla-compat`; single-file delivery possible via base64 inlining
  (`--base64-cutoff`).

## 6. wasm-tools embedded in JS (no system binary)

The crate `wasm-tools-js` ([`crates/wasm-tools-component/src/lib.rs`](/home/rektide/archive/bytecodealliance/jco/crates/wasm-tools-component/src/lib.rs))
is compiled to a **component** exporting a `local:wasm-tools/tools` world, then transpiled
and vendored into `packages/jco-transpile/vendor/wasm-tools.js` (build via `cargo xtask`,
[`packages/jco-transpile/package.json:51-67`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/package.json)).
Operations (lib.rs:25-370): `parse` (WAT→wasm), `print` (wasm→WAT), **`component_new`**
(core module + named adapters → component, with `validate(true)`), `component_wit`,
`component_wit_metadata_for_world`, **`component_embed`** (WIT + core binary +
string-encoding utf8/utf16/compact-utf16 + producers metadata + feature sets + `dummy`),
`metadata_add`, `metadata_show`. The JS wrapper is
[`packages/jco-transpile/src/wasm-tools.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/src/wasm-tools.ts)
(`await $init` then call `tools.*`). **Verified empirically:** `jco embed` + `jco new`
componentized the GC guest with no system wasm-tools present.

## 7. Version / engine baselines

- **Node matrix:** CI tests Node 22.x / 24.x / latest(26.x)
  ([`.github/workflows/main.yml:114-118`](/home/rektide/archive/bytecodealliance/jco/.github/workflows/main.yml));
  release workflows declare `"node": ">=22"` (release.yml:102,443). CLI version 1.33.0
  (jco.ts:29).
- **WasmGC engines:** V8 (Chrome 119+, Node 22+) and SpiderMonkey (Firefox 120+) shipped
  WasmGC in 2023–24; exnref-style exception handling (`try_table`) is unflagged in current
  Chrome/Firefox and Node 23+ (jco's own exnref CLI test is `skipIf(nodeMajorVersion <= 22)`,
  test/cli.js:57). Empirically confirmed here on Node 26.6.0, current headless Chrome, and
  current headless Firefox with **zero flags** (§9). JSC/Safari was *not* tested here —
  WasmGC shipped in Safari 18.2+ (browser-support research), but exnref EH timing in JSC
  remains an open question for zena's exceptions path.
- **JSPI:** still behind `--enable-experimental-webassembly-jspi` in Chrome per jco's own
  browser tests (§1); jco generates conditional fallbacks so JSPI is an optimization, not a
  requirement (except explicit `--async-mode jspi`).
- **jco does no GC feature detection** — by construction. Generated glue never touches GC
  types; the guest core module is engine-compiled. GC capability is implicit in the engine
  baseline you choose to support.

## 8. The GC-guest crux — mechanisms found

| Area | Finding | Citation |
| --- | --- | --- |
| Transpile-time validation | GC + funcref + tail-call + memory64 on by default (`WASM3`) | js-component-bindgen lib.rs:141-150; wasmparser features.rs:373-382 |
| Exception handling | Off by default; `--bindgen-enable-wasm-exnref` re-enables | lib.rs:152-159; jco.ts:165; js-component-bindgen-component lib.rs:74 |
| Core module emission | Verbatim passthrough to JS engine | lib.rs:169-181 (files.push(module.wasm())) |
| Multi-memory polyfill | If `multiMemory:false` (default) and the module needs multi-memory, an "augmenter" rewrites memory ops as JS imports — it **bails on GC types** (`into_iter_err_on_gc_types`) and on global/table/data/tag sections | core.rs:95-141, 327, 369-379 |
| `jco opt` / `--optimize` | Default wasm-opt args `-Oz --low-memory-unused --enable-bulk-memory --strip-debug` **omit GC/EH flags → binaryen rejects GC components** ("Fatal: error validating input"); passing `-- --enable-gc --enable-exception-handling --enable-reference-types --enable-tail-call` works | packages/jco-transpile/src/opt.ts:59-60; empirical §9 |
| Component embed/new | Validates with `WasmFeatures::all()` — GC/EH accepted | wit-component validation.rs:63, encoding.rs:3372 |
| JS boundary | No `WebAssembly.Function`/type reflection anywhere; JSPI conditional | rg zero hits; transpile_bindgen.rs:2915 |

## 9. Verification log (all commands run 2026-09-14)

Setup: hand-written guest `gc.wat` (GC struct `struct.new/struct.get`, typed-funcref global,
`call_ref`) and `gcexn.wat` (GC struct + `try_table` catching a thrown tag + `call_ref`),
world `zena:test/test { export get-answer: func() -> u32; }`, then:

```console
wasm-tools component embed --world test test.wit gc.wasm -o gc.embed.wasm
wasm-tools component new gc.embed.wasm -o gc.component.wasm        # OK (GC)
jco embed --wit test.wit --world-name test gc.wasm -o gc.js-embed.wasm   # OK (embedded wasm-tools, no system binary)
jco new   gc.js-embed.wasm -o gc.jsnew.component.wasm             # OK

jco transpile gc.component.wasm -o out-gc                          # OK, no flags
node out-gc/gc.component.js → getAnswer() === 28                   # OK (Node 26.6.0)
headless Chrome --dump-dom  → "GC=28 EXN=47"                       # OK
headless Firefox (result POST) → "GC=28 EXN=47"                    # OK

jco transpile gcexn.component.wasm -o out-gcexn                    # FAIL:
#   ComponentError: failed to translate component
#   Caused by: exceptions proposal not enabled (at offset 0x3c)
jco transpile gcexn.component.wasm --bindgen-enable-wasm-exnref -o out-gcexn2  # OK
node → 47; Chrome → 47; Firefox → 47                               # OK everywhere

jco opt gc.component.wasm -o gc.opt.wasm                           # FAIL:
#   Fatal: error validating input   (binaryen, no --enable-gc)
jco opt gc.component.wasm -o gc.opt.wasm -- --enable-gc --enable-exception-handling \
     --enable-reference-types --enable-tail-call                   # OK (0.23→0.17 KiB)
jco transpile gc.opt.wasm → run → 28; gcexn.opt → 47               # OK
```

Expected values: GC guest returns 28 (struct field 23 + 5 via `call_ref`); GC+EH guest
returns 47 (throw caught by `try_table`, struct mutated to 42 + 5). Browser tests served
the transpiled ESM over localhost with the shims unused (no WASI imports in this world).

## 10. What this means for zena-on-jco

1. **Green light for the architecture.** A zena component (GC structs/arrays, typed funcrefs,
   `call_ref`) transpiles with stock `jco transpile` and runs in Node and both tested
   browsers with no flags. jco imposes *zero* JS-side constraints on guest GC usage because
   generated glue only crosses numeric boundaries.
2. **Exceptions need a transpile flag and an engine floor.** Zena's GC exceptions
   (`try_table`/`throw`) require `jco transpile --bindgen-enable-wasm-exnref` (or
   `bindgenEnableWasmExnref: true` via API) — default-off because FACT adapter barriers
   assume engine EH. Engine floor: Node 23+/current Chrome/Firefox run it unflagged
   (verified); Node 22 (still in jco's CI matrix) would not without
   `--experimental-wasm-exnref`. Recommendation: make the flag default-on in the zena→jco
   pipeline, and keep a no-EH zena lowering as a portability escape hatch (Safari/JSC
   exnref status unverified).
3. **Targeting choice:** the shortest path for existing zena output is the adapter route
   (`jco new --adapt wasi_snapshot_preview1=wasi_snapshot_preview1.wasm`), but going direct
   to a preview2 world (imports named `wasi:cli/environment@0.2.x`, …) removes the p1
   adapter module and its `__main_module__`/`env.memory` indirection — cleaner for a GC
   guest, and matches what the generated import objects expect verbatim.
4. **Guest ABI checklist for the zena compiler:** export `memory`, `cabi_realloc`
   (+ `cabi_import_realloc` when the world imports strings/lists), optional
   `cabi_post_<fn>`, kebab-case export names per the WIT world; single linear memory
   (multi-memory guests hit the augmenter, which cannot rewrite GC-holding modules —
   core.rs bailouts — so keep to one memory or require multi-memory engines).
5. **Optimization must be flag-aware.** `jco opt`/`--optimize` defaults omit
   `--enable-gc`; zena pipelines must pass
   `-- --enable-gc --enable-exception-handling --enable-reference-types --enable-tail-call`
   (verified working) or skip binaryen. Worth an upstream jco issue since Wasm3.0 features
   are increasingly the default assumption.
6. **Node and browser delivery are both first-class.** Node: plain ESM import after
   transpile, or `jco run`/`serve` (sandbox flags, request isolation) for dev. Browser:
   transpiled ESM + import-map for the preview2-shim browser builds, or
   `rolldown-plugin-jco` at bundle time; small guests become single-file via base64
   inlining. Browser WASI is capability-limited (no real FS/sockets; fetch-only HTTP) —
   fine for zena's compute workloads, needs adapters for I/O-heavy ones.
7. **Async:** zena doesn't need JSPI; jco's p2 support is sync-with-fallbacks. If zena later
   wants async exports (p3/streams), `--async-mode jspi` exists but remains
   Chrome-flag-gated — keep it optional.

## Open questions

1. **`jco opt` GC defaults** — should jco pass `--enable-gc` (and EH/tail-call/reference
   types) to wasm-opt by default now that WASM3 is baseline? File upstream issue; until
   then zrea pipelines must pass the explicit flags (verified workaround, §9).
2. **Safari/JSC exnref status** — untested here; determines whether zena's exceptions can be
   unconditional in browser targets or need the no-EH lowering. (WasmGC itself is fine on
   modern Safari; exnref EH timing is the open part.)
3. **Node 22 (LTS, still in jco CI)** — GC OK, but exnref EH needs
   `--experimental-wasm-exnref`; does zena need to support Node 22, or is 24+ acceptable?
4. **preview3-shim browser parity** — a `browser/` build exists but the README scopes the
   package to Node; what is actually usable in-browser for p3 (streams/futures) at v0.6.0?
5. **Multi-memory** — if zena ever emits multi-memory guests, the default (augmenter) path
   is incompatible with GC-bearing modules; then `--multi-memory` (engine requirement)
   becomes mandatory. Confirm all target engines (Safari?) before relying on it.
6. **`CM_GC` component-level GC** — if zena ever wants GC values *across* the WIT boundary,
   that's a non-default component feature (`cm_gc`, off in jco's feature set); out of scope
   today but worth remembering it's not just "GC works everywhere".
7. **`WebAssembly.promising(cabi_import_realloc)`** observed in generated code — confirm the
   exact worlds where jco calls *guest* realloc from a promise context, to know when the
   guest realloc must be JSPI-safe (sync code only) on JSPI-enabled engines.

## Cross-references

- Sibling research in this directory: `zena-targets.*.md` (concurrent agents) — zena's
  existing `host`/`wasi` targets and the component-target design space this document feeds.
- jco book: [`docs/src/transpiling.md`](/home/rektide/archive/bytecodealliance/jco/docs/src/transpiling.md)
  (options & semantics), [`docs/src/advanced/manual-wasm-instantiation-with-wasi-overrides.md`](/home/rektide/archive/bytecodealliance/jco/docs/src/advanced/manual-wasm-instantiation-with-wasi-overrides.md),
  [`docs/src/troubleshooting/common-issues.md`](/home/rektide/archive/bytecodealliance/jco/docs/src/troubleshooting/common-issues.md).

## References

Primary (jco archive @ c03204df):

- [`docs/src/transpiling.md`](/home/rektide/archive/bytecodealliance/jco/docs/src/transpiling.md) — lines 15-63 (options), 65-98 (browser support / component subpath), 168-183 (WASI shim mapping), 254-299 (instantiation modes).
- [`crates/js-component-bindgen/src/lib.rs`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/lib.rs) — lines 105-181 (decode, wasmtime-environ translation, feature set incl. `supports_wasm_exnref` at 141-159, verbatim core emission 169-181).
- [`crates/js-component-bindgen/src/transpile_bindgen.rs`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/transpile_bindgen.rs) — 446-527 (core module compile strategies, `instantiate` signature), 2915 (conditional `WebAssembly.Suspending`), 3338-3474 (`WebAssembly.promising`).
- [`crates/js-component-bindgen/src/intrinsics/mod.rs`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/intrinsics/mod.rs) — 309-328 (base64Compile), 370-379 (FinalizationRegistry), 381-401 (fetchCompile Node/browser), 453 (`instantiateCore`).
- [`crates/js-component-bindgen/src/core.rs`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/core.rs) — 1-141 (multi-memory augmentation), 327 (`into_iter_err_on_gc_types`), 369-379 (section bail-outs).
- [`crates/js-component-bindgen-component/src/lib.rs`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen-component/src/lib.rs) — line 74 (`bindgen_enable_wasm_exnref.unwrap_or(false)`).
- [`crates/wasm-tools-component/src/lib.rs`](/home/rektide/archive/bytecodealliance/jco/crates/wasm-tools-component/src/lib.rs) — 25-370 (parse/print/component_new/wit/embed/metadata ops), 248 (`ManglingAndAbi::Standard32` dummy).
- [`packages/jco/src/jco.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/jco.ts) — 104-176 (transpile flags incl. line 165), 253-323 (run/serve), 413-446 (new/embed).
- [`packages/jco/src/cmd/run.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/cmd/run.ts) — 60-84 (run), 86-281 (serve/isolation), 283-475 (runComponent), 477-532 (sandbox setup).
- [`packages/jco-transpile/src/transpile.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/src/transpile.ts) — 25, 128-132, 171 (AsyncMode, multiMemory, exnref option, p3 versions).
- [`packages/jco-transpile/src/opt.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/src/opt.ts) — 59-60 (default wasm-opt args, no GC).
- [`packages/jco-transpile/src/wasm-tools.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/src/wasm-tools.ts) — vendored wasm-tools component wrapper.
- [`packages/jco-transpile/package.json`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/package.json) — 51-67 (vendor build).
- [`packages/preview2-shim/README.md`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/README.md) — browser support matrix + WASIShim usage.
- [`packages/preview2-shim/package.json`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/package.json) — exports conditions (node/browser).
- [`packages/preview2-shim/src/browser/`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/src/browser) — filesystem.ts, opfs-filesystem.ts, in-memory-{filesystem,http,sockets}.ts.
- [`packages/preview3-shim/README.md`](/home/rektide/archive/bytecodealliance/jco/packages/preview3-shim/README.md) + `src/{nodejs,browser}/` listings.
- [`packages/jco-transpile/test/browser/index.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/test/browser/index.ts) — 55-72 (Chrome JSPI flags), in-browser bindgen test.
- [`packages/jco-transpile/test/fixtures/browser/harness.html`](/home/rektide/archive/bytecodealliance/jco/packages/jco-transpile/test/fixtures/browser/harness.html) — import-map wiring.
- [`packages/jco/test/cli.js`](/home/rektide/archive/bytecodealliance/jco/packages/jco/test/cli.js) — 15 (`--multi-memory` gate), 57 (exnref test gated on Node > 22).
- [`packages/rolldown-plugin-jco/README.md`](/home/rektide/archive/bytecodealliance/jco/packages/rolldown-plugin-jco/README.md).
- [`examples/components/browser-p2-shims/README.md`](/home/rektide/archive/bytecodealliance/jco/examples/components/browser-p2-shims/README.md).
- [`docs/src/interop/nodejs-builtins/supported-modules/vm.md`](/home/rektide/archive/bytecodealliance/jco/docs/src/interop/nodejs-builtins/supported-modules/vm.md) — 1-99 (portable node:vm subset, limits, security).
- [`.github/workflows/main.yml`](/home/rektide/archive/bytecodealliance/jco/.github/workflows/main.yml) — 114-118 (Node 22/24/latest matrix); release.yml — 102, 443 (`"node": ">=22"`).
- Root [`Cargo.toml`](/home/rektide/archive/bytecodealliance/jco/Cargo.toml) — 51-55 (wasmtime-environ 48.0.1, wasmparser/wasm-encoder 0.258).

Secondary:

- wasmparser 0.252 registry source, `src/features.rs` — 197-219 (exceptions/gc defaults), 373-382 (`WASM3` definition); jco uses 0.258 with the same umbrella.
- [`crates/wit-component/src/validation.rs`](/home/rektide/archive/bytecodealliance/wasm-tools/crates/wit-component/src/validation.rs) — 63 (`WasmFeatures::all()`), plus encoding.rs:3372, targets.rs:39.
- Git log of jco archive (commits 8d09b85b…c03204df, Sept 2026 — node:vm / engine-limits / p3-shim series).

Artifacts from the empirical run (scratch, not part of this repo): `/home/rektide/tmp-opencode/jco-research/` (gc.wat, gcexn.wat, test.wit, transpiled outputs, serve.mjs harness).
