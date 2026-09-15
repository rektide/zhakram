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
| W1 | p2-direct zena host kit | WAT guest ✅ green ("hello p2" in Node); **zena leg blocked on F1** | F1 |
| W2 | emoji trio | WIT+Rust in flight (agent); zena leg awaits W3 | W3, F1 |
| W3 | `lib/cabi.zena` — canonical ABI in zena source | not started; design known (zena-targets §5) | — |
| W4 | interop trio (jshost / static / matrix) | jshost seeded; static in flight (agent); matrix after parts | W1, W2 |
| W5 | `packages/` pipeline tooling | not started; pipeline proven as shell scripts | W1–W3 stabilizing |
| F1 | fork: type-identity fix (preRec generalization) | **G agent working now** — unblocks W1 zena leg + kills E2 WAT hack | — |
| F2 | fork: `--target component` | designed sketch; decide after F1 | F1 |
| F3 | fork: async/JSPI-first host | strategy decision with evidence | W7 |
| W7 | p3 frontier characterization | not started | — |

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
- `emoji-rs`: Rust impl (cargo-component, p2-native) — in flight.
- `emoji-zena`: zena impl — requires string return through the canonical
  ABI (W3): lower `String` into guest memory via `cabi_realloc`, return
  `(ptr, len)`, free in `cabi_post_pick`.
- Consumers on all sides print to **WASI stdout** (per the operator: "a wasi
  stdout on the reader, whatever stdout is") — zena consumers via W1, Rust
  consumers via their own p2 bindings, JS consumers via console.

### W3 — `lib/cabi.zena`

The canonical ABI written in zena source over `zena:memory` +
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

1. **F1 lands** → W1 zena leg green; delete WAT hack from E2/E5 scripts.
2. **W3 cabi.zena** → emoji-zena `pick()` green in Node (+ browser page).
3. **W4 matrix harness** starts with available cells; rust-agent deliveries
   (emoji-rs, rng-rs, consume-rs, interop-static) slot in.
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

- Rust leg (emoji-wit, emoji-rs, rng-rs, consume-rs, interop-static) — background agent.
- Fork F1 type-identity fix — G agent.
