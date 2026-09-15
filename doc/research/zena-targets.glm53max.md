---
type: Research
title: "Zena compiler targets — exact emission surface and paths to a Component"
description: What `zena build --target host|wasi` emits today, what pollutes component embedding, and ranked shortest paths to a jco-hostable component.
status: draft
generated: { by: agent:glm53max, at: 2026-09-14 }
verified: { by: unverified, at: never }
stale_after: 2026-12-01
sources:
  - id: zena-fork
    resource: file:///home/rektide/src/zena-jco-fork
    title: zena fork checkout (jj, read-only for this research)
  - id: empirical
    resource: file:///home/rektide/tmp-opencode/zena-jco-research
    title: build artifacts + wasm-tools/wasmtime experiments run 2026-09-14
---

# Zena targets: what the compiler emits, and the shortest paths to a component

Companion to [`jco-host.*.md`](./) (jco side). All `file:line` citations point
into the fork at `/home/rektide/src/zena-jco-fork` unless prefixed otherwise.
Everything under "Empirically verified" was built and run on 2026-09-14 with
Node v26.6.0, wasm-tools 1.245.1, wasmtime (nix), using the fork's prebuilt
bootstrap CLI (`packages/cli/lib/cli.js`) with outputs in
`/home/rektide/tmp-opencode/zena-jco-research` (fork untouched).

## 1. Design context (Track W and friends)

- [`docs/design/component-model.md`](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md)
  is the plan of record ("Track W"). Its status table (top of file) is precise:
  - **Built**: WIT lexer/parser/resolver (`packages/wit-parser`, 211/211
    wasm-tools UI tests; also parses all real WASI 0.2/0.3 trees — Part 9).
  - **Unbuilt**: `parseWit` integration into the compiler, WIT→Zena bindgen,
    canonical-ABI lift/lower, component emission, async. WASI today is
    "hand-written `@external` decls at the already-flattened core ABI with
    manual `i32.store8` pokes".
  - **Stage 6** (Part 8): component emission = "Encode the `component-type`
    custom section from the resolved WIT, export `memory` + `cabi_realloc`,
    then `wasm-tools component new`. **Shell out first**; a native encoder
    later if it earns its keep." Open question 7 asks whether wasm-tools is a
    permanent dependency.
  - **Stage 4**: canonical ABI builds `cabi_realloc` "on the existing
    `FreeListAllocator` in `stdlib/zena/memory.zena`".
  - **p2-before-p3 sequencing** (Part 7): p2 `wasi:http/incoming-handler` is
    fully synchronous; it needs no async, so it is the first HTTP milestone.
    Stages 1–4, 6–7 are independent of Track G (async); only stage 5
    (ownership) is a language change. Part 8a decides `Result<T,E>` as an
    inline multi-value union with bindgen-side boxing for the ~12% nested
    positions (option c).
- [`docs/design/wasi.md`](file:///home/rektide/src/zena-jco-fork/docs/design/wasi.md):
  strategy is "produce a standard core module; use external tools
  (`wasm-tools component new`) to package into a component". Phase 1 =
  hello-world via `wasi:cli/stdout` + `cabi_realloc` + string lowering,
  tested with **jco in Node** ("jco provides polyfills for WASI Preview 2").
  Dev env: Node 25+, wasmtime 39+ with `-W gc=y -W exceptions=y -W
  function-references=y`.
- [`docs/design/console-wasi-strategy.md`](file:///home/rektide/src/zena-jco-fork/docs/design/console-wasi-strategy.md):
  two targets (`host` core-GC + custom console imports; `wasi` component via
  wasm-tools). The virtual stdlib switch: `zena:console` resolves to
  `console/host.zena` or `console/wasi.zena` by target, via the `virtual`
  entry in `packages/stdlib/stdlib-manifest.json:8-13` (a third flavor
  `zena-cli` also maps to `console/wasi.zena`).
- [`docs/design/host-interop.md`](file:///home/rektide/src/zena-jco-fork/docs/design/host-interop.md):
  the V8-optimized string pattern — pass `externref` + length, host iterates
  via auto-exported `$stringGetByte`. Explicitly rejects WASI p1 for host
  console ("we do NOT use WASI Preview 1 for basic I/O") — yet p1 *is* what
  `--target wasi` emits today (via `fd_write`), because the console
  implementation targets p1's flat ABI.
- [`docs/design/byte-buffer.md`](file:///home/rektide/src/zena-jco-fork/docs/design/byte-buffer.md):
  ByteBuffer is a **GC-side** chunked byte builder (for the self-hosted wasm
  emitter) — *not* linear-memory machinery. Linear memory is
  `stdlib/zena/memory.zena` (`zena:memory`, design in `linear-memory.md`).
- [`docs/design/filesystem.md`](file:///home/rektide/src/zena-jco-fork/docs/design/filesystem.md):
  `zena:fs` descriptor/Disposable design; the current implementation is a p1
  `@external` layer (`fs.zena`).
- [`PLAN.md`](file:///home/rektide/src/zena-jco-fork/PLAN.md): Phase 1 =
  self-hosted compiler retirement (current focus); "WASI Component Model &
  WIT Support … compile into compliant WASI Component Model binaries" is
  **Phase 2**. DCE is listed complete ("Compiler-driven dead code
  elimination (DCE) for functions, classes, methods, and WASM types").

## 2. Exact `--target wasi` emission

Bootstrap (TS) compiler, `packages/compiler/src/lib/codegen/`:

- **Unconditional infra** — `codegen/index.ts:195-197` calls
  `ctx.ensureWasiInfra()` whenever `target === 'wasi'`, *before anything
  else*. `context.ts:659-679` then, unconditionally:
  1. `ensureMemory()` → `module.addMemory(1)` + **export `"memory"`**
     (`context.ts:613-619`). Memory is 1 page min, no max, index 0.
  2. **imports `wasi_snapshot_preview1.fd_write`** with exact p1 signature
     `(i32,i32,i32,i32)->i32`, and — crucial for interop — its type is added
     with `{preRec: true}` (`context.ts:667-672`) i.e. **outside the rec
     group**, because "WASI expects standalone function types"
     (`functions.ts:512-514` repeats this for every p1 `@external`).
- The test suite pins this behavior:
  `packages/compiler/src/test/wasi/wasi-build_test.ts:256-267` — "WASI target
  always includes fd_write import for consistency (could be optimized with DCE
  in the future)". So **fd_write+memory are always present even if unused**
  (verified: an add-only program still imports fd_write).
- **No `cabi_realloc`**, no realloc-like export of any kind (grep: the string
  appears only in the two design docs).
- **Strings cross via a byte-buffer protocol baked into codegen**:
  `expressions.ts:9692-9702` fixes the first 64 bytes of memory —
  `0-3 iovec.buf, 4-7 iovec.len, 8-11 nwritten, 64+ string buffer` — and
  `generateWasiWriteStringFunction` (`expressions.ts:9704-9733`, invoked from
  the `wasi_write_string` intrinsic at `expressions.ts:11276-11284`) copies a
  GC `String`'s bytes (struct fields `#data/#start/#end`) into linear memory
  and calls `fd_write`. The stdlib side is
  `packages/stdlib/zena/console/wasi.zena` — `@intrinsic("wasi_write_string")
  declare function __wasi_write_string(fd: i32, s: String): void`, fd 1/2.
- **Other p1 imports come only from stdlib `@external` decls, gated by use
  (DCE-able)**:
  - `zena:fs` (`packages/stdlib/zena/fs.zena:145-253`): `fd_close, fd_read,
    fd_write, fd_seek, fd_filestat_get, fd_readdir, path_open,
    path_filestat_get, path_create_directory, path_unlink_file,
    path_remove_directory, fd_prestat_get, fd_prestat_dir_name`.
  - `zena:cli` (`packages/stdlib/zena/cli.zena:109-147`): `args_sizes_get,
    args_get, environ_sizes_get, environ_get, proc_exit`.
  - `zena:benchmark` (`benchmark.zena:6`) and self-hosted `time.zena`:
    `clock_time_get`.
  - `zena:error` (`error.zena:6-9`): **non-WASI** `env.captureStackTrace` /
    `env.formatStackTrace` imports (the `prelude.ts` pulls `zena:error` into
    every module, so *without* `--dce` these env imports appear even in
    add-only builds — verified).
- **`print_preopens.zena`** at the fork root (with a checked-in
  `print_preopens.wasm`) is a preopen-dump demo via `getPreopens()` from
  `zena:fs` (fd_prestat_*). Its checked-in binary shows the full wasi+fs
  surface, including two quirks worth knowing: `fd_write` imported **twice**
  (the unconditional one plus `fs.zena`'s own — not deduped), and an exported
  **tag `zena_exception`** (exception infra exports its tag,
  `context.ts:586-604`) alongside `memory`, `main`, and the four `$string*`
  helpers.
- **Test coverage**: there is no `test/wasi` at repo root; WASI tests are
  `packages/compiler/src/test/wasi/wasi-build_test.ts` (compile-only:
  fd_write present, `memory` export present, module validates — lines
  155-163) plus stdlib runtime tests run through the **Rust `zena-cli`**
  (`packages/stdlib/scripts/run-wasmtime.js:57-73`: `target/release/zena-cli
  run --dir <dir>::/ --invoke main <wasm>`; the wasmtime flags live in
  `packages/zena-cli/src/main.rs:127-133` — `wasm_gc(true)`,
  `wasm_function_references(true)`, `wasm_exceptions(true)`). The
  language-service tests instead instantiate wasi modules in Node with JS
  stubs (`packages/language-service/src/test/lsp_test.ts:1066-1073`).

### Was in one line

`wasi` target = core WasmGC module, always `import
wasi_snapshot_preview1.fd_write` + export `memory`, never `cabi_realloc`,
strings via a fixed 64-byte iovec header at address 0, all other p1 imports
opt-in from stdlib, `env.*` stack-trace imports unless `--dce`.

## 3. Exact `--target host` emission

- **Imports** (only when used, *but* the prelude
  `packages/compiler/src/lib/prelude.ts:1-18` imports `zena:console`,
  `zena:error`, `zena:string`, … into every module, so **without `--dce` an
  add-only program still imports all of**):
  - `console.log_i32`, `console.log_f32`, `console.log_string`,
    `console.error_string`, `console.warn_string`, `console.info_string`,
    `console.debug_string` (decls in `packages/stdlib/zena/console/host.zena:8-31`;
    `log_string(s, len)` takes the String as externref + i32 length).
  - `env.captureStackTrace`, `env.formatStackTrace`
    (`packages/stdlib/zena/error.zena:6-9`).
  Strings arriving as externref get internalized with `any.convert_extern` +
  `ref.cast` wrappers (`codegen/functions.ts:516-566`).
- **Auto-exports** — `codegen/index.ts:687-700`: whenever the stdlib `String`
  class is present (`stringTypeIndex >= 0`, set in `codegen/classes.ts:2113-2117`),
  the compiler emits and exports, on **both** targets, four interop helpers:
  - `$stringGetByte(externref, i32) -> i32` (`expressions.ts:9398-9399`)
  - `$stringGetLength(externref) -> i32`
  - `$stringCreate(len) -> externref` (inverse direction, JS→Zena)
  - `$stringSetByte(externref, i32, i32) -> void` (`expressions.ts:9611-9641`)
  These are generated *after* body generation, so DCE never removes them while
  `String` survives. Additionally, programs using exceptions export the tag
  `zena_exception` (`context.ts:591-595`).
- **Memory on host target**: created lazily only when needed — data segments
  or explicit `zena:memory` use (`codegen/index.ts:188-190`). Notably, string
  literals do **not** create memory: they live in a data segment materialized
  into GC arrays via `array.new_data` in a start function
  (`codegen/index.ts:557-614`; verified: `(start 18)` + `(data "…")` and no
  memory in a DCE'd hello build).
- **Export naming**: plain, unmangled. Verified exports `"add"`, `"main"`,
  `"run"`, and even `"_start"` (a leading-underscore identifier is legal).
  Debug names (name section, `-g`) carry source paths
  (`print_preopens.wasm` has `func $/Users/justin/…`), but export names are
  exactly the source-level names.
- **`@zena-lang/runtime`** (`packages/runtime/src/index.ts`) provides
  `createStringReader` (:88), `createStringWriter` (:122),
  `createConsoleImports` (:163), and `instantiate(wasm, imports)` (:211)
  which wires console imports with deferred `$stringGetByte` binding — the
  "V8-optimized pattern" from host-interop.md.

### Host in one line

`host` target = core WasmGC module with `console.*`/`env.*` JS-facing
imports, four `$string*` externref interop exports whenever String survives,
no linear memory unless asked for.

## 4. Zero-compiler-change componentization — **verified working**

Two facts decide this:

1. **`--dce` makes the host target pristine.** `zena build add.zena --dce`
   yields a 58-byte module with only `add`/`main` exports, zero imports, zero
   memory, no `$string*` (String eliminated). Without `--dce` the module is
   ~13KB and imports `console.*` + `env.*` unconditionally (prelude effect
   above) — those *cannot* be satisfied inside a component without adapters,
   so **`--dce` is effectively mandatory for componentization today**.
2. **Extra core exports are tolerated.** `wasm-tools component embed` +
   `component new` happily lift only the world-declared exports and ignore
   the rest (`main` rode along unreferenced in the test below). Similarly
   unlifted core exports like `$stringGetByte` or the `zena_exception` tag
   don't block `component new`.

**Empirically verified end-to-end** (wasm-tools 1.245.1):

```
zena build add.zena --dce -o add.host.dce.wasm       # export let add = (a,b) => a+b; main
wasm-tools component embed wit/add.wit add.host.dce.wasm -o add.embed.wasm
wasm-tools component new add.embed.wasm -o add.component.wasm   # 278 bytes, validates
wasm-tools component wit add.component.wasm
# → world root { export add: func(a: s32, b: s32) -> s32; }   (exact round trip)
```

Signature matching is **strict at the flattened-core-ABI level**: `func() ->
result` is satisfied by a zena `(): i32` (component built), but `func()` is
*not* satisfied by `(): i32` ("failed to classify export `run`"). So the rule
is: WIT numerics/bool/`result` ↔ zena i32/f32/f64/bool with matching
flattening; anything involving string/list/record needs memory + realloc
(§6). A GC-heavy body under the lifted export is irrelevant — GC types never
cross the lift.

Caveat: `--target wasi` **cannot** be embedded the same way without an
adapter — `component new` on the raw module fails with *"module requires an
import interface named `wasi_snapshot_preview1`"* (verified). The fd_write
import is unconditional (§2), so even a trivial wasi-target program needs the
adapter path (§7) or a fork patch to skip `ensureWasiInfra`.

## 5. Guest-side canonical ABI in zena source — feasible today

What exists in `packages/stdlib/zena/memory.zena` (`zena:memory`):

- `Memory` class with `@intrinsic` load/stores: `getU8/setU8`, `getI32/setI32`,
  **`getI64/setI64`**, `getF32/setF32`, `getF64/setF64`, `memory.size`,
  `memory.grow`, plus `[]`/`[]=` byte operators (memory.zena:20-121).
  Any use of these triggers `ensureMemory()` per-instruction
  (`codegen/expressions.ts:10790+`), i.e. linear memory (exported as
  `"memory"`) appears on **any** target, host included.
- `Allocator` interface (`alloc/allocAligned/free`), **`FreeListAllocator`**
  (8-byte block headers, first-fit + splitting) and `BumpAllocator`;
  `FreeListAllocator.default` starts at byte **65536** deliberately "to avoid
  WASI console buffer overlap" (memory.zena:141-301) — note the console
  buffer is only the first 64 bytes (§2), so page 1 is conservative headroom.
- String byte access is public: `String.getByteAt(i)` and
  `String.fromByteArray(data, start, end, encoding)`
  (`string.zena:96,159`); `ByteArray` has intrinsic `[]`/`[]=`, plus
  `newByteArray`/`copyBytes` (`byte-array.zena:11-27`).

So a hand-written canonical ABI layer is writable **in zena source**:

- `export let cabi_realloc = (oldPtr: i32, oldSize: i32, align: i32, newSize:
  i32): i32 => …` — alloc via `FreeListAllocator` (there is no
  realloc-shaped method; write alloc+copy+free), export name is unmangled
  (§3). `canon lift … (realloc …)` picks it up by name.
- Lower a `String` to memory: loop `getByteAt` → `setU8`; lift back:
  `newByteArray` + loop `getU8` → `[]=` → `String.fromByteArray`.
- Post-return (`cabi_post_*`) exports: same mechanism, plain names.

What's missing / awkward:

- No multiple memories — not needed for cabi.
- Data segments exist (string literals) — orthogonal.
- i64 memory ops exist — so even 64-bit fields are fine.
- The real gaps are ergonomic, not capability: no `realloc` helper, no
  alignment-aware variant of alloc beyond `allocAligned`, and everything is
  hand-rolled per function. This is exactly Track W stage 4
  ("canonical ABI … build on the existing FreeListAllocator").
- `cabi_realloc` also has to *not* collide with the wasi-target's fixed 64-byte
  iovec header if you use console on wasi — start the allocator ≥ 64 (the
  default 65536 is safe).

## 6. p1-adapter path — **verified working end-to-end under wasmtime**

`--target wasi` matches the official preview1 adapter's requirements almost
exactly:

- Import module name is exactly `wasi_snapshot_preview1` ✓ (§2).
- The only auto p1 import is `fd_write` with the exact p1 signature ✓.
- Guest **exports its memory as `"memory"`** — required by the adapter to
  read/write iovecs ✓.
- No `cabi_realloc` needed for p1 (p1 is guest-managed-buffer throughout) ✓.
- `--dce` removes the `env.*` stack-trace imports that would otherwise be
  unadaptable unknowns ✓ (must use `--dce`, or accept env adapters).

Verified pipeline (adapter vendored from the **`@bytecodealliance/jco` npm
tarball** — `lib/wasi_snapshot_preview1.command.wasm` / `…reactor.wasm`,
checked in jco 1.34.0):

```zena
// start2.zena
import { console } from 'zena:console';
export let _start = (): void => { console.log("Hello from a zena component!"); };
```

```
zena build start2.zena --target wasi --dce -o start2.wasi.wasm
# … one WAT fix, see below …
wasm-tools component new start2.fixed.wasm \
  --adapt wasi_snapshot_preview1=wasi_snapshot_preview1.command.wasm \
  -o start2.component.wasm            # validates; world = full wasi p2 set @0.2.12
wasmtime run -W gc=y -W exceptions=y -W function-references=y start2.component.wasm
# → prints "Hello from a zena component!"   rc=0
```

The WAT fix is a **real interop bug in zena's emission**: the command adapter
instantiates the guest with `(import "__main_module__" "_start" (func))`, and
instantiation-argument type matching is nominal, so the guest's `_start` type
must be a *standalone* `(func)`. Zena puts most defined-function types inside
one big `rec` group — rec-group membership is part of type identity, so its
`(func)` mismatches the adapter's standalone `(func)` and `component new`
fails with the confusing *"expected: (func) / found: (func)"* (verified).
Notably the compiler **already solved this exact problem for imports** —
`preRec: true` exists precisely because "WASI expects standalone function
types, not types inside a rec group" (`codegen/functions.ts:512-514`,
`context.ts:667-672`) — it just doesn't apply it to *exported/defined*
functions. Workarounds used: `wasm-tools print` → drop the `(type 22)`
reference from the `_start` func so the WAT parser re-types it standalone →
`wasm-tools parse`. The clean fix (one-line-ish fork patch, matches existing
`preRec` machinery): emit exported entry-point function types `preRec`. Same
issue presumably explains the reactor-adapter failure on a custom `main`
world (type of the lifted export inside the rec).

Also verified along the way:

- `_start` must be `(): void` — `(): i32` fails against the command adapter
  ("expected (func), found (func (result i32))"), and `_start` is a legal
  zena export name.
- Embedding a *custom* world (`export main: func() -> result`) + reactor
  adapter failed on the same nominal-type class of error; command flavor +
  `_start` is the frictionless shape.
- With DCE, exceptions infra (`zena_exception` tag) only appears if
  exceptions are actually used; unlifted tag exports did not obstruct
  `component new` in our runs.

## 7. Practicalities

- **Node**: `engines.node >= 25` (root `package.json:4-6`), enforced with a
  warning by `packages/cli/src/lib/cli.ts:12-21` — "WASM GC exceptions". The
  compiler emits new-style EH (`try_table`, `codegen/expressions.ts:332-419`),
  so V8 with try_table/exnref (Node 25+; we ran v26.6.0) is the floor for
  *hosting*, not for compiling. jco-side requirements live in the companion
  doc.
- **Build the fork**: `npm install && npm run build` (wireit; caches under
  `.wireit/` — per `AGENTS.md:243-258`, trust the cache, use `npm run`,
  never delete cache dirs casually). The repo is typically prebuilt
  (`packages/*/lib` committed), so the bootstrap CLI runs without building:
  `node packages/cli/lib/cli.js build main.zena -o main.wasm
  [--target wasi] [--dce] [-g]`. `run` refuses `--target wasi`
  (`cli.ts:262-264`). There is **no root `npm run zena`**; the nix flake's
  `zena` binary just wraps `packages/cli/lib/cli.js` (`flake.nix` installPhase).
- **Two compilers**:
  - *Bootstrap (TS)*: `packages/cli` + `packages/compiler` — what the flake,
    the wasmtime script (`scripts/wasmtime-run.sh`), and everything in this
    doc exercised. **Target this for experiments**: no cargo, fastest
    iteration, and it owns the `--target wasi`/`--dce`/`preRec` codepaths
    described above.
  - *Self-hosted*: `packages/zena-compiler` (Zena sources under `zena/lib`,
    ZIR backend per `CONTEXT.md`) executed by the Rust host
    `packages/zena-cli` (`cargo build --release` →
    `target/release/zena-cli`; wireit task `zena` in
    `packages/zena-cli/package.json`). It has parallel wasi support
    (`zena/lib/codegen/reachability/visitor.zena:1486,1580` — same
    module-name switch, `fdWriteFunc.importModule = "wasi_snapshot_preview1"`)
    and its snapshots show the same emission shape
    (`test-files/snapshots/console_target_zena_cli.snap:35` — fd_write
    import, `:65` — `$stringGetByte` export). PLAN.md Phase 1 is its
    retirement of the bootstrap, so fork patches should eventually land in
    both, but bootstrap-first is the right order today.
- **wasm-tools/wasmtime**: system wasm-tools 1.245.1 worked for everything
  above. flake pins wasmtime 46.0.0 + nixpkgs wasm-tools. The p1 adapters
  come free from the jco npm package (§6) — no cargo build of
  `wasi-preview1-component-adapter` needed.
- Package map: `zena-packages.json` maps `zena-compiler`/`zena-formatter`
  source packages for the compiler host (`packages/cli/src/lib/cli.ts:85-115`).

## Shortest paths to a component (ranked)

1. **Trivial flat world on host+DCE (WORKS TODAY, zero changes).**
   `--dce` host build + `wasm-tools component embed <wit> … + component
   new`. Numerics/bool/`result`-only exports (and imports, symmetrically —
   lowered imports of flat types need no memory). 278-byte components,
   validated + world round-trips. Best for proving the jco pipeline.
2. **p1-adapter "wasi command" (WORKS TODAY with one WAT tweak).**
   `--target wasi --dce` + `export let _start = (): void => …` + jco's
   vendored `wasi_snapshot_preview1.command.wasm` adapter +
   `component new --adapt`. Verified running under wasmtime with GC flags.
   Gives real stdout/stderr (and, via `zena:fs`/`zena:cli`, files/args when
   their imports are kept). The WAT tweak is mechanical; the durable fix is
   the `preRec`-for-exports fork patch. This is the natural host for the
   "hello world under jco" milestone — jco transpile of a p2-importing
   component with its built-in WASI shims is exactly its home turf.
3. **Hand-written canonical ABI in zena source (feasible now, medium
   effort).** Export `cabi_realloc` (FreeListAllocator-backed) +
   memory (free via `zena:memory` intrinsics) + per-function lift/lower glue
   in zena source, per §5. Unlocks string-taking worlds (`export greet:
   func(name: string) -> string`) without any compiler change, at the cost
   of writing the ABI by hand per function. This is also the natural
   prototype for Track W stage 4 before bindgen exists.
4. **Real Track W bindgen + component emission** — the destination, not a
   shortcut: `parseWit` integration, bindgen, canonical ABI, `component-type`
   custom-section emission ("shell out to wasm-tools first"), per
   component-model.md Part 8. Nothing in it is started; every stage 1–7 is
   open. Path 3 is a hand-run of stage 4 and de-risks it.

Recommended sequencing for the zena-jco project: prove jco transpile+run on
(1) immediately, then make (2) the demo and drive the `preRec`-for-exports
patch upstream, then use (3) to get strings across the boundary while
deciding how much of Track W to pull forward.

## Open questions

- Does jco transpile accept components whose core module uses GC/`try_table`
  (Node-side engine gating is the sibling doc's question, but wasm-tools-JS
  parsing inside jco also has to tolerate rec groups in the core module)?
- Reactor-flavor adapter + custom named exports (non-`_start` entry): the
  nominal-type mismatch needs the same fix; after the patch, does the
  reactor adapter then work for library-shaped (non-command) components?
- Will the duplicate `fd_write` import (auto + `fs.zena`'s, §2) confuse any
  adapter/composer? (wasmtime/wasm-tools tolerated it here.)
- `zena_exception` tag export + component embedding when exceptions are
  used: tolerated by wit-component in our runs, but unlifted tags may bother
  stricter validators or future component-metric tooling.
- Host-target `$stringCreate`/`$stringSetByte` exports riding along in a
  component (when String survives DCE): harmless to wit-component, but they
  are externref-typed noise; decide whether the world should just ignore
  them or the fork should gate them behind `--target host`.
- Where should the p1 adapters be vendored for the zena-jco repo — jco's npm
  copy (proven here) vs building `wasi-preview1-component-adapter` from
  wasm-tools?

## References

- Fork design docs: `docs/design/component-model.md` (Track W; stages,
  status table, p2-first), `wasi.md`, `console-wasi-strategy.md`,
  `host-interop.md`, `byte-buffer.md`, `filesystem.md`,
  `dead-code-elimination.md`, `linear-memory.md`, `PLAN.md`,
  `AGENTS.md:243-280` (wireit discipline).
- Compiler code: `packages/compiler/src/lib/codegen/context.ts:586-679`
  (exception infra, memory, wasi infra), `…/index.ts:188-197,687-700`
  (unconditional wasi init, `$string*` generation), `…/functions.ts:509-598`
  (external decls, preRec), `…/expressions.ts:9398-9399,9611-9641,9692-9799,11276-11284`
  (string helpers, wasi write string, intrinsic), `…/prelude.ts`.
- Stdlib: `zena/console/{interface,host,wasi}.zena`, `zena/fs.zena:145-253`,
  `zena/cli.zena:109-147`, `zena/error.zena:6-9`, `zena/memory.zena`,
  `zena/string.zena:96,159`, `zena/byte-array.zena`, `stdlib-manifest.json`.
- Tests/hosts: `packages/compiler/src/test/wasi/wasi-build_test.ts`,
  `packages/stdlib/scripts/run-wasmtime.js:57-73`,
  `packages/zena-cli/src/main.rs:127-133`, `scripts/wasmtime-run.sh`,
  `packages/language-service/src/test/lsp_test.ts:1066-1073`.
- Artifacts: `print_preopens.zena` / `print_preopens.wasm` (fork root);
  experiment scripts and binaries in
  `/home/rektide/tmp-opencode/zena-jco-research` (add/hello/run/start2 +
  components + extracted jco adapters).
- Upstream: `wasm-tools component embed/new --adapt`,
  `@bytecodealliance/jco` npm tarball (`lib/wasi_snapshot_preview1.{command,reactor}.wasm`).
