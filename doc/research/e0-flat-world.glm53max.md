---
type: Research
title: "E0 — flat-world WasmGC component under jco (validated)"
description: Handcrafted WasmGC core module passes wasm-tools componentization and runs under jco transpile output in Node — the core feasibility question for zena-on-jco is answered yes at the simplest level.
resource: https://github.com/rektide/zena-jco
tags: [zena, jco, wasm-gc, component-model, experiment]
status: stable
generated:
  by: agent:glm53max
  at: 2026-09-14
verified: { by: unverified }
stale_after: 2026-12-01
sources:
  - id: e0-artifacts
    resource: /home/rektide/src/zena-jco/.test-agent/e0-flat-world
    title: E0 scratch experiment (runnable pipeline)
    author: agent:glm53max
---

# E0 — flat world, GC core module: **PASSES**

Question: does a core wasm module that *uses WasmGC instructions internally*
survive `wasm-tools component embed/new` and run as a **jco-hosted component**
in Node?

**Yes.** Verified 2026-09-14 with wasm-tools 1.245.1, jco 1.33.0, Node 26.6.

## The module

`add(a, b)` deliberately round-trips the sum through a GC struct
(`struct.new` / `struct.get`) so the pipeline must carry GC instructions:

```wat
(type $cell (struct (field (mut i32))))
(func (export "add") (param i32 i32) (result i32)
  ... struct.new $cell ... struct.get $cell 0 ...)
```

World (flat numerics — canonical ABI lowering for `s32` params/result is
identity, so no `cabi_realloc`/memory/post-return needed):

```wit
package rektide:zena-jco@0.1.0;
world calculator { export add: func(a: s32, b: s32) -> s32; }
```

## Pipeline (all in `.test-agent/e0-flat-world/run.sh`)

```sh
wasm-tools parse    add-gc.wat -o add-gc.core.wasm
wasm-tools component embed world.wit add-gc.core.wasm -o add-gc.embedded.wasm
wasm-tools component new  add-gc.embedded.wasm -o add-gc.component.wasm
jco transpile add-gc.component.wasm -o out
node run-node.mjs   # add(2,3) === 5 ✅
```

No feature flags were needed at any stage; wasm-tools 1.245.1 validates and
embeds GC core modules by default.

## What the transpiled output requires of the engine

From reading the generated `add-gc.component.js` (84 KiB runtime shim):

- Plain `WebAssembly.compile` / `WebAssembly.instantiate` — no
  `WebAssembly.Function`, no type reflection, for this simple world.
- `WebAssembly.Global` for internal flags.
- JSPI-adjacent code paths are **feature-detected**
  (`typeof WebAssembly.SuspendError === 'function'`), not required.
- Top-level `await $init` before exports are usable (ESM only).
- Module starts with the `"use components"` directive — semantics TBD for
  browsers (see open questions).

## Consequences for the plan

- The **E0 rung for real zena output** (next experiment) is now purely about
  zena's emission surface (auto-exports like `$stringGetByte`, export
  mangling), not about jco/wasm-tools capability.
- The hand-written-canonical-ABI rung (strings) is the next real lift; jco
  side imposes no obstacle found so far.

## Open questions

- Does `"use components"` + this shim actually run in current browsers
  (Chrome/Safari/Firefox), and is file:// vs http(s) serving required for
  `WebAssembly.compile` from inlined base64?
- Does anything change when the world imports WASI interfaces (shim wiring in
  browser builds)?

## Related

- [`init0.glm53max.md`](init0.glm53max.md) — stage setting, path ladder
