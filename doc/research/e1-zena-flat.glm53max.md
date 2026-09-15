---
type: Research
title: "E1 — real zena output toward a jco component: blocked at `env` imports"
description: zena-compiled WasmGC module gets through embed but component new rejects the always-emitted env::captureStackTrace/formatStackTrace host hooks — externref signatures cannot cross a component boundary, and adapter shims panic on non-numeric types. Documents the exact emission surface and candidate fixes.
resource: https://github.com/rektide/zena-jco
tags: [zena, jco, wasm-gc, component-model, experiment, blocker]
status: stable
generated:
  by: agent:glm53max
  at: 2026-09-14
verified: { by: unverified }
stale_after: 2026-12-01
sources:
  - id: e1-artifacts
    resource: /home/rektide/src/zena-jco/.test-agent/e1-zena-flat
    title: E1 scratch experiment
    author: agent:glm53max
  - id: wasm-tools-encoding
    resource: /home/rektide/archive/bytecodealliance/wasm-tools
    title: wasm-tools archive (1.246.2), wit-component encoding.rs
    author: org:bytecodealliance
---

# E1 — real zena output as a jco component: **blocked at `env` imports**

E0 (handcrafted GC module) proved the pipeline. E1 repeats it with the real
zena compiler (`packages/cli`, bootstrap TS compiler) on a trivial
`add(a: i32, b: i32) -> i32`. Result: **one concrete, structural blocker** —
zena's always-emitted `env` host hooks — plus a clean map of everything else.

## zena emission surface (verified, wasm-tools 1.245.1)

`--target host`, trivial program that uses no stdlib explicitly:

```wat
(import "env" "captureStackTrace" (func (result externref)))
(import "env" "formatStackTrace" (func (param anyref) (result externref)))
(import "console" "log_i32" ...)
(import "console" "log_f32" ...)
(import "console" "log_string" ...)   ; (param externref i32) — externref!
(import "console" "error_string" ...) ; ... 5 more string loggers
(export "add" ...)                     ; clean, unmangled export name ✓
(export "$stringGetByte" ...) (export "$stringGetLength" ...)
(export "$stringCreate" ...)  (export "$stringSetByte" ...)
```

`--target wasi`:

```wat
(import "wasi_snapshot_preview1" "fd_write" ...)
(import "env" "captureStackTrace" ...)  ; still present
(import "env" "formatStackTrace" ...)
(export "memory" (memory 0))            ; linear memory IS exported ✓
(export "add" ...) (export "$string*" × 4)
```

Observations:

- The wasi target is already *near* componentizable: one p1 import, memory
  exported, canonical-ABI-shaped core.
- Export names are clean (`add`), not mangled. The four `$string*` helpers are
  extra exports — harmless for embedding (a world can ignore extra core
  exports? TBD) but worth pruning eventually.
- The wasi console goes through fd_write (`console/wasi.zena`,
  `@intrinsic("wasi_write_string")`), per the fork's
  `docs/design/console-wasi-strategy.md`.

## The blocker, precisely

1. `wasm-tools component embed` **succeeds** (import checking is deferred).
2. `wasm-tools component new` **fails**:

   ```
   failed to resolve import `env::captureStackTrace`
   module requires an import interface named `env`
   ```

3. Trying to satisfy `env` with a null-returning adapter module
   (`--adapt env=env-adapter.wasm`) **panics** wit-component:

   ```
   panicked at crates/wit-component/src/encoding.rs:2847
   internal error: entered unreachable work
   ```

   Cause (verified in the local wasm-tools archive, 1.246.2,
   `crates/wit-component/src/encoding.rs` ~2845): adapter shims map core types
   via `to_wasm_type`, which handles only `I32/I64/F32/F64` and hits
   `unreachable!()` otherwise. **externref/anyref in adapter-connected imports
   are structurally unsupported.**

Architectural reading: `env.captureStackTrace/formatStackTrace` are *host
runtime hooks* (exception stack-trace capture for `@zena-lang/runtime`).
externref/anyref can never be expressed in WIT, so these imports can never
appear in a componentizable module. For component embedding they must simply
not exist in the emitted core module. Same is true of the host target's
`console.log_string(externref, i32)`.

## Why the imports are always there (fork, not fully chased)

- Sources: `packages/stdlib/zena/error.zena:6-10` (`@external("env", …)`
  declares both hooks; `Error.new` eagerly calls `__captureStackTrace()`),
  `packages/stdlib/zena/console/host.zena` for the console ones.
- Codegen *is* DCE-gated (`#isUsed`, `packages/compiler/src/lib/codegen/index.ts:129`),
  but both hooks survive DCE even in a program that never touches `Error` —
  the usage analysis roots them somehow (unresolved: likely module-inclusion
  of `zena:error`/prelude marks exported classes used).
- The stdlib already has a **target-conditional module swap** for console:
  the CLI host resolves `zena:console` to `console/host.zena` vs
  `console/wasi.zena` (`packages/cli/src/lib/host.ts:77`,
  `resolveStdlibImport` from `@zena-lang/stdlib`), and the loader always
  includes `error.zena` for both targets.

### Local experiment (reverted)

Patching `Error.new` to `#stackTrace = null` in the fork's `error.zena` does
**not** remove the imports — confirming the DCE rooting issue. Reverted; the
fix must be at the selection/DCE level, not the class body.

## Candidate fixes (ranked, all fork-side except last)

1. **Target-conditional error module** — mirror the console pattern:
   `error/host.zena` (today's behavior) vs `error/component.zena` (no env
   imports, stack traces null), selected by `resolveStdlibImport`. Smallest
   conceptual change; introduces no new compiler machinery. Needs either a
   new `Target` value (`'component'`) or reuse of `'wasi'` (wasmtime runs
   fine without env hooks — arguably the wasi target should already use the
   import-free variant).
2. **Fix DCE rooting for `@external` declares** — make unused hook imports
   actually eliminable. Proper fix, benefits host target too, but requires
   understanding `usage.ts` rooting (time-boxed today; parked).
3. **Emission flag** (`--no-host-traces` or `--bare`) — quick but shallow;
   invites divergence between flag state and stdlib reality.
4. **Post-hoc binary strip in zena-jco** (host-repo-side tool) — mechanical
   import removal + index renumbering. WAT round-trip surgery was attempted
   and is fragile (anonymous funcs ⇒ numeric indices in exports, `(start n)`,
   47 numeric `call` sites). A proper wasmparser/wasm-encoder rewriter would
   work but is a maintenance liability vs fixing emission. Keep as fallback
   only.

## Artifacts

`.test-agent/e1-zena-flat/` — add.zena, world.wit, env-adapter.wat,
run.sh (fails at `component new` today), add.wasi.wasm / add.zena.wasm with
surfaces above.

## Related

- [`e0-flat-world.glm53max.md`](e0-flat-world.glm53max.md) — pipeline proven
  with handcrafted GC module
- [`init0.glm53max.md`](init0.glm53max.md) — ladder and stage setting
- Agent docs (in flight): `jco-host.*.md`, `zena-targets.*.md`
