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
| 4 | zena `--target wasi` already emits a near-componentizable core module: single p1 import (`fd_write`), exported linear `memory`, clean export names (`add`) | E1, [`e1-zena-flat.glm53max.md`](e1-zena-flat.glm53max.md) |
| 5 | **Blocker**: zena always emits `env.captureStackTrace() -> externref` + `env.formatStackTrace(anyref) -> externref`; `component new` rejects unresolvable imports, and adapters can't rescue them — wit-component adapter shims support only i32/i64/f32/f64 (`unreachable!()` otherwise, wasm-tools `encoding.rs` ~2845) | E1 |
| 6 | externref/anyref can never appear in a WIT signature, so *any* host-hook import shaped like zena's is permanently un-componentizable; such hooks must be absent from component-targeted builds | E1 (architectural) |
| 7 | zena's `--target host` additionally imports a `console` module incl. `log_string(externref, i32)` — same class of problem | E1 |
| 8 | zena stdlib already swaps console implementation per target (`console/host.zena` vs `console/wasi.zena` via `resolveStdlibImport`, `packages/cli/src/lib/host.ts:77`) — an existing seam for target-conditional emission | E1 |
| 9 | zena's WIT parser is done and parses real WASI 0.2/0.3 trees; bindgen/canonical-ABI/component-emission are unbuilt (upstream "Track W" plan) | fork `docs/design/component-model.md` |

(Facts 10+ — jco architecture details, engine baselines, WASI shim surface in
browser vs Node — pending the jco deep-dive doc, in flight.)

## The ladder

| Rung | What | Status |
| --- | --- | --- |
| E0 | Handcrafted GC core module → component → jco → Node | ✅ done |
| E0b | Same, in a browser page | ✅ done (headless Chromium) |
| E1 | Real zena module (flat world) → component → jco → Node | 🟡 blocked at `env` imports (fact 5); everything else verified |
| E1.5 | Fork: target-conditional stdlib so `env` hooks are absent for component-targeted builds | designed, not implemented — top fork candidate |
| E2 | zena `--target wasi` + official p1 reactor adapter (ships inside jco) → WASI component → jco shims → Node + browser | not started; unblocked by E1.5 |
| E3 | Strings across the boundary: hand-written canonical ABI (`cabi_realloc` + lift/lower) in zena source using `zena:memory` | not started; independent of E1.5 |
| E4 | Browser demo page of a WASI-shaped zena program | after E2/E3 |
| Track W | Real bindgen + component emission in the compiler (upstream plan) | long-term; fork contributions only where our experiments show the need |

## Where things land

- **zena-jco (this repo)**: componentization/host pipeline (`wasm-tools` + jco
  invocation), WIT worlds, experiments, adapters we author, browser demo,
  research docs.
- **zena-jco-fork**: only emission-side changes proven necessary — currently
  one clear candidate (E1.5: import-free error/stdlib variant for component
  targets, reusing the console swap seam). Possibly DCE rooting fix later.
  Anything we hack there should be shaped as upstreamable PRs.
- **Upstream (elematic/zena)**: nothing directly; fork work is our lab.

## Next actions

1. Land E1.5 in the fork (target-conditional error module; smallest change:
   make `--target wasi` use an env-import-free error variant, matching the
   console precedent) and green E1 end to end.
2. Integrate the two research docs (jco host architecture; zena emission
  surface) when the agents finish; do a doc-pass cross-linking everything.
3. Attempt E2 (p1 adapter path) — highest payoff per unit of work, since
   jco's WASI shims then give us stdio/fs in Node *and* browser.
4. Spike E3 string lowering to size the hand-written-canonical-ABI approach
   against waiting for upstream Track W bindgen.

## Doc index (`doc/research/`)

- [`init0.glm53max.md`](init0.glm53max.md) — stage setting, mission, vectors
- [`e0-flat-world.glm53max.md`](e0-flat-world.glm53max.md) — pipeline proof (Node + browser)
- [`e1-zena-flat.glm53max.md`](e1-zena-flat.glm53max.md) — zena emission surface + the env-import blocker
- `jco-host.*.md` — jco architecture deep dive (in flight)
- `zena-targets.*.md` — zena compiler/target internals deep dive (in flight)
