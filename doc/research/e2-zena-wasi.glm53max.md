---
type: Research
title: "E2 — zena WASI program under jco in Node and browser (validated)"
description: A zena program compiled with --target wasi --dce, componentized via jco's vendored preview1 adapter, transpiled by jco, runs under jco run, as an ES module in Node, and in Chromium with browser WASI shims — the mission's core milestone.
resource: https://github.com/rektide/zena-jco
tags: [zena, jco, wasm-gc, component-model, wasi, experiment]
status: stable
generated:
  by: agent:glm53max
  at: 2026-09-14
verified: { by: unverified }
stale_after: 2026-12-01
sources:
  - id: e2-artifacts
    resource: /home/rektide/src/zena-jco/.test-agent/e2-zena-wasi
    title: E2 reproducible pipeline (run.sh)
    author: agent:glm53max
  - id: zena-targets
    resource: /home/rektide/src/zena-jco/doc/research/zena-targets.glm53max.md
    title: zena emission-surface deep dive
    author: agent:glm53max
---

# E2 — zena WASI program under jco: **VALIDATED (Node + browser)**

The zena-on-jco mission's core milestone is real. Verified 2026-09-14 with
zena bootstrap CLI (fork @ main), wasm-tools 1.245.1, jco 1.33.0,
Node 26.6.0, Chromium 147 (playwright `chrome` channel).

## The program

```zena
// start2.zena
import { console } from 'zena:console';
export let _start = (): void => { console.log("Hello from a zena component!"); };
```

## Pipeline (`.test-agent/e2-zena-wasi/run.sh`, fully reproducible)

```sh
zena build start2.zena --target wasi --dce -o start2.wasi.wasm
#    + one WAT fix (below)
wasm-tools component new start2.fixed.wasm \
  --adapt wasi_snapshot_preview1=<jco>/lib/wasi_snapshot_preview1.command.wasm \
  -o start2.component.wasm
jco run  start2.component.wasm          # → "Hello from a zena component!"
jco transpile --bindgen-enable-wasm-exnref start2.component.wasm -o transpiled
node transpiled/run-node.mjs            # → same
# browser: serve repo root, import map → preview2-shim browser builds
#          → STATUS: E2-BROWSER-OK
```

The component imports the full wasi p2 set (@0.2.12: cli/environment, exit,
stdin/out/err, clocks, filesystem, io); `jco transpile` wires
`@bytecodealliance/preview2-shim` for Node *and* ships browser builds
(`dist/browser/*.js` via conditional exports) — in the browser the page uses
**no bundler**, just an import map mapping the three bare shim specifiers at
the browser builds.

## The three learnings that made it work

1. **`--dce` is mandatory.** The prelude imports `zena:error` + `zena:console`
   into every module; without DCE their `env.*`/`console.*` host-hook imports
   (externref signatures) make componentization impossible
   ([`e1-zena-flat.glm53max.md`](e1-zena-flat.glm53max.md)). With `--dce` the
   wasi build is exactly: `fd_write` import + `memory` export + `_start` +
   `$string*` helpers.
2. **Rec-group type identity vs the command adapter (real zena interop bug,
   fork candidate).** zena emits defined-function types inside one big `rec`
   group; the p1 *command* adapter instantiates the guest with
   `(import "__main_module__" "_start" (func))` and instantiation-argument
   matching is nominal — rec-group membership is part of type identity, so
   `(func)`-in-rec ≠ standalone `(func)` and `component new` fails with the
   maddening *"expected: (func) / found: (func)"*. Workaround (in run.sh):
   strip the `(type N)` annotation from the `_start` function in printed WAT
   so the parser re-types it standalone. **Durable fix: extend the existing
   `preRec` machinery to exported entry-point types** — the compiler already
   does exactly this for imports, with the same rationale in its comments
   (`codegen/functions.ts:512-514`). Small, upstreamable, benefits every
   zena-WASI consumer, not just jco.
3. **`--bindgen-enable-wasm-exnref` for exception-using guests.** zena emits
   new-style EH (`try_table`/exnref); jco masks exnref **off** by default at
   transpile. Any zena program with `throw`/`try` needs this flag (or jco
   changes its default). See [`jco-host.glm53max.md`](jco-host.glm53max.md).

Also noted: `_start` must be `(): void` against the command adapter, and
extra unlifted exports (`$string*`, `zena_exception` tag when exceptions are
used) do not obstruct `component new`.

## What this unlocks

- zena programs now have a **third host**: jco — in Node *and* browser, with
  WASI provided by jco's shims rather than bespoke zena host imports.
- The p1 adapter route means *no guest-side canonical ABI work is needed*
  for command-shaped programs: zena's existing flattened-p1 surface is
  adapted wholesale.
- fs/args (via `zena:fs`, `zena:cli` p1 imports kept by DCE when used)
  should flow through the same adapter — untested yet, next step.

## Open questions

- Does the *reactor* adapter + custom-world export (library-shaped
  components) work after the preRec fix? (Failed pre-fix on the same
  nominal-type class of error.)
- Browser filesystem: preview2-shim browser builds offer in-memory/OPFS
  adapters — how are they selected/configured?
- `jco opt` on GC components needs `-- --enable-gc …` (see jco-host doc);
  fold into our pipeline when we start optimizing.

## Related

- [`zena-targets.glm53max.md`](zena-targets.glm53max.md) — §6 documents this
  path verified under wasmtime; E2 adds the jco legs
- [`jco-host.glm53max.md`](jco-host.glm53max.md) — engine baselines, exnref
  flag, opt flags
- [`getting-started.glm53max.md`](getting-started.glm53max.md) — ladder
