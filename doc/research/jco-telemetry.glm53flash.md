---
type: Research
title: Observability & telemetry in jco, and WASI OTel
description: What telemetry jco / preview2-shim have today, the instrumentation seams transpiled components expose, forward-looking design options for zena-jco observability, and a survey of the wasi-otel proposal.
status: draft
tags: [jco, telemetry, observability, wasi-otel, preview2-shim, transpile]
generated: { by: agent:glm53flash (GLM 5.3 Flash via zai-coding-plan), at: 2026-09-15 }
verified: { by: human:rektide, at: null }
stale_after: 2026-12-15
sources:
  - id: jco-archive
    resource: /home/rektide/archive/bytecodealliance/jco
    title: bytecodealliance/jco local checkout (recent main)
    author: org:bytecodealliance
  - id: wasi-otel
    resource: https://github.com/WebAssembly/wasi-otel
    title: WebAssembly/wasi-otel proposal repository
    author: org:WebAssembly
---

# jco telemetry & WASI OTel research

All archive citations are `file:line` against the local jco checkout at
`/home/rektide/archive/bytecodealliance/jco` (recent main, pnpm monorepo with
`crates/js-component-bindgen` + `packages/{jco,jco-transpile,preview2-shim,preview3-shim,jco-std}`).

## 1. jco telemetry today

### 1.1 The one env var: `JCO_DEBUG`

The only user-facing env var gating behavior in *generated* code is `JCO_DEBUG`. It is
compiled into every transpiled component by the `DebugLog` intrinsic:

- [`intrinsics/mod.rs:528-536`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/intrinsics/mod.rs) —
  `Intrinsic::DebugLog` emits a helper that checks `globalThis?.process?.env?.JCO_DEBUG` and
  `console.debug(...args)` only when set. The helper is named `_debugLog`
  ([`intrinsics/mod.rs:2621`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/intrinsics/mod.rs)).

`_debugLog` is emitted *pervasively* through generated bindings as structural
instrumentation — this is an underused seam:

- `function_bindgen.rs:1943` — `[Instruction::CallWasm] enter` (funcName, paramCount, async, postReturn)
- `function_bindgen.rs:1971, 1988` — `[Instruction::CallWasm] error during async/sync call` (taskID, err) plus `markTrapped`/`task.reject` cleanup
- `function_bindgen.rs:2099` — `[Instruction::CallInterface] (…@ enter)`
- `function_bindgen.rs:2204, 2225, 2244` — CallInterface task-entry failure and call errors
- `function_bindgen.rs:2388` — `[Instruction::Return]`
- `function_bindgen.rs:3163` — `[Instruction::FutureLower] object is not a Promise/Thenable`
- `function_bindgen.rs:3535` — `[Instruction::StreamLower] object with no supported stream protocol`
- `function_bindgen.rs:3748, 3804, 3828, 3842` — `[Instruction::AsyncTaskReturn]` lifecycle incl. "starting driver loop" / "driver loop call failure"
- `intrinsics/lower.rs:254-282` — per-flat-type lowering debug (`_lowerFlatBool()`, `_lowerFlatS8()`)

All of these fire only under `JCO_DEBUG=1`; the strings with values become JS object
literals (second `console.debug` arg), i.e. they are *structured*, just printed.

### 1.2 `--tracing`: opt-in call tracing on exports

`jco transpile` has a real tracing flag:

- [`jco.ts:138`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/jco.ts) — `--tracing` "emit `tracing` calls on function entry/exit"
- [`transpile_bindgen.rs:4829-4831`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/transpile_bindgen.rs) — builds
  `tracing_prefix = "[iface=\"<iface>\", function=\"<fn>\"]"`, passed into every `FunctionBindgen`
  as `tracing_prefix`/`tracing_enabled` ([`function_bindgen.rs:194-197`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/function_bindgen.rs))
- Entry emission: [`transpile_bindgen.rs:4871-4883`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/transpile_bindgen.rs) —
  `console.error(\`{prefix} call name=${arguments[0]}, …\`)`
- Exit emission: `function_bindgen.rs:2062-2075` (interface calls) and `2338-2349` (core/wasm calls) —
  `console.error(\`{prefix} return result=${toResultString(ret)}\`)`

So with `--tracing`, every export/import trampoline prints entry (with parameter
names/values) and exit (with serialized result) to **stderr via `console.error`**. There is
**no timing/duration, no span hierarchy, no sink selection** — output goes straight to
console. Docs confirm the entry/exit behavior at
[`docs/src/transpiling.md:57`](/home/rektide/archive/bytecodealliance/jco/docs/src/transpiling.md).

`jco run` and `jco serve` pass this through on the fly: `--jco-trace`
([`jco.ts:262, 302`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/jco.ts)) →
[`run.ts:305`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/cmd/run.ts) `tracing: opts.jcoTrace`
inside the internal `transpileCmd` call that `run`/`serve` perform before executing.

### 1.3 Diagnostics flags & env vars (full inventory)

- `jco componentize`: `--debug` ([`jco.ts:61`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/jco.ts),
  "disable all features except stdio, etc"), `--debug-bindings` / `--debug-bindings-dir`
  (`jco.ts:94-95`, wired at [`componentize.ts:409-410`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/cmd/componentize.ts)),
  `--debug-binary(-path)`, `--debug-starlingmonkey-build`, `--debug-enable-wizer-logging` (`jco.ts:101`).
  These are build-time debugging aids, not runtime observability.
- `jco run` env: `JCO_RUN_PATH` (node binary override, [`run.ts:454`](/home/rektide/archive/bytecodealliance/jco/packages/jco/src/cmd/run.ts))
  and `JCO_RUN_ARGS` (`run.ts:459`) — execution plumbing, not telemetry.
- Run/serve runtime diagnostics are ad-hoc `console.error`: invalid component (`run.ts` template, ~line 56-57),
  `Server listening @ host:port` (~`run.ts:287`).
- Examples/tests only: `JCO_PATH` (`examples/components/http-hello-world/demo.js:10`),
  `JCO_NATIVE_MESSAGING_TEST_LOG` (native-messaging test harness).
- Generated output carries the directive `"use components";` — the source comment calls it
  "the telemery directive" ([`transpile_bindgen.rs:503-504`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/transpile_bindgen.rs))
  but it is a JS directive string, not telemetry.
- Error codes follow `ERR_JCO_*` conventions (e.g. `ERR_JCO_ZLIB_ADAPTER_REQUIRED`,
  `ERR_JCO_UNSUPPORTED_NODE_API`) — consistent, greppable failure classification.

### 1.4 preview2-shim / preview3-shim / jco-std logging

- **No metrics anywhere.** The only `Date.now`/`hrtime`/`performance.now` uses are clock
  *implementations* (`packages/preview2-shim/src/nodejs/clocks.ts:7,18,34-41,68-69`,
  `browser/clocks.ts:33-34`) and poll/deadline bookkeeping in the sync io worker
  (`packages/preview2-shim/src/io/worker-thread.ts:617, 1013-1018`). Nothing aggregates or exports timings.
- **No `wasi:logging` shim**: the default import object
  ([`packages/preview2-shim/types/instantiation.d.ts`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/types/instantiation.d.ts))
  enumerates cli/sockets/filesystem/io/random/clocks/http namespaces — logging is absent.
- [`packages/jco-std/src/wasi/0.2.x/logging.ts`](/home/rektide/archive/bytecodealliance/jco/packages/jco-std/src/wasi/0.2.x/logging.ts)
  contains a *commented-out* wasi:logging consumer and a console.error-based `buildLogger()`
  fallback; the comment explains why: "we can't use log just yet due to lack of support in
  off the shelf hosts like wasmtime".
- The [`examples/components/host-logging`](/home/rektide/archive/bytecodealliance/jco/examples/components/host-logging)
  example is the canonical pattern for providing `wasi:logging/logging@0.1.0-draft` host-side:
  a plain JS module `log-host.js` (switch on level → `console.debug/info/warn/error`), mapped at
  transpile time with `--map 'wasi:logging/logging=./log-host.js'` (the example's
  `package.json` `transpile` script). The guest (`component.js`) simply
  `import { log } from "wasi:logging/logging@0.1.0-draft"`.

## 2. Runtime observability seams of transpiled components

What generated JS exposes that a host can wrap:

1. **`instantiate(getCoreModule, imports, instantiateCore)`** —
   [`transpile_bindgen.rs:519`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/transpile_bindgen.rs)
   (sync variant at 525-536 with `-I sync`). The `imports` object is fully host-controlled;
   with `wasiShim` the generated module instead statically imports
   `@bytecodealliance/preview2-shim/<ns>` specifiers (`transpile_bindgen.rs:4170, 7767-7793`), which
   means **module-resolution interception (import maps, bundler alias, `node:`-style loader)
   is a second injection point**.
2. **`_util` export, always present** —
   [`transpile_bindgen.rs:682, 697-744`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/transpile_bindgen.rs).
   Currently it exposes the `Future` class "used by external consumers (e.g. host code) to
   build nested future values". The comment explicitly frames `_util` as a host-facing
   extension point — a natural home for future telemetry helpers.
3. **World export namespaces** — exports render as plain objects of functions
   (`esm_bindgen.render_exports`), so a trivial post-instantiate proxy
   (`wrapEveryFn(component.<world>Exports)`) gives spans/metrics around every exported call
   with zero jco changes.
4. **`ComponentError` normalization** —
   [`intrinsics/mod.rs:345-356`](/home/rektide/archive/bytecodealliance/jco/crates/js-component-bindgen/src/intrinsics/mod.rs):
   guest `result<_, e>` errors are wrapped with an enumerable `.payload` property (unless
   `--no-component-error-wrapping`). Host instrumentation can classify errors by inspecting
   `err instanceof ComponentError` + `err.payload` — a stable error taxonomy seam.
5. **Task/async state** — error paths call `getComponentState(idx).markTrapped(err)`,
   `task.setErrored/reject/exit/completionPromise`, `task.id()`
   (`function_bindgen.rs:1965-1990`). Per-component async state objects exist keyed by
   `componentIdx`; task IDs are already generated and flow through debug logs. This is where
   span context *could* live (see §3).
6. **stdout/stderr capture** —
   [`packages/preview2-shim/src/nodejs/cli.ts:23-24, 60-81`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/src/nodejs/cli.ts):
   `_setStdout`/`_setStderr` let a host redirect guest stdio streams wholesale.
7. **WASIShim override API** —
   [`packages/preview2-shim/src/common/instantiation.ts:217`](/home/rektide/archive/bytecodealliance/jco/packages/preview2-shim/src/common/instantiation.ts)
   `getImportObject()`, documented per-namespace override (`instantiation.ts:30-53`) plus a
   `sandbox` config. A host can substitute a *wrapping* implementation of any WASI interface
   (e.g. wrap every `wasi:clocks/monotonic-clock` call, or supply a wasi:logging impl) without
   touching generated code.

## 3. Forward speculation: a zena-jco observability layer

*(Everything in this section is clearly-labeled speculation / design proposal, not
existing jco behavior.)*

### 3.1 Host-side, implementable today with zero jco changes

- **Span-per-export proxy.** After `await instantiate(...)`, deep-wrap each exported
  function: start a span (name `[component=<name>] iface/function` mirroring jco's
  `tracing_prefix`), record duration via `performance.now()`, end with ok/error derived from
  exception vs `ComponentError.payload`. This reproduces `--tracing` but with timing,
  hierarchy, and a real exporter (e.g. `@opentelemetry/sdk-node` / OTLP).
- **wasi:logging host module.** Follow the host-logging example: author `zena` guests
  against `wasi:logging/logging@0.1.0-draft`, and `--map` it to a JS module that forwards
  into the OTel logs API. Because transpiled imports are ordinary ES modules, the "host
  implementation" is ~30 lines.
- **stdio capture.** `_setStderr(stream)` on preview2-shim routes guest writes into a
  log pipeline (parse line-oriented logs, attach as span events or log records).
- **Per-component metrics.** Counters/histograms keyed by component name + export name +
  outcome; errors bucketed by `ComponentError.payload` shape.

### 3.2 Guest-side options

- Zena compiler could emit `wasi:logging` calls at language level (user-visible logging),
  mirroring what the host-logging guest does.
- A `zena:telemetry` custom world import (host-implemented via `--map`, exactly like
  log-host.js) would let zena emit spans/metrics without waiting for wasi-otel — but it
  fragmenting from OTel semantics is the known cost (wasi-otel's README explicitly records
  the decision to bind tightly to upstream OTel APIs for this reason).
- The `JCO_DEBUG`/`_debugLog` precedent shows compile-time structural instrumentation is
  already the house style; a zena codegen flag could emit equivalent guest-side enter/exit
  debug logs cheaply.

### 3.3 What jco would need to change to help

1. **Pluggable tracing sink.** `--tracing` hardcodes `console.error`
   (`transpile_bindgen.rs:4881`, `function_bindgen.rs:2069, 2342`). A `--tracing-sink <module>`
   (import a host module, call `sink.enter(prefix, args)` / `sink.exit(prefix, result)`)
   would turn the existing emission points into a first-class hook.
2. **Timing on the existing exit site.** The exit emission already exists; adding a
   duration capture is a one-line change at each `tracing_enabled` block.
3. **Span context in task state.** `getComponentState(idx)` objects already track
   tasks/traps; a `currentSpan` slot would let async (JSPI) continuations resume the right
   span — the hard part of tracing through jco's async machinery.
4. **A `wasi:logging` (and eventually `wasi:otel`) shim in preview2-shim**, added to the
   `WASIShim` import-object builder so hosts get it via `getImportObject()` instead of `--map`.
5. **`_util` growth.** Exposing `markTrapped`/task metadata through `_util` would let hosts
   observe trap/task lifecycle without patching generated code.

## 4. wasi-otel

Repository: https://github.com/WebAssembly/wasi-otel — 21 commits, Phase 2 proposal,
champions Caleb Schoepp & Andrew Steurer. Formerly pursued as **WASI Observe**; renamed to
bind tightly to upstream OpenTelemetry APIs because "that is what most developers actually
required". Portability criteria (≥2 independent production implementations) are **unmet** —
Stakeholder Interest section is literally "TODO before entering Phase 3". `imports.md` is
still template boilerplate. Treat as directionally-real, far-from-standard.

### 4.1 What it defines

Package `wasi:otel@0.2.0-rc.2`, single world
([world.wit](https://github.com/WebAssembly/wasi-otel/blob/main/wit/world.wit)):

```wit
world imports {
    import types;
    import tracing;
    import metrics;
    import logs;
}
```

Four interfaces ([wit/](https://github.com/WebAssembly/wasi-otel/tree/main/wit)):

- **`types`** ([types.wit](https://github.com/WebAssembly/wasi-otel/blob/main/wit/types.wit)):
  `key-value{key: string, value: string}` — attribute values are **JSON-serialized strings**
  (bytes base64-encoded with `data:application/octet-stream;base64,…` Data-URI prefixes,
  because WIT has no recursive types); `%resource` (identifying attributes + schema-url);
  `instrumentation-scope` (name, version, schema-url, attributes).
- **`tracing`** ([tracing.wit](https://github.com/WebAssembly/wasi-otel/blob/main/wit/tracing.wit)):
  `on-start: func(context: span-context)`, `on-end: func(span: span-data)`,
  `current-span-context: func() -> span-context`. `span-context` carries hex-string
  `trace-id` (16B) / `span-id` (8B), `trace-flags` (sampled flag), `is-remote`,
  `trace-state`. `span-data` adds parent-span-id, `span-kind` (client/server/producer/consumer/internal),
  start/end `datetime`, attributes, events, links, `status` (unset/ok/error(string)), scope,
  and dropped-counts.
- **`metrics`** ([metrics.wit](https://github.com/WebAssembly/wasi-otel/blob/main/wit/metrics.wit)):
  a single push-export `%export: func(metrics: resource-metrics) -> result<_, error>`.
  `resource-metrics` → `scope-metrics` → `metric{name, description, unit, data}` where data
  is a 12-way variant: {gauge, sum, histogram, exponential-histogram} × {f64, u64, s64},
  with data-points, `temporality` (cumulative/delta/low-memory), bounds/bucket-counts,
  scale/zero-threshold for exponential, and `exemplar`s linking measurements back to
  span-id/trace-id.
- **`logs`** ([logs.wit](https://github.com/WebAssembly/wasi-otel/blob/main/wit/logs.wit)):
  single `on-emit: func(data: log-record)`; `log-record` has optional
  timestamp/observed-timestamp, severity-text + severity-number (1-24), body, attributes,
  event-name, resource, scope, and trace correlation (trace-id, span-id, trace-flags).

### 4.2 How guests emit / what a host must implement

Design shape: **guest pushes, host aggregates/exports.** The guest (via an OTel SDK
generated against this WIT) calls `tracing.on-start/on-end` per span, `logs.on-emit` per
record, and periodically `metrics.export` with fully-aggregated `resource-metrics`.
`current-span-context()` is the propagation hole: the *host* owns the in-flight span stack,
so a guest asks "what span am I in?" — enabling host-initiated spans (e.g. the component
graph tracing the README mentions) to parent guest spans without any wire-format
propagation into the guest.

A host must therefore implement: all four interfaces; a span-context stack with W3C
trace-id/trace-state semantics; sampling; resource/scope registries; metric aggregation for
12 instrument shapes × 3 temporalities; and export to a collector (OTLP). That is an
OpenTelemetry SDK's worth of work — the proposal leans on reusing upstream OTel SDK concepts.

**Dependency closure is tiny**: `wkg.lock` pins exactly one dependency,
`wasi:clocks@0.2.0` (for `wall-clock.datetime` and `monotonic-clock.duration`). No
io/streams/http/random. This is the key fact for jco: **a preview2-shim-style JS host
implementation is very feasible** — clocks already exist in preview2-shim
(`packages/preview2-shim/src/nodejs/clocks.ts`), and the four interfaces could ship as ES
modules named `wasi:otel/tracing@0.2.0-rc.2` etc., provided via `--map` today and
`WASIShim.getImportObject()` in the future. The aggregation burden (histograms etc.) is
real but pure-JS.

Caveat: no component-level runtime ships a guest-side wasi-otel SDK yet (wasmtime lacks
wasip2 logging support per jco-std's comment, and wasi-otel is wasip3-flavored RC); the
`test/` directory in the proposal repo is the only implementation reference today.

## 5. Implications for zena-jco

- **Today's floor is decent**: `--tracing`/`--jco-trace` gives free call traces to stderr;
  `ComponentError.payload` gives error classification; WASIShim + `--map` give injection
  points; `_setStderr` gives log capture. A zena-jco host can build span-per-export
  instrumentation now, entirely host-side (§3.1), with wasi:logging as the guest log path.
- **The ceiling is gated on jco**: sink pluggability, exit timing, and span-context-in-task
  state are small, local changes to `transpile_bindgen.rs`/`function_bindgen.rs` (§3.3) —
  all three sit inside emission points that already exist.
- **wasi-otel is the right long-term shape** for guest-emitted telemetry, and its
  one-package dependency closure (wasi:clocks only) means a `zena-jco` JS host
  implementation could even *lead* the ecosystem rather than wait — the proposal's
  portability criteria explicitly need two independent implementations. But its Phase 2
  status and moving RC surface argue for wrapping it behind our own thin interface
  (`--map`-provided module) so the sink can swap without touching zena codegen.
- Suggested sequencing: (1) host-side wrapper + wasi:logging mapping (no jco changes);
  (2) upstream jco PRs for tracing sink + timing; (3) track/implement wasi-otel once the
  surface stabilizes past RC.

## 6. Open questions

- Does `--tracing` on **imports** (not just exports) cause noise problems for wasi-http
  heavy components? (Entry+exit per import call, params serialized each time.)
- Should zena codegen emit wasi:logging directly, or should guest logging stay a zena
  language feature compiled to a custom host import until wasi-otel lands?
- Which OTel signal first for zena-jco: traces (matches jco's existing `--tracing` shape),
  logs (matches wasi:logging), or metrics (needs new aggregation machinery)?
- For browser hosts (preview2-shim browser build), is stderr even meaningful — do we need
  a `console`-level sink abstraction from day one?
- If jco accepts a `--tracing-sink`, should the sink contract mirror wasi-otel's
  on-start/on-end/on-emit so the same sink serves both paths?

## 7. References

Archive (file:line given inline above):

- `crates/js-component-bindgen/src/intrinsics/mod.rs` — DebugLog intrinsic (528-536, 2621), ComponentError (345-356)
- `crates/js-component-bindgen/src/function_bindgen.rs` — tracing fields (194-197), emission sites (1943, 1971, 1988, 2062-2075, 2099, 2338-2349, 2388, 3163, 3535, 3748-3842)
- `crates/js-component-bindgen/src/transpile_bindgen.rs` — `"use components"` (503-504), instantiate (519), `_util` (682, 697-744), tracing (4829-4831, 4871-4883)
- `crates/js-component-bindgen/src/intrinsics/lower.rs:254-282` — flat lowering debug
- `packages/jco/src/jco.ts` — CLI options (61, 94-95, 101, 138, 262, 302)
- `packages/jco/src/cmd/run.ts` — jcoTrace passthrough (305), JCO_RUN_PATH/ARGS (454, 459)
- `packages/jco/src/cmd/componentize.ts` — debug bindings (27, 61-62, 94-95, 409-410)
- `packages/preview2-shim/src/common/instantiation.ts` — WASIShim/getImportObject (25, 49, 217)
- `packages/preview2-shim/src/nodejs/cli.ts` — `_setStdout`/`_setStderr` (23-24, 60-81)
- `packages/preview2-shim/types/instantiation.d.ts` — default import namespace list (no logging)
- `packages/jco-std/src/wasi/0.2.x/logging.ts` — console fallback logger + wasmtime-support comment
- `examples/components/host-logging/` — wasi:logging host module pattern (`log-host.js`, `package.json` transpile script, `component.js`)
- `docs/src/transpiling.md:57` — `--tracing` docs

wasi-otel:

- https://github.com/WebAssembly/wasi-otel — README (Phase 2 status, goals, WASI Observe origin, Q&A)
- https://github.com/WebAssembly/wasi-otel/blob/main/wit/world.wit
- https://github.com/WebAssembly/wasi-otel/blob/main/wit/types.wit
- https://github.com/WebAssembly/wasi-otel/blob/main/wit/tracing.wit
- https://github.com/WebAssembly/wasi-otel/blob/main/wit/metrics.wit
- https://github.com/WebAssembly/wasi-otel/blob/main/wit/logs.wit
- https://github.com/WebAssembly/wasi-otel/blob/main/wkg.lock — sole dependency `wasi:clocks@0.2.0`
- https://github.com/WebAssembly/wasi-observe — predecessor proposal (generic observability)
- https://opentelemetry.io/docs/concepts/signals/ — signal taxonomy the proposal mirrors
