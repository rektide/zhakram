---
type: Research
title: zena on jco — getting started
description: Kickoff and current state for hosting zena programs as WebAssembly components on jco (Node + browser). Validated facts, experiment ladder, the known blocker, where work lands, and next actions.
resource: https://github.com/rektide/zena-jco
tags: [zena, jco, wasm-gc, component-model, wasi, kickoff]
status: draft
generated:
  by: agent:glm53max
  at: 2026-09-14
verified: { by: unverified }
stale_after: 2026-12-01
sources:
  - id: init0
    resource: /home/rektide/src/zena-jco/doc/research/init0.glm53max.md
    title: stage setting
    author: agent:glm53max
---

# zena on jco — getting started

**Mission**: run zena programs as WebAssembly Components whose host is jco —
`jco transpile` ES-module output — in Node.js **and** the browser, replacing
"node + bespoke runtime imports" and "wasmtime" as the only hosts.

**Repos**: work happens here (`~/src/zena-jco`: experiments, host tooling,
`doc/research/`); `~/src/zena-jco-fork` (fork of elematic/zena) is where
compiler/stdlib changes land **only if experiments prove they're needed**.

## What we know — validated facts

| # | Fact | Evidence |
| --- | --- | --- |
| 1 | A core wasm module using WasmGC internally passes `wasm-tools component embed` + `component new` (wasm-tools 1.245.1) with no feature flags | E0, [`e0-flat-world.glm53max.md`](e0-flat-world.glm53max.md) |
| 2 | `jco transpile` (jco 1.33.0) output for such a component runs in Node 26 using only plain `WebAssembly.compile/instantiate` + `WebAssembly.Global`; JSPI paths are feature-detected, not required | E0 |
| 3 | Same transpiled component runs in Chromium (147, via playwright `chrome` channel) served over http — the `"use components"` directive is inert today | E0 browser probe |
| 4 | **GC guests are verified on Node + Chrome + Firefox**, including GC exceptions (`try_table`/exnref), zero engine flags — jco validates with `WasmFeatures::WASM3` and emits guest modules verbatim | jco deep dive, [`jco-host.glm53max.md`](jco-host.glm53max.md) |
| 5 | **A real zena program runs under jco in all three host modes** — `jco run`, transpiled ES module in Node, and browser page with preview2-shim browser builds (no bundler, import map only) | E2, [`e2-zena-wasi.glm53max.md`](e2-zena-wasi.glm53max.md) |
| 6 | Recipe: `zena build --target wasi --dce` + one WAT fix + `wasm-tools component new --adapt wasi_snapshot_preview1=<jco-vendored command adapter>` → component importing full wasi p2 set | E2 |
| 7 | **`--dce` is mandatory** for componentization: the prelude imports `zena:error`/`zena:console` whose `env.*`/`console.*` host hooks have externref signatures that can never cross a component boundary | E1 + addendum, [`e1-zena-flat.glm53max.md`](e1-zena-flat.glm53max.md) |
| 8 | **Fork candidate: "preRec-for-exports"** — zena emits defined-func types in one big rec group; nominal type identity breaks the p1 adapter's `_start` match ("expected (func) / found (func)"). Compiler already solves this for imports; extending to exported entry points is small + upstreamable | E2, [`zena-targets.glm53max.md`](zena-targets.glm53max.md) §6 |
| 9 | Exception-using zena guests need `jco transpile --bindgen-enable-wasm-exnref` (exnref masked off by default); `jco opt` on GC components needs `-- --enable-gc --enable-exception-handling --enable-reference-types --enable-tail-call` | [`jco-host.glm53max.md`](jco-host.glm53max.md) |
| 10 | zena's `--target wasi` emits: unconditional `fd_write` + exported `memory`, strings via a baked 64-byte iovec protocol, no `cabi_realloc`; other p1 imports (fs: 13, cli: 5, clocks) are use-gated; export names are clean/unmangled | [`zena-targets.glm53max.md`](zena-targets.glm53max.md) |
| 11 | Hand-written canonical ABI in zena source is feasible today (`zena:memory` incl. i64 ops, `FreeListAllocator`, `String.getByteAt`/`fromByteArray`) — no capability gaps for strings | [`zena-targets.glm53max.md`](zena-targets.glm53max.md) §5 |
| 12 | zena's WIT parser is done and parses real WASI 0.2/0.3 trees; bindgen/canonical-ABI/component-emission are unbuilt (upstream "Track W" plan) | fork `docs/design/component-model.md` |

## The ladder

| Rung | What | Status |
| --- | --- | --- |
| E0 | Handcrafted GC core module → component → jco → Node | ✅ done |
| E0b | Same, in a browser page | ✅ done (headless Chromium) |
| E1 | Real zena module (flat world) → component → jco → Node | ✅ done via `--dce` (E1 addendum; agent-verified embed/new round-trip) |
| E2 | zena `--target wasi` + p1 command adapter → WASI component → jco → Node + browser | ✅ done — "Hello from a zena component!" in `jco run`, Node ES module, and Chromium |
| E2.5 | Fork: preRec-for-exports patch (kills the WAT fix at the source) | designed, not implemented — top fork candidate |
| E3 | Strings/records across a *custom* world boundary: hand-written canonical ABI (`cabi_realloc` + lift/lower) in zena source | not started; feasible per zena-targets §5 |
| E4 | fs/args through the adapter (`zena:fs`, `zena:cli` kept by DCE); browser FS (OPFS/in-memory) configuration | not started |
| E5 | Browser demo polished (real page, not scratch); reactor-adapter library-shaped components after E2.5 | not started |
| Track W | Real bindgen + component emission in the compiler (upstream plan) | long-term; fork contributions only where our experiments show the need |

## Where things land

- **zena-jco (this repo)**: componentization/host pipeline (`wasm-tools` + jco
  invocation — note `jco new --embed/--adapt` embeds wasm-tools entirely, no
  system binary needed), WIT worlds, the browser demo, research docs.
  The E2 `run.sh` is the seed of a `zena-jco build` tool.
- **zena-jco-fork**: the preRec-for-exports patch (E2.5) — small, upstreamable,
  driven by a real interop failure we hit. Possibly later: DCE ergonomics
  (default-on for component workflows, or a `--target component` that bakes
  in `--dce` + wasi-no-fd_write for library worlds).
- **Upstream (elematic/zena)**: fork patches shaped as PRs; Track W remains
  upstream's plan — our hand-written canonical ABI (E3) doubles as its
  prototype.

## Next actions

1. E2.5: implement preRec-for-exports in the fork, delete the WAT fix from
   E2's script, re-verify.
2. E3: `greet: func(name: string) -> string` world with hand-written
   `cabi_realloc` + lift/lower in zena source; jco transpile both legs.
3. E4: fs/args through the p1 adapter; pick browser FS story (OPFS vs
   in-memory) for the demo.
4. Promote `.test-agent/e2-zena-wasi/run.sh` into a real `zena-jco` CLI/task
   (src/zena-jco.ts is sitting empty for exactly this).
5. Doc-pass: index README for `doc/research/`, cross-link jco-host ↔
   zena-targets ↔ experiment docs (done incrementally above).

## Doc index (`doc/research/`)

- [`init0.glm53max.md`](init0.glm53max.md) — stage setting, mission, vectors
- [`e0-flat-world.glm53max.md`](e0-flat-world.glm53max.md) — pipeline proof (Node + browser)
- [`e1-zena-flat.glm53max.md`](e1-zena-flat.glm53max.md) — zena emission surface, env-import blocker + `--dce` addendum
- [`e2-zena-wasi.glm53max.md`](e2-zena-wasi.glm53max.md) — **the milestone**: zena WASI program under jco, Node + browser
- [`jco-host.glm53max.md`](jco-host.glm53max.md) — jco architecture, GC-guest verification, engine baselines, flags
- [`zena-targets.glm53max.md`](zena-targets.glm53max.md) — zena compiler/target internals, shortest paths ranked
