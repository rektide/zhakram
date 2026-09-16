---
type: Research
title: zena on jco — work outline
description: The plan of record — posture (p2-direct), repo layout, workstreams with status and dependencies, sequencing, fork strategy, p3 frontier. Supersedes the next-actions section of getting-started.
resource: https://github.com/rektide/zena-jco
tags: [zena, jco, wasm-gc, component-model, wasi, plan]
status: draft
generated:
  by: agent:glm53max
  at: 2026-09-14
verified: { by: unverified }
stale_after: 2026-12-01
sources:
  - id: getting-started
    resource: /home/rektide/src/zena-jco/doc/research/getting-started.glm53max.md
    title: kickoff + validated facts
    author: agent:glm53max
---

# zena on jco — work outline

## Posture

- **The architecture is p2-direct.** Zena guests import WASI 0.2.x
  interfaces at the lowered core ABI (verified contract: plain
  `wasi:cli/stdout@0.2.12` module names, `[method]…`/`[resource-drop]…`
  functions, i32 handles, exported `memory`). **No preview1 adapter in any
  load-bearing path** — the E2 p1 result is bridge evidence only.
- **jco is the host**: `jco transpile` ES-module output in Node and the
  browser, WASI from jco's preview2-shim (Node real FS; browser
  in-memory/OPFS).
- **p3 is the frontier**, not the starting line: characterize what jco's
  preview3-shim + async machinery already support, and position the fork so
  zena's eventual async lands jco-first (see W7, F3).
- Fork changes are **evidence-driven and upstreamable**; zena-jco holds the
  host-side kit.

## Repo layout

```
zena-jco/
  examples/
    emoji-wit/        # shared WIT worlds (contract of record)
    emoji-zena/       # zena impl + consumers
    emoji-rs/         # Rust impl + consumers (docs/scripts; crates in crates/)
    interop-jshost/   # JS-host composition + p2-direct proofs
    interop-static/   # wac static composition
    interop-matrix/   # the gen × consume × mode test harness
  lib/                # zena-language libraries (cabi.zena, wasip2.zena)
  crates/             # Rust crates (emoji-rs, rng-rs, consume-rs)
  packages/           # TS tooling (pipeline CLI, browser helper)
  doc/research/       # research + this outline
```

## Workstreams

| ID | Workstream | Status | Depends on |
| --- | --- | --- | --- |
| W1 | p2-direct zena host kit | ✅ **green Node + browser** ("hello p2" via wasi:cli/stdout, no WAT surgery) | F1 |
| W2 | emoji trio | ✅ **all three green**: emoji-wit (contract), emoji-zena (Node+browser, indirect cabi string), emoji-rs (Node+browser; `wasi:random@0.2.6` satisfied version-blind) | W3, F1 |
| W3 | `lib/cabi.zena` — canonical ABI in zena source | ✅ **done** — string lift/lower, indirect result form, post-return free (proven by emoji-zena, Node + browser) | — |
| W4 | interop trio (jshost / static / matrix) | ✅ **matrix green** (verified 2026-09-15): 8 pass / 2 skip / 2 n-a / 0 fail, browser legs included; first zena↔zena composition; static rust→zena composes to a zero-import component. Skips = the interface-export naming gap (F5) | W1, W2 |
| W5 | `packages/` pipeline tooling | not started; pipeline proven as shell scripts | W1–W3 stabilizing |
| F1 | fork: type-identity fix (preRec generalization) | ✅ **done + committed** — flat-ABI imports + exported entry points get standalone types; compiler suite fail 0. 2nd fork fix landed 2026-09-15 (`--dce` intrinsic-family cull — see findings log) | — |
| otel spans (`lib/zena/otel` + `packages/jcona-otel`) | ✅ **done + verified** — real `wasi:otel/tracing@0.2.0-rc.2` hand-lowered (no resources; indirect results via trailing return-area param), spans flow in Node + browser (`examples/otel-zena`); ticket closed | — |
| F2 | fork: `--target component` | designed sketch; decide after F1 | F1 |
| F5 | fork: export-name mangling for interface exports | ✅ **done + verified** — `@exportName` decorator (fork tsumxvov) + matrix `rng-source-both` world; matrix now **10 pass / 0 skip / 2 n-a / 0 fail**, incl. wac-fused zena→zena static composition | — |
| F3 | fork: async/JSPI-first host | strategy decision with evidence | W7 |
| W7 | p3 frontier characterization | ✅ **done** — [`p3-frontier.solmax.md`](p3-frontier.solmax.md): decisive experiment (real zena WasmGC module, live GC ref across a JSPI-suspending host call, async WIT + sync canon) green in Node 26 + unflagged Chrome 150; **corrects** jco-host's "JSPI has fallbacks" (it's a hard dep) and "Chrome flag-gated" (shipped in 137) | — |
| F3 | fork: async/JSPI-first host | **bounded GO** per p3-frontier: first slice = zena async syntax/typing + linear JSPI lowering + custom Promise host imports, staying on p2 shims; wasmtime-p3 + native callback ABI = second driver. preview3-shim browser build is a skeleton (random-only); Firefox 152 lacks JSPI | W7 |

### W1 — p2-direct zena host kit

The verified contract lives in
[`examples/interop-jshost/README.md`](../../examples/interop-jshost/README.md).
Handcrafted WAT guest: **green end-to-end** (`wasm-tools component embed/new`
→ `jco transpile` → Node, prints via wasi:cli/stdout through jco shims).
The zena guest (`p2-hello-zena.zena`, already written) compiles to a
**pristine** module (exactly the 3 p2 imports + `run` + `memory`) but is
blocked on the rec-group type-identity bug (F1).

Grows into `lib/wasip2.zena`: zena-side declarations for the p2 interfaces
we consume (stdout/stderr first; then random, clocks, environment), with
thin ergonomic wrappers (a `writeLine(s: String)` that copies into linear
memory and calls blocking-write-and-flush). Same pattern as the fork's
`console/wasi.zena`, but speaking p2 natively.

### W2 — emoji trio

- `emoji-wit`: `rektide:zena-jco/emoji-picker` world — `pick: func() ->
  string` (random smiley; entropy via `wasi:random/random@0.2.x`
  `get-random-u64` once W1 covers it).
- `emoji-rs`: Rust impl — built and committed (wasm32-wasip2); jco leg
  pending (W4 relaunch).
- `emoji-zena`: ✅ green (Node + browser) — `pick() -> string` via the
  indirect canonical ABI (single i32 → 8-byte (ptr,len) area; see
  findings log), freed by `cabi_post_pick`.
- Consumers on all sides print to **WASI stdout** (per the operator: "a wasi
  stdout on the reader, whatever stdout is") — zena consumers via W1, Rust
  consumers via their own p2 bindings, JS consumers via console.

### W3 — `lib/cabi.zena`

**Done** (2026-09-15). The canonical ABI in zena source over `zena:memory` +
`FreeListAllocator`:

- `cabi_realloc(old, oldSize, align, newSize) -> i32` (export name is
  unmangled; allocator default base 65536 clears the wasi-console iovec
  region)
- string lowering (`String` → mem: `getByteAt` loop → `setU8`) and lifting
  (`newByteArray` + `getU8` loop → `String.fromByteArray`)
- `cabi_post_<fn>` free helpers for owned results

No capability gaps identified (i64 ops exist; single memory is fine). This
is upstream Track W stage 4 **prototyped as a library** — whatever ergonomics
hurt here is direct design input for real bindgen (F4 candidate).

### W4 — interop trio

- **jshost**: both components transpiled by jco; JS wires exports→imports;
  browser-runnable. p2-hello is the seed; add a zena-gen → rust-consume and
  reverse wiring demo once parts exist.
- **static**: wac composition (in flight, Rust agent). Stress-tests
  `cm32p2|…` named-slot import naming against zena `@external` if we compose
  zena into wac.
- **matrix**: a Node test harness sweeping {generator: zena, rust} ×
  {consumer: zena, rust, js} × {mode: jshost, static}, each cell asserting
  numbers flowed and stdout carried. Plus at least one browser page cell.

### W5 — `packages/` tooling

Productize the pipeline (`zena-jco build`: compile `--dce` → embed →
`component new` → transpile; `zena-jco serve`: static server + browser
check). Deletes hand-incantations from every example's run.sh. Small surface;
do once W1–W3 shapes stabilize so the tool bakes the *right* steps.

### Fork workstream (F)

- **F1 (now)**: generalize `preRec` — imported `@external` types (any module
  name) + exported entry-point types emitted standalone. Kills the E2 WAT
  hack and unblocks W1. G agent implementing.
- **F2**: `--target component` — bake in `--dce`, make wasi-target infra
  conditional, select component-friendly stdlib flavors. Decide scope after
  F1 lands; evidence from W1 shapes what "component target" must mean
  (e.g. does it speak p1-flat, p2-direct, or WIT worlds?).
- **F3**: async strategy — jco/JSPI as zena's *first* async host driver
  (upstream's plan of record already floats JSPI-first). Decision after W7.
- **F4 (candidate)**: pull Track W bindgen forward in the fork, informed by
  W3's hand-written ABI. The WIT parser is done upstream; bindgen is the
  missing bridge.

### W7 — p3 frontier

Answer, with experiments: What does `jco transpile` + preview3-shim do with
a p3 world today (Node-only shim; browser story)? Can a *synchronous* zena
guest survive in a p3 world (blocking calls, sync exports) or does p3
mandate the async/JSPI machinery? What does that imply for F3? Output: a
`doc/research/p3-frontier.*.md` with verified answers.

## Sequencing

1. ✅ **done** — F1 landed; W1 zena leg green; WAT hack deleted from E2/E5 scripts.
2. ✅ **done** — W3 `cabi.zena`; emoji-zena `pick()` green in Node + browser.
3. **next** — W4 matrix harness starts with available cells; rust relaunch
   delivers (emoji-rs, rng-rs, consume-rs, interop-static) slot in.
4. **W5 tooling** consolidates the pipelines.
5. **W7 p3 probe** → fork strategy conversation (F2/F3/F4) with evidence.

## Done-criteria (per workstream, first pass)

- W1: zena guest prints via p2 stdout in Node **and** browser; `lib/wasip2.zena` exists with ≥ stdout+random.
- W2: `pick()` callable from Node JS, browser JS, and a Rust consumer; all consumers print via WASI stdout.
- W3: string + list<u8> round-trip through zena exports/imports with post-return cleanup, no leaks in a loop test.
- W4: matrix harness green on all existing cells with one command.
- F1: both failure repros pass without WAT surgery; compiler test suite green.

## Open questions

- Named-slot import naming (`cm32p2|upstream`-style) vs default plain names —
  needed for wac composition of zena consumers (W4 static).
- Resource toolkit scope: `zena:handles` guest-side wrappers (own/borrow/
  dropped state) — worth prototyping when a WIT interface with resources
  becomes load-bearing for us (filesystem is the obvious candidate).
- Browser FS selection (in-memory vs OPFS) for examples that read files.
- Does `$string*` auto-export set need gating behind `--target host` in the
  fork (they are externref noise in components)?
- jco `opt`/`--optimize` on GC components needs explicit feature flags —
  fold into W5 tooling when we start optimizing.

## In flight right now

- Rust/W4 relaunch (2026-09-15, quota reset): jco legs for the three Rust
  crates (transpile+run — including the wasi:random@0.2.6 shim-satisfaction
  question), `examples/interop-static` under jco, `examples/emoji-rs`
  consumer docs, cross-consumers, and the `examples/interop-matrix` harness.
- Fork status: two patches landed — pre-rec type identity (F1) and the
  DCE intrinsic-family cull fix. Both verified against our pipelines;
  compiler suite 2285 pass / 0 fail.
- Noted as wanted by the operator: **zena-authored spans** — guest-side
  telemetry emission, natural home `lib/zena/otel` (prerequisites now exist:
  cabi strings + p2-direct externals). Shelved until there's a concrete
  consumer.

## Findings log (newest first)

- **2026-09-16 — F3 design wave complete** (doc/jspi/: design0.glm53max,
  design1.solmax, syn1.glm53h): unified position = JSPI-first as a NAMED
  LINEAR-AWAIT PROFILE of one driver-neutral language — design0's
  front-end-only build scope inside design1's contract framing; Future<T>
  declared but never reified; p3 callbacks stay second driver AND
  conformance oracle, owning the single shared design moment (rejection
  classification, cancellation, lifting the await-in-try ban). Syn caught
  one mechanism error (async-typing constraint is jco wrapper PLACEMENT
  Suspending/promising, not a task trap) and scheduled the one missing
  experiment: host-Promise REJECTION delivery through a suspended zena
  stack (never empirically pinned). F3-slice1 design phase DONE; ticket
  open pending operator go/no-go on implementation.

- **2026-09-16 — F1d landed (5th fork patch)**: component flavor of
  zena:error selected by `--dce` via a new stdlib-manifest axis (console
  swap seam extended). Lazy capture rejected on evidence: trace consumers
  read post-unwind (backtrace_test.zena, zena-cli main.rs). Exception-using
  components now componentize with --dce alone; handles-zena guard deleted
  (identical output). Suite 2304/0. F2 inherits a one-line re-key path for
  a real --target component.

- **2026-09-16 — F1c root-caused and fixed (4th fork patch)**: DCE's
  usage analysis tracked only `==`/`!=` among resolved operator methods
  (usage.ts:844), so `String.operator+` was culled while its MethodInfo
  kept sentinel index -1 — encoded by call-site lowering as 0x7f, i.e.
  the mysterious "unknown function 127". Not an index-space desync at
  all. Fix: track all resolvedOperatorMethod calls (incl. mangled
  overloads and compound assignment). Suite 2299 pass / 0 fail with new
  operator-DCE regression tests. Verified: concat under --dce now
  validates (jcona repro green). Lesson stacking with the div bug: DCE
  + overload/operator resolution is zena's most fragile interaction.

- **2026-09-16 — exceptions defeat --dce's env-import elimination**: the
  first exception-USEING zena component (examples/handles-zena) keeps
  `env.captureStackTrace` even under `--dce` — throwing constructs Error,
  and `Error.new` calls `__captureStackTrace()`, so the externref import
  is legitimately rooted. Workaround landed in the example: a guarded
  WAT rewrite replacing the import with a local `ref.null extern`
  function (at-most-once, shape-tested). Implication: EVERY realistic
  zena component (try/catch is core) needs this until the fork makes
  stack-trace capture lazy/optional (the E1-era `#stackTrace = null`
  stdlib variant, now with evidence it's load-bearing) or jcona build
  absorbs the rewrite. Ticketed zenajco-f1d.

- **2026-09-16 — resource-table demo root-caused the browser quirk**:
  examples/resource-tables (standalone, no otel) shows every
  `get-stdout()` returning an OWN handle bound to the **same shared
  stdout singleton** in both shims (two table reps, one JS object —
  exposed by the codemod's captureTables). The browser shim's
  `OutputStream` flips `#open=false` on dispose, so dropping ANY handle
  closes stdout for all surviving handles -> the `{tag:"closed"}` we'd
  been working around is a **shared-singleton + own-handle mismatch**,
  not a guest bug. Node's shim has no such flag, so it never showed.
  Precise mechanism ready for the upstream jco/preview2-shim issue.
  Also learned: trivial components carry TWO handle tables (table[0]
  always empty, table[1] real) — read snapshots accordingly.

- **2026-09-16 — host introspection LEAD landed + verified**: tier 1
  (`packages/jcona-observe`: every WASI call, resource lifecycle, shared
  sink with jcona-otel) and tier 2 (`jcona transpile
  --expose-resources`: post-transpile codemod filling the generated
  `_util` — which upstream ships EMPTY — with live resource-table
  snapshots, frozen copies, jco-version shape-guarded). Demo
  `examples/observe-zena`: interleaved guest spans + host dispatch +
  liveHandles=2 table snapshot, Node + browser. Upstream PR sketch
  scoped file:line into jco @c03204df (transpile_bindgen.rs:679-746,
  intrinsics/resource.rs:94-110, esm_bindgen.rs:202-287, …);
  recommended upstream shape: per-instantiate() inspector over
  module-level registry. Follower ticket (wasmtime ResourceTable
  snapshot API) remains open.

- **2026-09-15 — otel landed; two ABI preconceptions corrected**: (1)
  `wasi:otel/tracing` has **no resources** — the streams/i32-handle precedent
  didn't transfer; it's flat params + hand-built record images (the 168-byte
  span-data image with documented offsets lives in lib/zena/otel/otel.zena —
  a reusable map for any SDK-less guest). (2) Indirect *import* results use a
  **trailing return-area param** (`[i32] -> []`, host writes into guest
  memory via the guest's cabi_realloc) — the mirror image of export-side
  indirect results (`[] -> [i32]`). Also: wasi-otel's push-whole-span-data
  design is hostile to generated-SDK-less guests; its wkg.lock pins
  wasi:clocks@0.2.0 vs real 0.2.12 trees (upstream friction worth raising).

- **2026-09-15 — interop matrix green; three findings**: (1) jco shims are
  **version-blind** — `wasi:random/random@0.2.6` imports are satisfied by
  the shim's plain-JS interfaces, no `--map` or version-matching needed;
  (2) **zena cannot satisfy interface exports** (mangled `ns:pkg/iface#func`
  core export names) — flat world exports and interface imports both work;
  this is fork candidate F5 and the only gap behind the two static-composition
  SKIP cells; (3) `wac plug` composes **wasm-gc zena components without
  complaint** — the GC worry never materialized; the rust-gen→zena-consumer
  static composition closes to a component with **zero remaining imports**.
  Also: jco's `-I` instantiation mode disables shim auto-wiring entirely
  (all imports from the `imports` object) — the natural host-composition
  API, worth documenting upstream. And a wasm32-wasip2 build footgun:
  building a cdylib command alone can clobber the lib artifact with an
  empty-world variant (feature unification) — `crates/*/build.sh` orders
  builds to avoid it.

- **2026-09-15 — indirect string results**: canonical ABI `MAX_FLAT_RESULTS=1`
  — a `string` result is a single i32 pointing at an 8-byte `(ptr, len)`
  area in memory, **not** a direct `(ptr, len)` multi-value return. Related
  trap: a cryptic `component new: failed to validate component output …
  expected i64, found i32` usually means the **core** module itself is
  invalid — run `wasm-tools validate` on the core module before blaming the
  component-ization step. (Found wiring emoji-zena `pick()`.)
- **2026-09-15 — fork codegen bug fixed (2nd fork patch)**: under `--dce`,
  `@intrinsic` overload families (zena:math `div`) were culled to a single
  wrong overload, emitting `i64.div_u` over i32 operands → invalid core
  module. Fix: register whole intrinsic families in pass 0. Compiler suite
  2285 pass / 0 fail.
- **2026-09-15 — browser shim quirk**: preview2-shim *browser* build throws
  `{tag:"closed"}` when a guest `[resource-drop]s` the stdout output-stream
  after writing; the Node build does not. `get-stdout` returns an owned
  handle so the drop is legal guest behavior — candidate upstream
  preview2-shim issue. Workaround in our guests: don't drop process-lifetime
  stdio handles. (Found via `examples/interop-jshost` browser run.)
- **2026-09-15 — p2-direct contract verified in zena**: a zena `--dce`
  host-target module with inline `@external("wasi:…@version", "…")`
  declarations embeds and runs under jco in Node **and** browser once the
  fork type-identity fix (F1) is in.
