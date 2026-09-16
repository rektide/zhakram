---
type: Synthesis
title: "What JSPI means to zena — syn1 (cross-review of design0/design1)"
description: Cross-review and re-integration of the two independent JSPI/async design waves into one upstreamable position; adjudicates their tensions against fork sources and experiment evidence.
resource: /doc/jspi/syn1.glm53h.md
tags: [zena, jspi, async, wasi-preview3, component-model, track-g, synthesis]
status: draft
generated: { by: agent:glm53h (zai-coding-plan/glm-5.3#high), at: 2026-09-16 }
verified: { by: unverified, at: never }
stale_after: 2026-12-16
sources:
  - id: design0
    resource: /doc/jspi/design0.glm53max.md
  - id: design1
    resource: /doc/jspi/design1.solmax.md
  - id: zena-fork
    resource: file:///home/rektide/src/zena-jco-fork/docs/design/
    title: fork design docs, re-read for adjudication (full list in References)
  - id: p3-frontier
    resource: /doc/research/p3-frontier.solmax.md
---

# What JSPI means to zena — synthesis of design0 and design1

Two independent design waves answered *"what does JSPI mean for zena's
async?"* (ticket zenajco-f3-slice1, design-first mandate):
[design0](/doc/jspi/design0.glm53max.md) (glm53max) promotes JSPI-linear
from optimization to **the entire v1 lowering** — a front-end-only compiler
slice, all generator/CPS machinery deferred;
[design1](/doc/jspi/design1.solmax.md) (solmax) accepts JSPI-first only as
a **named, bounded retained-stack profile** of a driver-neutral contract,
with an await-site representation kept in compiler data so the second
driver implements *the same language*. Contested facts were re-checked
in the fork; citations give path:line where a fact was decided.

## 1. Common ground (confirmed, not assumed)

The agreements below are confirmed against the fork sources:

1. **JSPI is the first host driver; native p3 callbacks the second** —
   the fork's plan of record
   ([implementation-plan.md:71-85](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md)),
   now proven: a real zena WasmGC module suspended through jco/JSPI with
   a live GC array across the suspension, Node 26.6 + unflagged Chrome
   150 ([p3-frontier §5A](/doc/research/p3-frontier.solmax.md)). The
   proven host contract is the **sync canonical ABI with async WIT
   types**: no `async` canon option; jco infers
   `WebAssembly.Suspending`/`promising` from the types
   ([p3-frontier §2](/doc/research/p3-frontier.solmax.md)).
2. **Linear awaits are the v1 profile, and `Future<T>` is not reifiable**:
   at most one operation in flight per activation; branches, loops, serial
   awaits, transitive helpers, and tail `return await e` are in;
   spawn/race/select/TaskGroup/storable `Future` are out; `await` applies
   only to an immediate call, and binding/storing/passing a `Future` is a
   loud diagnostic. (See §2.3 — the apparent tension here is agreement.)
3. **Async-ness is declared, never inferred**; `Future<T>` in the
   signature *is* the effect marker — both docs ground this in the
   findings-log hazard (DCE + overload/operator resolution is the
   compiler's most fragile interaction,
   [work-outline](/doc/research/work-outline.glm53max.md)); an inferred
   effect would make asyncness depend on exactly that pipeline.
4. **The annotation spells the wrapper: `async f(): Future<T>`, `return e`
   checks against `T`** — generators.md's resolved principle, verified at
   [§2.2, §10.2](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md):
   "`async` follows suit: annotations spell `Future<T>`." concurrency.md's
   inline sketches (`async (url) => Response`) predate that decision and lose.
5. **`await` inside `try`/`catch`/`finally` is banned in v1**, mirroring the
   `yield`-in-`try` ban
   ([generators.md §6](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md));
   neither designs rejection/cancellation under time pressure (§2.2).
6. **Operational posture**: WASI stays p2 (async host operations are
   small custom Promise imports); the JSPI dependency is hard — floor
   Chrome 137+/Node 26+, Firefox 153 target, Safari none
   ([p3-frontier §3](/doc/research/p3-frontier.solmax.md)), gated at
   load; one activation per component instance under sync lift (calls
   serialize) is accepted, documented v1 semantics.
7. **wasmtime-p3 is the second driver and conformance oracle**; G1's
   split pass is the machinery it activates — "written against a
   suspension descriptor, not against `yield` specifically"
   ([generators.md §5.3](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)).

That is an unusually large common core; the disagreements are *slice
scope*, *where the driver-neutral seam lives*, and *how loud the rejection
hole must be*.

## 2. Tensions, adjudicated

### 2.1 Real: "front-end-only v1" vs "driver-neutral suspension IR in v1"

**The claim.** design0 makes async v1 a **front-end-only slice**: core
codegen is a no-op (async fn = ordinary function; awaited import =
ordinary `call`), ZIR gains nothing, WIT effects are hand-authored at
`component embed` time
([design0 Decisions 3, §5](/doc/jspi/design0.glm53max.md)). design1's
Slice B instead adds "a resolved suspension descriptor with
success/failure continuations" to compiler data before codegen, so
that "typing, diagnostics, liveness, exception regions, DCE roots, and
driver selection [do not] become JSPI-specific syntax checks"
([design1 §2.3, Slice B](/doc/jspi/design1.solmax.md)).

**Adjudication — design0 wins on build scope; design1 wins on contract
framing; the seam belongs at the contract level, not the IR level.**

The decisive fact is the docs' own shared decision: **async is
declared**. Because every async function's signature carries `Future<T>`,
the async-ness of any *resolved* call is recoverable at any pipeline stage
from the callee's declared signature — no inference, no whole-program
pass, no syntax check. Under linear lowering the "success continuation"
is fall-through and the "failure continuation" is ordinary unwind; the
descriptor design1 wants is *trivially re-derivable*, and building its
plumbing in v1 buys nothing the second driver can use: when the p3 driver
activates, the fork's own design says the mechanism is the G1 split
pass's general suspension descriptor
([generators.md §5.3, verified above](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)),
not a v1-era IR annex. A new always-carried IR concept near the fragile
resolution/monomorphization/DCE pipeline is exactly what the findings log
says to avoid — design0's minimality argument, stronger than design1's
precaution.

But design1's *underlying concern* is correct and design0 under-states it:
the danger is not "no IR", it is **"JSPI observed behavior becomes the
language definition"**. design1's rule — *"a driver may choose a different
physical continuation representation, but it may not choose different source
semantics"* ([design1 §1](/doc/jspi/design1.solmax.md)) — is the right
constitutional constraint, and design0's text doesn't say it. Three
cheap, non-IR commitments capture everything design1's IR would have
protected: **name the profile** (`async-linear-jspi` — a declared target
capability, not an emergent property of what wasn't built); **one
internal async-import fact** (the checker must know an import is async to
type `await` on it in v1 regardless of driver — design1 D4's fact, fed by
design0's custom WIT package; that fact, not a JSPI check, is the seam
future driver selection reads); and **exit criteria** (design1's
"direct path becomes permanent" risk), so deferral is dated not default.

**Resolution:** v1 = design0's slice scope (no new ZIR constructs, no new
emitted code, hand-authored worlds) wrapped in design1's contract framing
(named profile, one-semantic rule, async-import fact, exit criteria).

### 2.2 Real (in emphasis and next-step): await-in-try and the rejection hole

**The claim.** Both ban `await` inside `try` in v1. design0 grounds the
ban in a **verified codegen fact** — zena's `catch` compiles to a
tag-only `try_table (catch $zena_exception …)` clause, so a host Promise
rejection, delivered by JSPI as a *foreign* exception at the import call
site, unwinds past every zena `catch`
([design0 §4](/doc/jspi/design0.glm53max.md)). design1 elevates the same
hole to D5 (normalize rejections into catchable zena `Error`s,
eventually) and adds the sharpest framing in either doc: JSPI's native
stack makes `finally`-across-await *appear* to work, and shipping that
as the spec would leave the p3 driver implementing a different language
([design1 §4.2](/doc/jspi/design1.solmax.md)).

**Adjudication — design0's mechanism is verified and correctly stated;
design1's framing is the one to upstream; one cheap experiment is missing
from both.** I re-verified design0's factual chain in the fork: the TS
compiler emits `try_table` with exactly one `CatchKind.catch` clause on
the zena tag
([expressions.ts:332-419](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/codegen/expressions.ts));
the self-hosted emitter matches
([emit.zena:835-836](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/codegen/ir/emit.zena));
`catch_all` exists only in opcode tables
([wasm.ts:302-305](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/wasm.ts))
and is emitted by neither compiler; the single-void-tag design and its
JS-interop open question are as cited
([exceptions.md:70-150](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md)).
design0 was also scrupulous that the *delivery* half — a rejected Promise
actually unwinding — is spec-derived, not experimentally pinned; no
rejection experiment exists in [p3-frontier](/doc/research/p3-frontier.solmax.md)
or [.test-agent/w7/](/.test-agent/w7/) (fulfillment only).

Where design1 is better: the ban should be stated **driver-neutrally**
(suspension in a protected region) and lifted only when rejection
normalization, cancellation, and failure-during-cleanup are designed
*once, together, and tested on both drivers* — otherwise the JSPI driver
silently defines `finally` semantics the p3 driver cannot honor.

**Resolution:** v1 ships the ban as a diagnostic, per both. Add what
neither scheduled: **run the rejection-delivery experiment now** — a
one-line variant of the w7 harness (host import rejects instead of
resolving) that turns "spec-derived" into "pinned" for the upstream
argument. The classification design itself (catch_all + externref → which
zena type?) stays scheduled with cancellation at the p3 driver.

### 2.3 Illusory: must `Future<T>` be reifiable in v1?

design1 calls this its sharpest decision (D1); design0 answers inside
Decision 4 without ceremony. **The answers are the same: no.**
Non-reifiable, immediate-consumption-only futures; `let f = fetch(u)` is
a diagnostic; the first fundamentally non-linear shape is the separation
of *start* from *wait* (design1's formulation, the wording to upstream).
design1's honest construction of the yes-branch (yes = a task handle +
scheduler *in slice 1*, abandoning the JSPI-first rationale) makes this
the right first question upstream — but there is no inter-doc conflict
to resolve.

### 2.4 Mostly illusory: does async v1 create new DCE surface?

design0: linear lowering adds "zero new always-emitted core helpers", so
DCE sees an ordinary module
([design0 §4](/doc/jspi/design0.glm53max.md)). design1: async spreads the
known failure class, with a seven-step pipeline contract and a `--dce`
regression matrix ([design1 §5](/doc/jspi/design1.solmax.md)).

**Adjudication:** for the *emitted core*, design0 is right — an async fn is
an ordinary fn; nothing new to cull or mis-cull; remaining DCE hazards are
pre-existing. design1's matrix, read closely, is mostly about artifacts
that do not exist in design0's v1: derived WIT effects (v1 worlds are
hand-authored), p3 entry/callback/task-return glue (second driver),
promising/suspending boundary glue (jco generates it, zena does not). Two
design1 items genuinely matter to v1 and are cheap: (a) **world/module
drift** — a hand-authored world's async import that no surviving code calls
still becomes a host requirement; add a link-time cross-check to the
slice's acceptance; (b) design1's D7 pipeline contract (effects from the
resolved, monomorphized call graph before DCE roots finalize, plus a
post-DCE verifier) is the right spec for Track W bindgen — record now,
build later.

### 2.5 A factual nuance neither doc nailed: *why* async-typing exports is mandatory

design0 justifies "every export transitively reaching an await must be
async-typed in the WIT" by citing the CanonicalABI rule that "a non-async
component task that synchronously calls an async-typed import traps"
([design0 §4](/doc/jspi/design0.glm53max.md), after
[p3-frontier](/doc/research/p3-frontier.solmax.md)). The citation is
faithfully reported, but the mechanism conflates two different traps:
that CanonicalABI rule governs the *task-machinery* case
(async-**lowered** imports, packed status/waitables), while in the proven
shape — no async canon option anywhere — the binding constraint is jco's
**wrapper placement**: jco installs `Suspending` on async-*typed*
imports and `promising` on async-*typed* exports
([p3-frontier §3](/doc/research/p3-frontier.solmax.md)); a `Suspending`
import reached from a non-`promising` stack cannot suspend (native
`SuspendError`), and without the async type on the import there is no
suspension at all. The WIT discipline both docs prescribe is **correct
and necessary either way** — but the upstream argument is cleaner if it
says: *the async effect in the WIT type is what makes jco install the
JSPI wrappers; omit it and you either never suspend or suspend a stack
that cannot*. Neither doc is *wrong* about the prescription; design0's
mechanism sentence is the only factual claim in either doc that needed
correction.

### 2.6 Granularity: one slice vs five

design1's Slice A ("freeze the contract") is a *document*; its B+C
recapitulate design0's single slice plus the IR descriptor rejected in
§2.1. **Resolution:** Slice A as an explicit step (it *is* the
concurrency.md amendment PR), then design0's slice as the one
implementation unit, D+E as the recorded future, D9 as driver two's
completion bar.

## 3. The synthesis — jcona's upstreamable position

**JSPI-first is confirmed, as a named profile of one language.** Zena's
async v1 is the **linear-await profile**: `async fn` with explicit,
immediate `await`; at most one in-flight operation per activation;
`Future<T>` declared in signatures, never reified; the engine-retained
stack is the continuation representation *for this profile only* and
confers no stackless memory claim. The driver-neutral guarantee is
carried by the contract, not new IR: one source semantics, one internal
async-import fact, a profile name, exit criteria. The **p3 callback ABI
/ wasmtime-p3 is the second driver and the conformance oracle**: it
activates G1's split pass as designed
([generators.md §5.3](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)),
must pass the *same source-level suite* under both drivers, and owns the
one shared design moment for rejection classification, cancellation, and
await-in-exception-regions (the generators' yield-in-try ban lifts with
it). concurrency.md's "Always generate CPS"
([concurrency.md:356-365](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md))
is amended to: *linear-await is the shipped v1 profile; CPS is the
destination lowering, activated by the p3 driver and guest-internal
concurrency* — deferred, not repealed, as with the memory argument.

Slice contents (one unit, upstream PRs):

1. **Contract document** (design1 Slice A): §4's decisions written as the
   concurrency.md amendment + language-reference section.
2. **Front end**: `async`/`await` parsing; `Future<T>` annotation rule;
   await-on-immediate-call typing; color propagation; closure/try
   diagnostics; tail-`return await`; async-import fact plumbed from
   hand-authored WIT (custom Promise WIT package; no `@asyncExternal`
   marker until bindgen exists — both docs' lean).
3. **Core codegen: nothing** (async fn = ordinary fn; awaited async import =
   ordinary `@external` call).
4. **Host kit**: capability gate before bindings evaluation; floor
   Chrome 137+/Node 26+, Firefox on tested releases only (CI probe, not
   proposal status — design1 D8), Safari unsupported; p2 shims.
5. **Acceptance**: self-hosted-compiler module through embed/new/jco
   end-to-end (design0's parity item — the experiment drove the bootstrap
   CLI, but async syntax exists only in the self-hosted compiler); GC
   refs live across suspension; serial awaits, branches, loops,
   transitive helpers; the rejection-delivery experiment (§2.2);
   world/module drift cross-check (§2.4).

**Deferred, with triggers** (the docs' tables are equivalent here):
`Future` combinators/values, spawn/race/select/TaskGroup/channels →
guest-internal concurrency (CPS + JS orchestrator); rejection
classification, cancellation, await-in-try/finally → one design moment at
the p3 driver; G1 async activation, future/stream lowering, waitables,
task.return → p3 driver; `async gen` and maybe-async/effect rows →
their later tracks.

## 4. Open decisions for upstream (ordered)

Blocking the slice:

1. **Is `Future<T>` reifiable in async v1?** (Recommendation, both docs:
   **no** — immediate, non-escaping awaitables only. Everything else keys
   off this; a *yes* means a task handle + scheduler in slice 1 and the
   JSPI-first rationale collapses.)
2. **Amend concurrency.md's codegen strategy?** Linear-await becomes the
   shipped v1 *profile* (named, e.g. `async-linear-jspi`); "always CPS"
   remains the destination lowering, activated by the p3 driver and
   guest-internal concurrency. design1 D2's caveat: if maintainers read
   "stackless-only" as an implementation invariant rather than an
   architecture goal, they should reject the profile and build CPS +
   JS-event-loop first — the honest fork in the road.
3. **await-in-try: documented v1 ban, or blocker?** Ban now as a
   diagnostic; run the rejection-delivery experiment for evidence; schedule
   classification *with* cancellation at the p3 driver, lifted per design1
   D6 only when both drivers pass the shared cleanup tests. If upstream
   reads uncatchable host rejections as a correctness hole rather than a
   documented restriction, D5's normalization moves into slice 1 — the one
   place this synthesis could be forced wider.
4. **Annotation spelling** — confirm `async f(): Future<T>` per generators
   §2.2/§10.2, superseding concurrency.md's pre-decision inline sketches.

Publication decisions:

5. **Async imports before bindgen**: custom Promise-returning WIT package
   (zero compiler surface) vs an `@asyncExternal`-style marker resolving to
   the same internal async-import fact. (WIT package first.)
6. **Platform floor**: Chrome 137+/Node 26+ stated, feature-probed at load
   and in CI; Firefox on tested releases only; is Safari a required
   target, or is the p3 driver the portability answer?
7. **One-activation-per-instance** as documented v1 semantics (yes, both).

Commitments recorded now:

8. **Where async effects live in bindgen** (Track W): checker types as
   source of truth, effects derived from the surviving post-DCE graph,
   post-DCE verifier (design0 Decision 8 + design1 D7, fused).
9. **p3 driver completion bar** (design1 D9): same suite under jco and
   wasmtime-p3; GC refs across spill/reload; overlapping calls; buffer
   reclamation; rejection + `finally` agreement; no task state in globals.

## 5. Cross-comparison of the sources

| | [design0](/doc/jspi/design0.glm53max.md) (glm53max) | [design1](/doc/jspi/design1.solmax.md) (solmax) |
| --- | --- | --- |
| Characterization | *The engineers' doc*: evidence-first, reorganizes the roadmap around one proven fact (suspension is invisible to ZIR), then ruthlessly minimizes the first slice. | *The architects' doc*: layered contract analysis; center of gravity is the rule that drivers may not choose source semantics. |
| Particular strengths | Verified codegen chain for the rejection hole (I confirmed every link); sharpest DCE-seam analysis (declared-async as DCE protection; "zero new always-emitted helpers"); bootstrap-vs-self-hosted componentization parity item (design1 misses this entirely); risk register with concrete jco failure modes; honest confidence labels flagging which claims are unpinned; "two triggers" dating of G1's async activation. | Layer table + one-semantic rule (best framing either doc produces); crisp definition of linear ("separation of start from wait" as the first non-linear shape); D1's honest construction of the yes-branch; the finally/JSPI-observability trap (shipping engine behavior as spec); D9 completeness bar; the "two risks separated" bottom line (language risk vs scheduler/ABI risk) — best one-paragraph JSPI-first justification in either doc. |
| Relative weaknesses | Treats driver-neutrality as answered by absence ("ZIR gains nothing") rather than by commitment; profile has no name and no exit criteria — how temporary becomes permanent; single-slice granularity leaves the upstream *decision* step implicit. | Slice B's suspension descriptor is speculative IR plumbing whose information content declared types already carry — the one place it over-builds, in a pass pipeline the findings log calls fragile; under-weights verified codegen facts (cites design0's evidence stream rather than re-establishing); DCE matrix mostly scoped at artifacts the leaner v1 doesn't build; no emission-parity item. |

**Fusion logic:** design0's *scope* + design1's *contract* — design0 is
right about what v1 must build, design1 about what v1 must promise: build
list from design0, framing and decision structure from design1, rejection
experiment and world-drift check from neither, design0's one mechanism
citation corrected (§2.5).

## References

**Wave inputs (this repo):** [design0](/doc/jspi/design0.glm53max.md)
(glm53max wave); [design1](/doc/jspi/design1.solmax.md) (solmax wave).

**Fork design docs** (read-only checkout `/home/rektide/src/zena-jco-fork`,
re-read for adjudication; all under `docs/design/`):
[generators.md](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md)
(§2.2/§10.2 annotation rule; §5.3 suspension descriptor; §6 yield-in-try
ban; §8.3 specialization-not-coloring);
[concurrency.md](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md)
(JSPI linear insight + one-stack limitation ~:225-265; "Always generate
CPS" ~:363);
[implementation-plan.md](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md)
(Track G status; "async's prerequisite is G1, not G2"; JSPI-before-p3);
[exceptions.md](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md)
(single void tag + payload global; JS interop open question);
[component-model.md](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md)
(p2-before-p3; DCE-derived worlds).

**Fork code (verified directly for this synthesis):**
[expressions.ts:332-419](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/codegen/expressions.ts)
(tag-only `CatchKind.catch`);
[emit.zena:835-836](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/codegen/ir/emit.zena)
(self-hosted try_table, same shape);
[wasm.ts:302-305](file:///home/rektide/src/zena-jco-fork/packages/compiler/src/lib/wasm.ts)
(`catch_all` in opcode tables only, never emitted);
[tokenizer.zena:203-207](file:///home/rektide/src/zena-jco-fork/packages/zena-compiler/zena/lib/tokenizer.zena)
(`async`/`await` reserved, not parsed).

**jcona research (this repo):**
[p3-frontier.solmax.md](/doc/research/p3-frontier.solmax.md) (§2 pairings;
§"What traps or degrades"; §3 engine matrix; §5A/5B experiments);
[work-outline.glm53max.md](/doc/research/work-outline.glm53max.md)
(findings log); [.test-agent/w7/](/.test-agent/w7/) (experiment sources;
no rejection case — checked for §2.2).

**Upstream specs:** Component Model
[Concurrency.md](https://github.com/WebAssembly/component-model/blob/main/design/mvp/Concurrency.md),
[CanonicalABI.md](https://github.com/WebAssembly/component-model/blob/main/design/mvp/CanonicalABI.md),
[JSPI overview](https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md).
