---
type: Issue-ledger
title: "zena defects encountered via jcona"
description: Narrative ledger of every zena compiler defect found by exercising zena through the jco componentization pipeline — symptom, root cause, repro, fix, verification, and status for each; plus adjacent non-zena defects hit along the way.
resource: https://github.com/rektide/zena-jco/blob/main/doc/zena/issues.md
tags: [zena, jco, wasm-gc, component-model, defects, dce, fork]
status: living doc
generated:
  by: agent:glm53f
  at: 2026-09-16
verified:
  by: agent:glm53f
  at: 2026-09-16
stale_after: 2026-12-01
sources:
  - id: findings-log
    resource: /home/rektide/src/zena-jco/doc/research/work-outline.glm53max.md
    title: work outline findings log (2026-09-15..16)
  - id: e1
    resource: /home/rektide/src/zena-jco/doc/research/e1-zena-flat.glm53max.md
    title: "E1 — env imports blocker + addendum"
  - id: bd
    resource: .beads/issues.jsonl
    title: "beads tickets zenajco-f1-prerec / f1b-intrinsics / f1c-concat / f1d-stacktraces (bd is the source of truth)"
  - id: fork
    resource: /home/rektide/src/zena-jco-fork
    title: fork commits d451bd5f79d3, f60315594281, 048e345ccdc4, 691d8ed04dfb + cde81fc2a952
---

# zena defects encountered via jcona

Every defect in this ledger was found the same way: zena compiled a program
fine by its own lights, and the module only broke when pushed through
componentization (`wasm-tools component embed` / `component new`) or
transpilation (`jco transpile`). That pipeline — nominal type matching at
instantiation, WIT-driven lifting, DCE-then-lower — is exactly the surface
upstream zena testing does not cover, which is why four of the five defects
below were invisible to the compiler suite until a real guest hit them.

Maintenance: **beads tickets (`zenajco-f1*`) are the source of truth** for
status; this document is the narrative ledger — the full write-up of what
each defect looked like, why it happened, and how it was proven fixed. Each
entry carries its ticket id and fork commit so the two stay cross-referenceable.
Line references are in the fork checkout at `~/src/zena-jco-fork`
(`packages/compiler/src/lib/…` below).

---

## RESOLVED

### R1 — rec-group type identity broke nominal matching against standalone types

**Ticket:** `zenajco-f1-prerec` (closed) · **Fork commit:** `d451bd5f79d3`
(ssulynvvposo, "compiler: standalone (pre-rec) types for flat-ABI imports and
exports")

- **Symptom.** `wasm-tools component new` rejects an otherwise valid module
  with the maddening, self-contradictory error `"expected (func), found
  (func)"` — the two sides look identical. Two failure modes: (a) import
  side — any p2-direct `@external` import, e.g.
  `(import "wasi:cli/stdout@0.2.12" "get-stdout" (func (result i32)))`,
  failed at `component new` ("module requires an import interface named
  …"); (b) export side — the preview1 command adapter instantiates
  `(import "__main_module__" "_start" (func))` and the nominal
  `_start` match failed identically (a shape mismatch such as
  `expected (func), found (func (result i32))` also surfaced, but that
  variant is a genuine signature error, not this bug).
- **Root cause.** Rec-group membership is part of wasm type identity. Zena
  emitted defined-function types inside one big `rec` group; component
  tooling and adapters match instantiation-argument types *nominally*
  against standalone types, so `(func)`-in-rec ≠ standalone `(func)` even
  with identical shapes. The compiler already had the `preRec` machinery
  for exactly this ("WASI expects standalone function types, not types
  inside a rec group", `codegen/functions.ts:512-514` pre-fix) but its
  special case only recognized the `wasi_snapshot_preview1` module name,
  and nothing applied it to exported/defined functions at all.
- **Minimal repro.** Compile a trivial `--dce` wasi build declaring
  `@external("wasi:cli/stdout@0.2.12", "get-stdout")` (flat i32 result) →
  `component embed` succeeds, `component new` fails with the error above.
  Same for `_start` against the command adapter. Pre-fix workaround (used
  in early run.sh scripts): `wasm-tools print` → strip the `(type N)`
  annotation from `_start`/the import func → `wasm-tools parse` to force
  standalone re-typing.
- **Fix.** Pass 0 now registers a standalone pre-rec type for *every*
  `@external`-declared import whose signature lowers to flat numerics (any
  module name — pre-rec additions shift rec-group indices, so they must all
  precede any rec-group reservation). Pass 0b reserves a standalone type for
  every exported top-level function with a flat-ABI signature;
  `registerFunction` reuses the reservation instead of adding a rec-group
  type. (Flat signatures are the only exported shapes a component world can
  lift anyway — GC refs cannot cross the boundary.)
- **Verification.** p2-direct zena guest (`wasi:cli/stdout` +
  `wasi:io/streams` externals) embeds, componentizes, transpiles under jco,
  and prints in Node and browser; `_start` + preview1 command adapter
  componentizes with no WAT fixup and runs; `@zena-lang/compiler` suite
  fail 0. WAT surgery deleted from the E2/E5 scripts.
- **Status:** RESOLVED 2026-09-15.

### R2 — DCE culled `@intrinsic` overload families to one wrong overload

**Ticket:** `zenajco-f1b-intrinsics` (closed) · **Fork commit:**
`f60315594281` (rwspksnnvyxm, "compiler: keep @intrinsic overload families
whole under DCE")

- **Symptom.** Invalid core module. `wasm-tools component new` reports it
  misleadingly as `component new: failed to validate component output …
  expected i64, found i32` — the *core* module is what's invalid; standalone
  `wasm-tools validate` is the honest first check for this error class. The
  emitted code was `i64.div_u` applied to unconverted i32 operands.
- **Root cause.** `zena:math`'s `div` is four `@intrinsic` declares
  (i32/i64/u32/u64). Usage analysis marked only the declaration the
  checker's name binding resolved to; under `--dce` the other three vanished
  from the overload list, call-site resolution could no longer exact-match
  argument types, and the surviving overload's opcode was emitted verbatim
  over unconverted operands. Non-DCE builds emitted `i32.div_s` correctly,
  which pinned the bug to DCE rather than overload resolution itself.
- **Minimal repro.** `export let gVar = (a: i32, b: i32): i32 => div(a, b);`
  built with `--dce` → `(func (param i32 i32) (result i32) … i64.div_u)` →
  `wasm-tools validate` rejects.
- **Fix.** Pass 0 registers every `@intrinsic` declare whose *name* is used
  by any used sibling, so the family stays whole and exact-ValType matching
  picks the right opcode. Generic intrinsics and non-intrinsic declares are
  unaffected. Upstream follow-up noted in the commit: make the checker bind
  overloaded top-level declares by argument types so usage marking is
  precise instead of family-conservative.
- **Verification.** `div(i32, i32)` emits `i32.div_s` under `--dce`;
  `examples/emoji-zena` builds and validates end to end (found via its
  `FreeListAllocator` memory-growth path calling `div`); suite 2285 pass /
  0 fail.
- **Status:** RESOLVED 2026-09-15.

### R3 — operator-method DCE gap: `String +` concat emitted an invalid module ("unknown function 127")

**Ticket:** `zenajco-f1c-concat` (closed, bug) · **Fork commits:**
`691d8ed04dfb` (failing regression) + `cde81fc2a952` (vrkvutzvonml,
"compiler: retain resolved operator methods under DCE")

- **Symptom.** `wasm-tools validate` on a `--dce` core module using string
  concatenation: `unknown function 127: function index out of bounds`. The
  magic 127 is the tell: sentinel MethodInfo index `-1`, encoded by
  call-site lowering as a signed LEB `0x7f`, which the `call` instruction
  then interpreted as function index 127.
- **Root cause.** Usage analysis hard-coded binary-operator reachability to
  `==` and `!=` only (`packages/compiler/src/lib/analysis/usage.ts:844`
  pre-fix — the binary-expression visit), so a checker-resolved
  `String.operator+` call never marked the method live. Method-level DCE
  then retained the `ClassInfo` MethodInfo *placeholder* (index `-1`) while
  omitting the function itself; `packages/compiler/src/lib/codegen/
  expressions.ts` encoded that sentinel as `0x7f`. Note: the ticket's
  opening description hypothesized an index-space desync "same family as
  the div DCE bug" — the root-cause work disproved that ("this was not
  pending-helper/import index shifting"); both DCE bugs share the *trigger*
  (`--dce`) but not the mechanism.
- **Minimal repro.** Bisected pair (repro embedded in the ticket):
  - A (invalid): `import { String } from 'zena:string';
    export let run = (): void => { writeLine('a' + 'b'); };` (with the
    `lib/zena/wasip2/stdout.zena` writeLine import)
  - B (valid): same imports plus clocks/random/Memory touched, no concat.
  Build with `node ~/src/zena-jco-fork/packages/cli/lib/cli.js build A.zena
  --dce -o a.wasm`; `wasm-tools validate a.wasm` errors pre-fix.
- **Fix.** Usage analysis now follows the checker's `resolvedOperatorMethod`
  generically for binary and compound-assignment nodes — covering operator
  syntax generally, including overload-mangled names — while keeping the
  `!=` → `==` special case (the checker attaches no resolved method there;
  `!=` lowers to `==` with the result negated).
- **Verification.** Regression compiles minimal `String +` and `String +=`
  with `dce: true`, asserts `WebAssembly.validate`, instantiates, and
  asserts the result: pre-fix 1 fail (validation false), post-fix 9/9
  operator-DCE tests pass. Suite 2313 tests, 2299 pass / 0 fail. The jcona
  concat repro validates under `--dce`. Lib/example code no longer needs to
  avoid concat.
- **Status:** RESOLVED 2026-09-16.

### R4 — interface exports impossible without mangled names → `@exportName`

**Ticket:** `zenajco-f5-exports` (closed) · **Fork commit:** `048e345ccdc4`
(tsumxvov, "compiler: @exportName decorator for mangled core export names")

- **Symptom.** A zena component could not *implement* a WIT interface
  export. `wasm-tools component new` requires the core export to carry the
  mangled name (`rektide:interop/rng@0.1.0#next`), but zena export names
  come from source identifiers, which cannot spell `#`, `:`, or `@`.
  Downstream, `wac plug` reported "the socket component had no matching
  imports" — the two static cells of `examples/interop-matrix` were SKIP.
  (Interface *imports* worked via `@external`; flat world-level exports
  worked via plain identifiers — only the interface-export direction was
  impossible.)
- **Root cause / limitation.** No mechanism to rename a core-level export to
  a non-identifier string. The typed `exportName` field already existed on
  `VariableDeclaration`/`ClassDeclaration` but nothing ever populated it;
  the four codegen export sites read it only through untyped `(decl as
  any)` casts.
- **Fix (feature, not a patch).** `@exportName("ns:pkg/iface@ver#func")`
  decorator mirroring `@external` on the import side: parser extracts it
  (exactly one non-empty string literal, requires `export`; identifier
  patterns only) onto `export let/var` and `export declare function`;
  checker gains a duplicate-core-export-name diagnostic; codegen flows
  `exportName` through `registerFunction`, the global export path, and
  `registerDeclaredFunction`; the `(as any)` casts became typed reads.
- **Verification.** 12 parser/codegen tests (parse/AST wiring, rejections,
  mangled emission for functions/globals/re-exported declares, survives
  `--dce` — exported decls are usage-analysis roots — duplicate diagnostic).
  Suite 2297 pass / 0 fail. `examples/interop-matrix` grew the
  `rng-source-both` world; matrix now 10 pass / 0 skip / 2 n-a / 0 fail,
  including wac-fused zena→zena static composition.
- **Known open edges** (recorded on the ticket, not defects of this fix):
  `@exportName` on classes (parser never populates), and interface exports
  containing *resources* (the mangled `[constructor]`/`[method]`/`[dtor]`
  function exports could be spelled, but zena does not model resource
  handle ABI — probe fails at `component new` with "failed to find export
  of interface … function [constructor]generator").
- **Status:** RESOLVED 2026-09-15 (limitation closed by feature).

---

## UNRESOLVED

### U1 — `env.captureStackTrace` survives `--dce` whenever exceptions are used

**Ticket:** `zenajco-f1d-stacktraces` (in_progress, P2) · **Fix in flight;
workaround shipped.**

- **Symptom.** Any zena component that uses exceptions — i.e. any realistic
  one; try/catch is core — keeps an `env.captureStackTrace` import
  (`(func (result externref))`) even under `--dce`. Externref can never be
  expressed in WIT, so `component embed` succeeds but `component new`
  fails: `failed to resolve import 'env::captureStackTrace'` / "module
  requires an import interface named `env`".
- **Root cause.** Eager capture, not a DCE bug — the retention is
  *legitimate*. `packages/stdlib/zena/error.zena:6-7` declares
  `@external("env", "captureStackTrace")`, and `Error.new` eagerly calls
  `__captureStackTrace()`; `throw` constructs an `Error`, so the externref
  import is genuinely used and rooted. (The sibling
  `env.formatStackTrace` hook is the same class on paper, but the
  handles-zena guard proves only `captureStackTrace` remains in practice on
  `--dce` builds: the guard rewrites precisely that one import and the
  pipeline then succeeds.)
- **Minimal repro.** `examples/handles-zena` — a guest with try/catch.
  Build `--dce`, print the WAT, count `import "env" "captureStackTrace"` →
  1; `component new` without surgery fails. This was the first
  exception-*using* zena component ever pushed through the pipeline.
- **Fix in flight** (ticket options): (a) target-conditional stdlib —
  `error/host.zena` vs `error/component.zena` with `#stackTrace = null`,
  mirroring the existing console module swap seam
  (`resolveStdlibImport`) — the clean fork fix, and exactly the shape of
  the E1-era reverted experiment, chosen before we knew it was
  load-bearing; (b) lazy capture on first `getStackTrace()`; (c) jcona
  build absorbs the rewrite. Acceptance: an exception-using component
  componentizes with `--dce` alone; fork suite green; handles-zena drops
  its guard.
- **Workaround shipped.** `examples/handles-zena/run.sh`: a guarded,
  at-most-once WAT rewrite that replaces the import with a same-index
  `(func (type N) ref.null extern)` local provider, failing loudly if the
  known module shape changes. Implication: every exception-using zena
  component needs this (or fix (a)) until it lands — `--dce` alone is not
  sufficient for them.
- **Verification.** Pending (none yet — ticket in progress).
- **Status:** UNRESOLVED — fix in flight (lazy capture vs
  target-conditional stdlib), workaround active.

---

## ADJACENT (non-zena defects hit along the way)

- **Browser preview2-shim shared-singleton / own-handle mismatch**
  (`@bytecodealliance/preview2-shim`, browser build): every `get-stdout()`
  returns a fresh *own* handle bound to the **same shared** stdout
  `OutputStream` singleton (two table reps, one JS object — exposed by the
  jcona-observe `captureTables` snapshot). The browser shim's
  `OutputStream` flips `#open = false` on dispose, so dropping ANY handle
  closes stdout for ALL surviving handles → subsequent writes throw
  `{tag:"closed"}`. Node's shim has no such flag, which is why it never
  showed there. Root-caused via `examples/resource-tables` (standalone
  demo); precise mechanism ready for an upstream jco issue. Guest-side
  workaround: never drop process-lifetime stdio handles
  (`lib/zena/wasip2/stdout.zena` rule).
- **wasm-tools wit-component adapter panic** (E1): satisfying externref
  imports via `--adapt` panics — `panicked at
  crates/wit-component/src/encoding.rs:2847 … unreachable` — adapter-shim
  type mapping handles only numeric types; externref/anyref in
  adapter-connected imports are structurally unsupported. See
  [`doc/research/e1-zena-flat.glm53max.md`](../research/e1-zena-flat.glm53max.md).
- **wasm-tools `component new` error masking** (UX): core-module type
  errors surface as `failed to validate component output …` — bit us
  twice (R2, R3). Always run standalone `wasm-tools validate` on the core
  module before blaming the component-ization step.
- **jco transpile masks exnref off by default**: exception-using zena
  guests (new-style EH, `try_table`/exnref) need
  `--bindgen-enable-wasm-exnref` at transpile (E2 finding).
- **wasi-otel `wkg.lock` pin**: pins `wasi:clocks@0.2.0` against real
  0.2.12 trees — friction for SDK-less guests (findings log 2026-09-15).
- **wasm32-wasip2 cargo footgun**: building a cdylib command alone can
  clobber the lib artifact with an empty-world variant (feature
  unification); `crates/*/build.sh` orders builds to avoid it.

---

## Cross-references

- [`doc/research/work-outline.glm53max.md`](../research/work-outline.glm53max.md)
  — the plan of record; its findings log (2026-09-15..16) is the
  chronological source for R2–U1.
- [`doc/research/e1-zena-flat.glm53max.md`](../research/e1-zena-flat.glm53max.md)
  (+ addendum) — the externref-host-hook analysis behind U1; its original
  "both hooks survive DCE even when Error is never touched" claim was
  superseded by the addendum (`--dce` removes them when exceptions are
  unused; the residual rooting is the legitimate eager capture in
  `Error.new`).
- [`doc/research/e2-zena-wasi.glm53max.md`](../research/e2-zena-wasi.glm53max.md)
  — the R1 error text and command-adapter mechanics.
- [`examples/emoji-zena/NOTES.md`](../../examples/emoji-zena/NOTES.md) —
  R2's discovery record (originally mis-framed as an ABI stop condition,
  resolved as MAX_FLAT_RESULTS + the DCE overload bug).
- [`examples/handles-zena/run.sh`](../../examples/handles-zena/run.sh) —
  the U1 workaround guard.
- [`examples/resource-tables/README.md`](../../examples/resource-tables/README.md)
  — the root-cause evidence for the adjacent preview2-shim defect.
- Fork checkout: `~/src/zena-jco-fork` — commits `d451bd5f79d3` (R1),
  `f60315594281` (R2), `048e345ccdc4` (R4), `691d8ed04dfb` + `cde81fc2a952`
  (R3).
