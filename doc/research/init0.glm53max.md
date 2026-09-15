---
type: Research
title: zena on jco — stage setting
description: Why we want zena programs hosted by jco (Node + browser), what exists today on both sides, and the candidate paths being explored.
resource: https://github.com/rektide/zena-jco
tags: [zena, jco, wasm, wasm-gc, component-model, wasi]
status: draft
generated:
  by: agent:glm53max
  at: 2026-09-14
verified: { by: unverified }
stale_after: 2026-12-01
sources:
  - id: zena-fork
    resource: /home/rektide/src/zena-jco-fork
    title: elematic/zena fork (jj checkout)
    author: human:rektide
  - id: jco-archive
    resource: /home/rektide/archive/bytecodealliance/jco
    title: bytecodealliance/jco local archive
    author: org:bytecodealliance
---

# zena on jco — stage setting

## What we're doing

[zena](https://github.com/elematic/zena) is a statically-typed language that
compiles to core **WebAssembly GC** modules (GC structs/arrays, typed function
references, GC exceptions). Today a zena program has two execution hosts:

1. **Node.js** (`zena build --target host`): the core module imports bespoke
   `zena` host functions (e.g. a `console` module receiving strings as
   `externref` + length, read back through an auto-exported
   `$stringGetByte` getter), wired up by `@zena-lang/runtime`.
2. **wasmtime** (`zena build --target wasi` via `packages/zena-cli`, or plain
   `wasmtime run`): the core module imports `wasi_snapshot_preview1` at a
   hand-flattened core ABI.

We want a **third host: jco** — Bytecode Alliance's JS component toolchain.
The dream: zena program → WebAssembly **component** → `jco transpile` → plain
ES modules that run **in Node and in the browser**, with a standards-based
host surface (WIT / WASI) instead of bespoke zena host imports. jco is the
host; the browser is a first-class target, not an afterthought.

## Repositories

| Repo | Role |
| --- | --- |
| `~/src/zena-jco` (this repo) | experiments, jco host work, research docs (`doc/research/`) |
| `~/src/zena-jco-fork` | fork of elematic/zena, free to hack — where compiler-side changes would land, if any earn it |
| `~/archive/bytecodealliance/jco` (+ siblings) | local archives used as primary research sources |

## What exists — zena side

From the fork's own design docs (see
[`component-model.md`](../../../zena-jco-fork/docs/design/component-model.md) —
"Track W"):

- **WIT lexer/parser/resolver: done.** Parses and resolves the real WASI 0.2
  and 0.3 trees (211/211 wasm-tools UI tests).
- **Everything else component-shaped: unbuilt.** No bindgen, no canonical ABI
  lift/lower, no component emission. `--target wasi` emits a *core* module
  importing `wasi_snapshot_preview1`, used via hand-written `@external`
  declarations at the already-flattened core ABI with manual memory pokes.
- The Track W plan itself targets **p2 first** (synchronous `wasi:http`
  incoming-handler) because p3 needs async, which doesn't exist in zena yet.
- Host-string strategy today is the V8-recommended `externref` +
  exported-getter pattern (`host-interop.md`), i.e. exactly the kind of
  bespoke host surface a component boundary would replace.

## What exists — jco side

jco (v1.33.0 installed here; archive at a recent main) is a mature multi-tool:

- `jco transpile`: component → ES module + core wasm, for Node **and browser**
- `jco run` / WASI shims: `preview2-shim` (Node + browser mappings of WASI
  P2), `preview3-shim` (Node), plus `jco scaffold`, `jco componentize` via
  componentize-js, wasm-tools available *as a component from JS*
- Recent work: `node:vm` guests, preview3 shim, portable VM support

Crux question: **what happens when the guest core module inside the component
uses WasmGC?** Nothing in jco's docs obviously forbids it — the transpiled
wrapper instantiates the guest on the platform engine (V8/JSC/SpiderMonkey,
all of which ship WasmGC now) — but this needs verification end to end.

## Candidate paths (to be validated by experiment)

1. **E0 — flat world, zero compiler changes.** A zena module exporting only
   flat numerics (`add: func(a: s32, b: s32) -> s32`) needs *no* canonical ABI
   machinery. `wasm-tools component embed/new` with a tiny WIT world, then
   `jco transpile`, then run in Node. Proves the GC-guest-under-jco pipeline.
2. **E1 — hand-written canonical ABI in zena source.** Strings across the
   boundary via a hand-written `cabi_realloc` + lift/lower using `zena:memory`
   (linear memory from a GC module). No compiler changes; a zena library.
3. **E2 — p1 adapter shortcut.** zena's existing `--target wasi` output +
   the official `wasi_snapshot_preview1`→p2 adapter component +
   `wasm-tools component new` → jco with WASI shims. Fastest route to
   "zena WASI program running under jco in a browser tab" if the ABI meshes.
4. **E3 — browser demo.** Any of the above in a served page.
5. **Track W — the real thing, in the fork.** WIT bindgen + canonical ABI +
   component emission in the compiler. Heavy; only pieces that experiments
   prove necessary should land in the fork.

## Vectors / directions from the operator

- Host is jco; browser support is a requirement, not a nice-to-have.
- Prefer figuring out + planning here; only land things in the fork that
  clearly belong there.
- Research prompt, two sentences: *What exactly does jco require of a guest
  component and its core module, and does anything in its transpiled
  instantiation path break on WasmGC guests? Separately, what is the cheapest
  bridge from zena's current core-module output to a valid component — flat
  world, hand-written canonical ABI in zena source, or the preview1 adapter?*

## Open questions

- Does `wasm-tools component embed/new` (1.245.1 here) accept GC core modules
  without feature-flag fuss?
- Does zena's compiler auto-emit extra exports (`$stringGetByte`) that pollute
  embedding, and does DCE remove them when unused?
- Which WASI interfaces do jco's browser shims actually implement, and what
  does filesystem/stdio look like there?
- Where do fork-side changes (if any) belong vs zena-jco-side host shims?

## Companions

- [`jco-host.glm53max.md`](jco-host.glm53max.md) — jco architecture deep dive
- [`zena-targets.glm53max.md`](zena-targets.glm53max.md) — exact emission surface of zena's targets
- [`getting-started.glm53max.md`](getting-started.glm53max.md) — kickoff, validated facts, ladder, next actions
- Experiment write-ups: [`e0-flat-world.glm53max.md`](e0-flat-world.glm53max.md),
  [`e1-zena-flat.glm53max.md`](e1-zena-flat.glm53max.md),
  [`e2-zena-wasi.glm53max.md`](e2-zena-wasi.glm53max.md)
