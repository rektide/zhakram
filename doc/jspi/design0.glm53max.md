---
type: Design
title: "What JSPI means to zena — design0 (glm53max wave)"
description: Maps zena's planned Track G async (generators/split pass → CPS) onto runtime-integration drivers, with JSPI-first as the hypothesis; upstreamable design assessment for a zena compiler maintainer.
resource: /doc/jspi/design0.glm53max.md
tags: [zena, jspi, async, wasi-preview3, component-model, track-g]
status: draft
generated: { by: agent:glm53max, at: 2026-09-16 }
verified: { by: unverified, at: never }
stale_after: 2026-12-16
sources:
  - id: zena-fork-design
    resource: file:///home/rektide/src/zena-jco-fork/docs/design/
    title: zena fork design docs (generators, concurrency, implementation-plan, component-model, exceptions)
  - id: p3-frontier
    resource: /doc/research/p3-frontier.solmax.md
    title: jcona p3 frontier — the JSPI/sync-canon experiments (verified 2026-09-15)
  - id: zena-targets
    resource: /doc/research/zena-targets.glm53max.md
    title: what the zena compiler emits today (verified 2026-09-14)
  - id: work-outline
    resource: /doc/research/work-outline.glm53max.md
    title: jcona plan of record incl. findings log (DCE/resolution fragility)
---

# What JSPI means to zena

This is a design assessment for the zena compiler: how the language-internal
async plan ([Track G](#1-situation-two-async-plans-and-one-experiment)) should
be sequenced against runtime-integration drivers, given new experimental
evidence that a **real zena-produced WasmGC module can suspend through
JavaScript Promise Integration (JSPI) today**, with live GC references, under
the *synchronous* canonical ABI. It is written to be upstreamed: no familiarity
with the jcona project is assumed, and every empirical claim cites where it was
proven.

## Decision summary

| # | Recommendation | Confidence |
| --- | --- | --- |
| 1 | **JSPI-first is confirmed as the first host driver**, with the *linear* lowering promoted from "optimization" to **the entire v1 lowering**. `async fn` with sequential awaits compiles to an ordinary core function; suspension lives in the host engine, not in zena's CPS transform. Amends [concurrency.md](#6-decisions-upstream-must-make) §Codegen Strategy ("Always generate CPS"). | High — experimentally proven end-to-end |
| 2 | **The generator split pass (G1) is NOT on async v1's critical path.** JSPI suspension is invisible to ZIR; `yield_`/frames/liveness machinery stays generator-only until the p3 callback driver (or guest-internal concurrency) activates it. This *narrowly confirms* (and cheapens) implementation-plan.md's "Async's prerequisite is G1" — the prerequisite is G1's *existence discipline*, not its *execution*. | High |
| 3 | **Async v1 is a front-end-only compiler slice**: tokenizer→parser→checker for `async`/`await`; core codegen for linear awaits is a no-op beyond existing `@external` machinery; the async WIT effect is hand-authored at `wasm-tools component embed` time (worlds are external today). No bindgen dependency. | High |
| 4 | **Async-ness is declared and typed, never inferred.** `Future<T>` in the type *is* the effect marker. Inference would interleave a new whole-program effect pass with the resolution/monomorphization/DCE pipeline — the seam the findings log identifies as zena's most fragile interaction. | High |
| 5 | **`await` inside `try` is banned in v1**, mirroring the `yield`-in-`try` ban — but for a sharper reason: a rejected host Promise arrives as a *foreign* exception at the call site, and zena's `catch` compiles to a **tag-only** `try_table (catch $zena_exception …)` clause that cannot catch it. Reject-in-`try` semantics must be designed once, with cancellation. | Medium-high — mechanism verified in codegen, rejection delivery not yet experimentally pinned |
| 6 | **WASI stays p2** for the first slice; genuinely async host operations are custom Promise-returning imports. The native p3 callback ABI + wasmtime-p3 is the second driver and the conformance oracle, deliberately later. | High |

What is deliberately **not** recommended: first-class `Future` values, spawn /
race / select / TaskGroup, channels, cancellation, `async gen`, maybe-async
specialization, effect rows. All remain downstream of the second driver.

---

## 1. Situation: two async plans, and one experiment

The fork has a settled *language* arc and an unsettled *runtime* arc.

**Language arc (settled).** [generators.md](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)
ships synchronous generators as the first milestone of the concurrency plan:
the split pass ("CPS-transform a function body into a resumable state machine",
[generators.md:5-13](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md))
is **done** (G0 front end + G1 split pass implemented, per
[implementation-plan.md:59-69](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md);
the pass lives in
[codegen/ir/generators.zena](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/codegen/ir/generators.zena)).
Everything it learns — suspension terminators, liveness across suspends, frame
synthesis, resume dispatch — is "reused verbatim when `async`/`await` lands"
([generators.md:8-13](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)).
The plan of record is explicit that async's prerequisite is G1, that the
**first host driver should be JSPI** ("JSPI on a JS host is the cheapest first
event loop; the WASI P3 callback ABI comes second",
[implementation-plan.md:73-81](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md)),
and component-model.md repeats it ("implementation-plan.md puts JSPI ahead of
the WASI P3 callback ABI as the first async host driver",
[component-model.md:653-657](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md)).

**Runtime arc (unsettled).**
[concurrency.md](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)
commits to stackless CPS as the *only* compilation strategy — "Always generate
CPS. Apply JSPI linearization as an **optimization pass** for simple cases"
([concurrency.md:365](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)),
with its JSPI section already noting that "if every `await` is just an import
call, we can emit simpler linear code … but this only works when all awaited
values come from JS imports [and there is] no need for concurrent spawning
within WASM" ([concurrency.md:234-239](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)).
The stackless-only decision itself is a memory argument — bytes-per-task vs
64KB-per-stackful-task ([concurrency.md:5-14](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)).

**The experiment (new).** On 2026-09-15, the jcona project ran a real
zena-compiled WasmGC module through the full pipeline and suspended it
([p3-frontier.solmax.md:433-473](/doc/research/p3-frontier.solmax.md), §5A;
artifacts in `.test-agent/w7/`, summarized here so nothing below depends on
jcona internals):

- Guest source ([`.test-agent/w7/sync-guest.zena`](/.test-agent/w7/sync-guest.zena)):
  `@external("$root", "delay")` import, a GC array allocated and kept live
  across the call — `let values = [value, 1]; return delay(values[0]) + values[1];`
  — exported as `run`.
- WIT world: `import delay: async func(value: u32) -> u32; export run: async
  func(value: u32) -> u32;` — **async effects on both sides**, while
  `wasm-tools component new` emits **plain synchronous** `canon lower` /
  `canon lift` around them (no `async` option on either canon).
- Host: stock **jco 1.33.0** transpile; host `delay(x)` returns a Promise
  resolving after a timer. jco saw the async component type and, with no
  manual selection, wrapped the import in `new WebAssembly.Suspending(…)` and
  the reachable export in `WebAssembly.promising(…)`.
- Result: `value 41`, `isPromise true`, `eventLoopAdvanced true` in **Node
  26.6.0** and **Chrome 150 with no flags**. A GC array reference was live in
  a core local *across a genuine suspension* and survived. Firefox 152 fails
  (`WebAssembly.Suspending is not a constructor`); its compatibility floor is
  153.

Two corrected facts ride along (they matter for risk planning): jco's async
output has a **hard JSPI dependency** — no fallback, no polyfill; and desktop
Chrome shipped JSPI in 137 (jco's own test harness still passes obsolete
experimental flags, which had led earlier notes astray)
([p3-frontier.solmax.md:293-341](/doc/research/p3-frontier.solmax.md)).

So the open question this document answers is no longer *"can JSPI host zena
async at all"* — it can — but **where JSPI's suspension points sit relative to
the planned generator/CPS lowering, and how much of Track G's async half the
first driver actually needs.** The answer changes the sequencing.

## 2. Where JSPI suspension points sit (Q1)

### Outside the transform

Under the proven shape, suspension happens **in the host engine, at
import-call boundaries, and is invisible to ZIR**. When a zena core function
calls a `Suspending`-wrapped import, V8 freezes the entire core Wasm stack —
locals, GC references, `try_table` regions, loop state — and resumes it when
the host Promise settles. Nothing in the guest module knows a suspension
occurred.

That single fact reorganizes the async plan:

- **`async fn` with linear awaits needs no suspension terminator, no split
  pass, no frame struct.** It lowers to an ordinary core function whose calls
  to async-typed imports are ordinary `call`s. The `yield_` terminator
  ([ir.zena:62](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/codegen/ir/ir.zena)),
  liveness-to-frame demotion, state dispatch, and poison states remain
  **generator-only** machinery.
- **Control-flow non-linearity is free.** This is worth saying precisely,
  because it is the axis CPS pays most heavily on: `while` loops containing
  awaits, branches between await sites, state held across awaits (loop-carried
  values, GC graphs) all "just work" — the engine holds the stack. The frame /
  liveness / loop-header-pc machinery in the split pass
  ([generators.zena:18-26](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/codegen/ir/generators.zena))
  exists precisely to reconstruct by hand what JSPI provides natively.
- **`async`-to-`async` zena calls are plain calls.** Two zena `async fn`s
  calling each other emit nothing special — under linear lowering they are
  ordinary functions. `await` on a zena async callee is a no-op marker at the
  core level (the call returns `T` directly); `await` on an async *import* is
  the real, possibly-suspending call. The function-coloring problem
  ("`async` … changes the call protocol for every transitive caller",
  [generators.md:128-130](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md))
  **does not exist in the emitted core code** under this driver — color is
  pure checker/WIT discipline (§4).

### What breaks first

Not loops or branches — **anything that needs a suspension to be a value or a
schedulable entity**:

1. **`Future` as a storable value.** A JSPI-suspended stack is engine state,
   not a guest reference. `let f = fetch(url)` — starting work without
   immediately awaiting — has no linear lowering. concurrency.md's own
   "critical limitation" analysis applies verbatim: JSPI suspends the whole
   stack; there is no mechanism to hold "the rest of this function" as a
   value ([concurrency.md:241-265](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)).
2. **Concurrent awaits within one activation.** `spawn`, `race`, select over
   multiple operations, TaskGroup — all require interleaving that one frozen
   stack cannot express. concurrency.md's remedy (non-suspending
   start-imports returning task IDs, CPS + a JS event-loop orchestrator,
   [concurrency.md:283-354](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md))
   is exactly the guest-side CPS return — i.e., the split pass's async
   activation.
3. **A second in-flight call on the same instance.** The sync lift preserves
   semantics, not concurrency: the synchronous component-instance exclusion
   stays held across the suspension, so two `promising` calls into one
   instance serialize ([p3-frontier.solmax.md:280-283,249-251](/doc/research/p3-frontier.solmax.md)).
   From JS, `Promise.all([run(1), run(2)])` on one zena component runs
   *sequentially*. Multi-tenant shapes (an HTTP handler per request) need the
   async ABI, or multiple instances.
4. **Cancellation.** JSPI has no cancellation protocol; a suspended stack can
   only be resumed with a value or a rejection. p3's subtask-cancel does not
   exist here. This interacts with `finally` (§4).
5. **Memory at scale.** A JSPI suspension costs O(stack depth) — the engine
   spills the Wasm frames — not O(live-across-await). It is far from the 64KB
   fixed-stack worst case and fine for v1's sequential scope, but it is not
   the bytes-per-task story that founded the stackless-only decision
   ([concurrency.md:9-14](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)).
   The CPS decision governs the *destination*; JSPI-linear is the *first
   driver*, and the memory argument is deferred, not repealed.

### When G1's async activation actually happens

Two triggers, both deliberate: (a) the **p3 callback-ABI driver** (§3), where
the guest *must* be a state machine because the runtime calls back instead of
preserving stacks; (b) **guest-internal concurrency on the JS driver** (CPS +
JS orchestrator). At that point `await` becomes a real suspension terminator
and the split pass gains the async effect kind — which it was built for: the
pass is "written against a suspension descriptor, not against `yield`
specifically … For async later: `resume-value (type of await result)`, wrapper
= the WASI P3 callback ABI / JSPI driver from concurrency.md"
([generators.md:363-377](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)).
Nothing in this document asks to change that design — only to *date* it.

## 3. The host contract (Q2)

### The proven contract (jco/JSPI, first driver)

| Side | Contract | Status |
| --- | --- | --- |
| WIT | The world marks import **and** transitively-awaiting export functions `async` | proven ([w7 sync-guest.wit](/.test-agent/w7/sync-guest.wit)) |
| Canonical ABI | **Synchronous** `canon lower` / `canon lift` (default; no `async` option) — the p2 flat core signature | proven; an async-typed export may be sync-lifted and may synchronously call an async import ([p3-frontier.solmax.md:210-236](/doc/research/p3-frontier.solmax.md), citing Component Model Concurrency.md) |
| Guest core | Ordinary core module; async imports are ordinary imports; GC refs live across suspension | proven with real zena WasmGC output |
| Host JS | Import: a Promise-returning function, wrapped by jco in `WebAssembly.Suspending`. Export: wrapped in `WebAssembly.promising`, so JS sees a Promise | proven; a non-Promise import result passes through synchronously without suspending |
| Instantiation | Async instantiation (jco `-I async`); **feature-gate**: require `WebAssembly.Suspending` + `promising` before evaluating bindings, with a clear error | proven; Node 26+ and Chrome 137+ (150 verified unflagged); Firefox 153 target; Safari none |
| WASI | **Stay p2**: jco maps per-interface by exact version; p3 preview3-shim's browser build is a skeleton (random-only operational) | verified; do not couple language async to it |

What jco needs from zena: **nothing beyond what the experiment used.** The
async-typed component is enough for jco to infer JSPI — no manual wrapper
selection. The rough edges are jco-side and known: `jco run` fails to symlink
`preview3-shim` into its temporary runtime; its browser harness passes
obsolete Chrome flags; a skipped stackful WAST case marks an acknowledged
conformance gap ([p3-frontier.solmax.md:611-613](/doc/research/p3-frontier.solmax.md)).
Upstream jco issues are worth filing but do not gate zena.

### Why the p3 callback ABI is the *second* driver

The native stackless ABI is genuinely reachable — a second hand-written zena
guest drove the full protocol (`[async-lower]` import, packed
`STARTED | subtask<<4` status, waitable-set join, `WAIT | set<<4` return, the
`[callback][async-lift]` companion, `[task-return]`), and produced the same
`41` in Node and Chrome ([p3-frontier.solmax.md:475-505](/doc/research/p3-frontier.solmax.md),
§5B). The recent fork patches already expose every naming/type seam it needs
(`@external` arbitrary module/field strings; `@exportName` for mangled names).

What breaks is not expressibility but **everything a production lowering must
generate**: per-task CPS frames and a callback dispatcher (this *is* the
G1-derived machinery), task-local state instead of globals, result-buffer
lifetimes across `STARTING`/`STARTED`/`RETURNED`, waitable/subtask cleanup on
success, trap, and cancellation, future/stream element lowering, and
`task.return` for every result shape
([p3-frontier.solmax.md:410-425](/doc/research/p3-frontier.solmax.md)). That
is the largest codegen slice on the roadmap, and requiring it first would
force zena to validate its *source-level* async design through its *hardest*
runtime target. wasmtime-p3 earns its place immediately after: it is the
conformance oracle that checks the native Component Model ABI without JSPI
and forces correct task/cancellation/resource semantics
([p3-frontier.solmax.md:586-594](/doc/research/p3-frontier.solmax.md)).
The hand-written callback guest is the conformance seed for that work.

## 4. Typing and syntax surface for async v1 (Q3)

`async`/`await` are already tokenizer-reserved in the self-hosted compiler —
"Reserved for async functions (concurrency.md); not yet parsed"
([tokenizer.zena:203-207](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/tokenizer.zena))
— reserved at G0 alongside `gen`/`yield` precisely so this moment would be
one tokenizer divergence, not two. The surface below is the minimal viable
semantics consistent with the linear driver:

- **`async` modifier on functions/methods; the declared return type spells
  `Future<T>`.** This was decided at generators.md's annotation question and
  explicitly extends to async ("`async` follows suit: annotations spell
  `Future<T>`",
  [generators.md:665-669](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md);
  also [:103](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)).
  Note concurrency.md's inline sketches predate that decision and spell the
  awaited result (`async (url: string) => Response`,
  [concurrency.md:56-71](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md));
  the Future-spelling rule should win when the two are reconciled.
- **`await e : Future<T> → T`, syntactically immediate on a call.** In v1,
  `await` applies only to (a) calls to async-typed imports and (b) direct
  calls to zena `async fn`s. An async call must be immediately awaited or
  immediately returned (tail position) — `let f = fetch(u);` (binding a
  `Future`) is a loud v1 diagnostic. This keeps the linear lowering honest:
  no `Future` value ever exists at runtime, so nothing can be stored,
  passed, or leaked into a combinator the driver can't express.
- **Async is a checker-level color; the core code is color-free.** Calling an
  async fn outside `await`/tail position, or an `await` in a non-async
  function, is a type error. This is load-bearing for the *host* contract:
  every exported function that transitively reaches an await must be
  async-typed in the WIT, because a non-async component task that
  synchronously calls an async-typed import traps — even if that particular
  call would have completed immediately
  ([p3-frontier.solmax.md:269-272](/doc/research/p3-frontier.solmax.md),
  citing CanonicalABI.md). Declared types make this a local check; note the
  open transitive-helper question
  ([p3-frontier.solmax.md:603-604](/doc/research/p3-frontier.solmax.md)) is
  answered by *type propagation through declared signatures*, not by
  post-resolution analysis.
- **`await` in a non-async closure nested in an async fn is an error** — same
  rule as `yield` ([generators.md:114-116](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)).
- **`await` inside `try` (either block) is banned in v1.** See below — this is
  the sharpest finding.

### try/finally, host rejection, and the exception seam

Zena exceptions are a **single void tag plus a mutable payload global** —
chosen because a payload-carrying tag breaks catch-target block arity
([exceptions.md:73-116](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md)).
`catch` compiles to `try_table (catch $zena_exception $catch)` — a **tag-only**
clause
([expressions.ts:332-419](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/codegen/expressions.ts));
no `catch_all` exists anywhere in either compiler's codegen (verified by
search). The doc's own open question flags the gap: JS exceptions can be
caught as `externref` by Wasm EH, and zena cannot yet distinguish them
([exceptions.md:146-148](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md)).

Now the async interaction. Under JSPI, a rejected host Promise resumes the
suspended stack by **throwing the rejection reason at the import call site**
— a *foreign* exception arriving inside the guest. Consequences:

1. `try { let x = await fetch(u); } catch (e) { … }` would **not catch a host
   rejection** with today's tag-only catch — the foreign exception unwinds
   past it, through the promising wrapper, rejecting the outer Promise.
   Silently-wrong-looking control flow of exactly the kind v1 must not ship.
2. `finally` across an await is *mechanically* fine — suspension preserves
   `try_table` regions with the rest of the stack — but its semantics are
   entangled with (a) how a foreign exception should be classified into
   zena's Error model and (b) cancellation, which will eventually need
   pending-`finally` answers ("what happens to a pending `finally` when a
   task is cancelled" — the same question generators.md refuses to answer
   prematurely, [generators.md:392-409](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)).

Recommendation: v1 mirrors the generator ban (`yield` inside `try` rejected
with a diagnostic, [generators.md:117-119](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md))
with `await` inside `try` rejected likewise, and the foreign-exception
classification question scheduled *once*, together with cancellation, when the
p3 driver forces it. The alternative — add `catch_all` + externref
classification now — is real work with real semantic choices (what type does
`catch (e)` bind for a foreign rejection?) that no first slice needs.

### The DCE/monomorphization seam, and why declared-async protects it

The findings log's repeated lesson: **"DCE + overload/operator resolution is
zena's most fragile interaction."** Two concrete 2026-09 bugs: `--dce` culled
`@intrinsic` overload families to a single wrong overload (emitting
`i64.div_u` over i32 operands → invalid module), and DCE's usage analysis
tracked only `==`/`!=` among resolved operator methods so `String.operator+`
was culled while its `MethodInfo` kept sentinel index −1 ("unknown function
127") ([work-outline findings log](/doc/research/work-outline.glm53max.md),
2026-09-15/2026-09-16 entries).

An *inferred* async effect — Zig-pre-0.11-style, where a function's
asyncness depends on whether its (possibly monomorphized, possibly
overload-resolved) callees await — would create exactly this hazard class: a
whole-program effect pass whose result depends on resolution and DCE
ordering. The design already keeps the door open to that future via
monomorphization (maybe-async as a specialization axis,
[generators.md:575-607](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md));
v1 should not walk through it. **Declared-async + `Future<T>`-in-the-type**
means asyncness is fixed at check time, DCE and specialization cannot change
it, and the future WIT/bindgen emitter just reads types. Symmetrically, the
linear lowering adds **zero new always-emitted core helpers** (async fn =
ordinary fn; await = ordinary call), so DCE sees an ordinary module and the
cull-bug class has no new surface here. For contrast, note what async *would*
add under the p3 driver: entry/callback/task-return/waitable helpers whose
presence and indices must survive DCE — that seam should be designed when the
second driver is built, with these precedents in hand.

One adjacent, already-known hazard to carry forward: exception-using programs
legitimately root `env.captureStackTrace` under `--dce` (throwing constructs
`Error`, whose constructor captures a stack trace), so realistic guests keep
an externref import that components must satisfy
([work-outline findings log, 2026-09-16](/doc/research/work-outline.glm53max.md)).
Await-using guests will throw more, not less; the lazy/optional stack-trace
stdlib variant stays load-bearing.

### GC references across suspension

Proven safe, not assumed: the w7 guest kept a GC array in a core local across
a real suspending host call and used it after resumption
([`.test-agent/w7/sync-guest.zena`](/.test-agent/w7/sync-guest.zena); Node +
unflagged Chrome green,
[p3-frontier.solmax.md:460-473](/doc/research/p3-frontier.solmax.md)). No
core-to-linear-memory spilling of GC state is needed across an await — the
engine preserves the WasmGC stack. This removes the biggest generic risk for
a GC-first language on JSPI.

## 5. Sequencing recommendation (Q4)

### What lands first: the language slice, not the host driver

The host contract is *already proven* (that was the point of W7/F3). The next
unit of work is the compiler slice, and it is small because the driver does
the hard half:

1. **Self-hosted front end** (per the fork's organizing principle that
   expansions land self-hosted-only, bootstrap never learns them,
   [implementation-plan.md:41-49](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md)):
   parse `async`/`await` (tokens reserved), checker rules per §4
   (`Future<T>` annotations, await-on-call, color propagation, closure/try
   rejections, tail-return allowance).
2. **Core lowering: deliberately nothing new.** An async fn lowers to the
   ordinary function it already is; an awaited async import is an ordinary
   `@external` call. (The `preRec`/standalone-type and `@exportName` fork
   patches already cover the naming/type seams
   [p3-frontier.solmax.md:391-399](/doc/research/p3-frontier.solmax.md).)
3. **WIT: hand-authored async worlds at `component embed` time.** Worlds are
   external today; marking `delay`/`run` async in the world file is how the
   experiment worked. Async effects flow into Track W bindgen later
   (component-model.md stage 8 already sequences p3 after async,
   [component-model.md:520-523](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md)).
4. **Host kit**: feature-gate (`Suspending` + `promising` present) with a
   clear error before evaluating bindings; Node 26+ / Chrome 137+ floor
   stated; custom Promise-returning host imports for genuinely async
   operations; p2 shims for ordinary WASI.

One practical migration to plan for: the experiment pipeline drove the
*bootstrap* CLI, but the async surface exists only in the *self-hosted*
compiler. The self-hosted compiler's emission shape is verified-similar
([zena-targets §7](/doc/research/zena-targets.glm53max.md)), but its
componentization path needs its own verification pass — budget it as part of
the slice, not an afterthought.

### Deliberately deferred (with the trigger that pulls each forward)

| Deferred | Pulled forward by |
| --- | --- |
| `Future` combinators, first-class Future values | guest-internal concurrency (CPS + JS orchestrator) |
| spawn / race / select / TaskGroup / channels | same — structured concurrency is Phase 5 work ([concurrency.md:1445-1450](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)) |
| Cancellation, `await`-in-`try`, foreign-exception classification | one shared design moment, with the p3 driver (subtask-cancel forces it) |
| G1 async activation (resume-value slot, async effect kind in the split pass) | p3 callback-ABI driver |
| Future/stream lowering, waitables, task.return shapes | p3 callback-ABI driver |
| `async gen` / `AsyncIterator<T>` | after both suspension kinds exist ([generators.md:567-573](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)) |
| maybe-async / effect rows | post-rows track, unchanged ([generators.md:594-607](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)) |

### Risk register

| Risk | Exposure | Mitigation |
| --- | --- | --- |
| JSPI engine matrix | Hard dependency: Chrome 137+ ✅, Node 26+ ✅, Firefox 153 *target* (152 verified absent), Safari none | Load-time feature gate with clear error; state the floor; treat Safari/Firefox coverage as the p3 driver's portability argument |
| jco churn | p3 machinery moving fast; async correctness fixes landed days before the evidence checkout; known stackful conformance gap; `jco run` preview3-shim symlink bug | Pin jco/wasm-tools versions in the pipeline; file upstream issues; drive transpile (not `jco run`) |
| preview3-shim browser skeleton | Only random operational in-browser | Keep WASI p2; custom Promise imports for async host ops (already the recommendation) |
| Instance exclusion | One in-flight activation per component instance under sync lift; concurrent JS calls serialize | Document as v1 semantics; multi-instance or p3 driver for concurrent workloads |
| Stack memory at scale | O(stack depth) per suspended activation vs the stackless end-state | v1 scope is sequential; CPS destination unchanged |
| await-in-try correctness hole | Host rejection uncaught by tag-only `catch` | v1 ban (§4); schedule classification with cancellation |
| Self-hosted emission parity | Async exists only in the self-hosted compiler; componentization proven on bootstrap output | Verify self-hosted module → embed/new/jco end-to-end as slice acceptance |

## 6. Decisions upstream must make

Framed as decisions, with recommendations — this document's answers are in
parentheses:

1. **Linear-first or always-CPS?** Amend concurrency.md's "Always generate
   CPS; JSPI linearization as an optimization" to "linear is the shipped v1
   lowering; CPS is the destination lowering, activated by the p3 callback
   driver and guest-internal concurrency." (Yes — the evidence makes linear
   not a special case but the whole first slice, and G1 reuse is deferred,
   not cancelled.)
2. **Declared-async only, forever-for-v1?** Commit that asyncness is carried
   by declared types (`Future<T>`), never inferred across monomorphization,
   before any async code lands near DCE. (Yes.)
3. **`await`-in-`try` in v1: ban or support?** If support: design
   foreign-exception classification (`catch_all` + externref → what zena
   type?) now. (Ban, and schedule classification together with cancellation —
   the generators precedent of answering the protocol question once.)
4. **`Future<T>` opacity level:** await-must-be-syntactically-immediate (no
   Future bindings at all in v1), or bindable-but-inert Futures? (Immediate
   only — it is the honest subset of what the driver can express, and every
   relaxation is observable API surface.)
5. **Browser floor:** is Chrome+Node-now / Firefox-153-when-it-ships an
   acceptable public floor, and is Safari a required target at all? (Chrome +
   Node floor, stated; Safari only via the second driver or never.)
6. **Host-import surface for v1:** a small custom WIT package of
   Promise-returning host functions (worlds hand-authored), or a compiler
   marker (`@asyncExternal`-style) that types an import async before bindgen
   exists? (Custom WIT package first — zero compiler surface; revisit the
   marker when Track W bindgen shapes exist. This is also
   [p3-frontier open question 3](/doc/research/p3-frontier.solmax.md).)
7. **Which compiler emits async, and what proves it:** confirm self-hosted-only
   per the expansion rule, and accept the self-hosted componentization
   verification as part of the slice. (Confirm.)
8. **Where does the async effect live in bindgen** when Track W exists —
   read from checker types only, or re-derived? (Checker types only; same
   reasoning as decision 2.)
9. **Is one-activation-per-instance acceptable, documented v1 semantics?**
   (Yes, documented; the p3 driver and multi-instance hosting are the
   escalations.)

## References

**Fork design docs** (read-only checkout `/home/rektide/src/zena-jco-fork`):

- [docs/design/generators.md](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md) — Track G foundation; §5.3 suspension descriptor (async forward-compat), §6 yield-in-try, §8 async relationship, §9 milestones/status.
- [docs/design/concurrency.md](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md) — stackless-only decision; JSPI section incl. linear-code insight, one-stack limitation, CPS+JS orchestration, "always generate CPS" strategy, implementation phases.
- [docs/design/implementation-plan.md](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md) — plan of record; Track G status; "async's prerequisite is G1"; JSPI-first note; self-hosted-only expansion rule.
- [docs/design/component-model.md](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md) — Part 7 (p2 HTTP before async), Part 8 (build stages; stage 8 = p3 after async), plan-of-record cross-reference putting JSPI ahead of the p3 callback ABI.
- [docs/design/exceptions.md](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md) — single void tag + payload global, try_table compilation, JS-interop open question.

**Fork code** (evidence sites):

- [packages/zena-compiler/zena/lib/tokenizer.zena:203-207](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/tokenizer.zena) — `async`/`await` reserved, not yet parsed.
- [packages/zena-compiler/zena/lib/codegen/ir/generators.zena](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/codegen/ir/generators.zena) — the G1 split pass (ramp + dispatcher-loop state machine; "revisit with the async runtime").
- [packages/zena-compiler/zena/lib/codegen/ir/ir.zena:62](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/codegen/ir/ir.zena) — `yield_` suspension terminator.
- [packages/compiler/src/lib/codegen/expressions.ts:332-419](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/codegen/expressions.ts) — try_table with tag-only catch (no `catch_all` in either compiler).

**jcona empirical research** (this repo):

- [doc/research/p3-frontier.solmax.md](/doc/research/p3-frontier.solmax.md) — the decisive experiments (sync-ABI zena guest over JSPI; hand-written p3 callback guest; JSPI engine matrix; preview3-shim status; corrected JSPI facts), with upstream citations.
- [doc/research/zena-targets.glm53max.md](/doc/research/zena-targets.glm53max.md) — exact emission surface of both zena compilers; componentization paths; `preRec`/type-identity history.
- [doc/research/work-outline.glm53max.md](/doc/research/work-outline.glm53max.md) — plan of record; findings log (DCE/resolution fragility pattern; exceptions-vs-DCE env-import rooting).
- [.test-agent/w7/](/.test-agent/w7/) — experiment sources and logs: `sync-guest.zena` / `sync-guest.wit` (experiment A), `stackless-await.zena` (experiment B), engine logs.

**Upstream specs/tools** (as cited and linked from p3-frontier):

- [Component Model Concurrency.md](https://github.com/WebAssembly/component-model/blob/main/design/mvp/Concurrency.md) and [CanonicalABI.md](https://github.com/WebAssembly/component-model/blob/main/design/mvp/CanonicalABI.md).
- [JSPI proposal overview](https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md).
- [MDN browser-compat: WebAssembly.Suspending](https://github.com/mdn/browser-compat-data/blob/main/webassembly/api/Suspending.json) — Chrome 137, Firefox 153, Safari false.
