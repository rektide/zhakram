---
type: DesignAssessment
title: "What JSPI means to Zena"
description: >-
  An upstream-facing design assessment of Zena async/await over a retained-stack
  JSPI driver first and a stackless WASI Preview 3 callback driver second.
resource: /doc/jspi/design1.solmax.md
tags: [zena, async, await, jspi, jco, wasi-preview3, compiler, track-g]
status: draft
generated: { by: agent:openai/gpt-5.6-sol-max, at: 2026-09-16T14:47:16-04:00 }
verified: { by: unverified, at: never }
stale_after: 2026-12-15
sources:
  - id: zena-generators
    resource: file:///home/rektide/src/zena-jco-fork/docs/design/generators.md
    title: Zena generators design and implemented G1 split pass
  - id: zena-concurrency
    resource: file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md
    title: Zena concurrency design
  - id: zena-plan
    resource: file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md
    title: Zena implementation plan, Track G
  - id: zena-components
    resource: file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md
    title: Zena Component Model and WIT design
  - id: p3-frontier
    resource: /doc/research/p3-frontier.solmax.md
    title: Verified jco, JSPI, and Preview 3 frontier
  - id: zena-targets
    resource: /doc/research/zena-targets.glm53max.md
    title: Current Zena emission surface
  - id: zena-exceptions
    resource: file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md
    title: Zena exception semantics and Wasm EH lowering
  - id: work-outline
    resource: /doc/research/work-outline.glm53max.md
    title: jcona posture and compiler findings log
---

# What JSPI means to Zena

## Recommendation summary

**Adopt JSPI as Zena's first async integration driver, but describe it precisely as a bounded retained-stack implementation of a linear-await language profile.** It is not the implementation of Zena's planned stackless task model, and it must not become the semantic definition of `async` or `Future<T>`.

The first slice should do five things:

1.  Define the source contract for `async` functions and explicit `await`.
2.  Represent an await site in driver-neutral compiler data after call resolution, even when the JSPI driver later erases that site to a normal core call.
3.  Compile immediate, serial awaits of async host imports as ordinary straight-line core Wasm calls.
4.  Mark the corresponding component imports and reachable exports `async`, while retaining synchronous canonical lift/lower; let jco install `WebAssembly.Suspending` and `WebAssembly.promising`.
5.  Reject every source shape that would require a reified task, more than one in-flight operation, cancellation unwinding, or a driver-visible continuation.

Then add the native WASI Preview 3 callback ABI as the second driver. That driver activates the G1-derived split machinery: per-invocation frames, resume-value blocks, callback dispatch, waitable sets, `task.return`, and cleanup. It is the portability and stackless-conformance driver.

This ordering agrees with Track G's recorded dependency: async v1 needs G1, not generator fusion, and JSPI is the cheapest first host loop ([`implementation-plan.md:71-85`](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md#L71-L85)). It also refines that statement: the simplest JSPI lowering does not execute the split state machine at runtime. G1 is the architectural seam and the prerequisite for the second driver, not a reason to synthesize a frame that JSPI's retained Wasm stack would duplicate.

The sharpest decision is whether async v1 promises **reifiable** `Future<T>` values. If `let a = fetch(); let b = fetch(); await a` must work in v1, the straight-line JSPI path is insufficient and a task runtime moves into the first slice. If v1 permits only `await fetch()`-shaped, non-escaping futures, the proven path is both small and honest.

## 1. Context for an upstream Zena maintainer

`jcona` is not a competing compiler or an async runtime. It is this project's Zena → `wasm-tools` → jco integration CLI and its supporting host kit ([`README.md:1-8`](/README.md#L1-L8), [`README.md:32-43`](/README.md#L32-L43)). The compiler changes proposed here belong upstream in Zena; jcona supplies packaging, feature checks, host imports, and end-to-end Node/browser evidence.

This assessment is about a planned language feature, not shipped syntax. `async` and `await` are reserved but not parsed, while WIT bindgen, canonical async lowering, and component emission remain unbuilt ([`p3-frontier.solmax.md:342-355`](/doc/research/p3-frontier.solmax.md#L342-L355), [`component-model.md:11-25`](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md#L11-L25)).

Three independently chosen layers are easy to conflate:

| Layer              | Question                                                              | Recommended owner                        |
|--------------------|-----------------------------------------------------------------------|------------------------------------------|
| Zena language      | What do `async`, `await`, return, throw, and cancellation mean?       | checker and language reference           |
| Zena IR            | Where can execution suspend, what is live, and what value resumes it? | ZIR plus suspension analysis             |
| Runtime driver     | Who stores the continuation and wakes it?                             | JSPI-retained stack or P3 callback frame |
| Component boundary | Which imports/exports may block, and which canonical ABI is selected? | WIT/component emission plus jcona        |

The key architectural rule is therefore:

> A driver may choose a different physical continuation representation, but it may not choose different source semantics.

Zena's generator work already establishes the reusable compiler vocabulary. Generators introduce symbolic suspension, liveness across suspension, frame synthesis, resume dispatch, and a resume-value-ready split pass ([`generators.md:212-250`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L212-L250), [`generators.md:362-377`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L362-L377)). The design explicitly says generators build the transform while async adds the runtime protocol ([`generators.md:511-538`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L511-L538)).

JSPI changes the first runtime protocol we should build. It does not invalidate that division.

## 2. Two kinds of suspension, one source-level `await`

### 2.1 The planned Track G path

The long-term Zena design is stackless. An async body is split at await sites; only values live across each site are stored in a task frame, and a callback re-enters a dispatcher at the proper state ([`concurrency.md:5-14`](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md#L5-L14), [`concurrency.md:73-121`](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md#L73-L121)).

Conceptually:

``` text
source async body
    │
    ├─ resolve calls and type await results
    ├─ identify suspension sites and live values
    │
    └─ split driver
         ├─ entry(frame) -> WAIT | EXIT
         └─ callback(frame, event) -> WAIT | EXIT
```

This representation is necessary when the guest itself owns pending tasks, when more than one operation may be in flight, or when the host requires the P3 callback ABI.

### 2.2 The proven JSPI path

JSPI permits a different physical implementation:

``` text
promising JS call
    -> ordinary core export
       -> ordinary core call to async-typed import
          -> jco Suspending trampoline returns a Promise
             [engine parks the complete Wasm activation]
          -> ordinary core call produces T on resume
       -> ordinary core return
    -> Promise<T> settles
```

There is no Zena task frame in this path. The engine preserves the Wasm stack, locals, and program counter. From core Wasm's perspective, the import is a normal call returning `T`.

This is not hypothetical. A Zena-produced WasmGC module retained a GC array in a local across a delayed Promise import and returned the expected value in Node 26.6 and unflagged Chrome 150 ([`p3-frontier.solmax.md:31-43`](/doc/research/p3-frontier.solmax.md#L31-L43), [`p3-frontier.solmax.md:433-473`](/doc/research/p3-frontier.solmax.md#L433-L473)). The fixture itself makes the retained GC local explicit ([`.test-agent/w7/sync-guest.zena:1-10`](/.test-agent/w7/sync-guest.zena#L1-L10)).

The component type was async, but canonical lower and lift remained synchronous. That pairing is allowed: WIT's async effect and the core async ABI are separate choices, and all sync/async caller-callee pairings are designed to compose ([`p3-frontier.solmax.md:75-87`](/doc/research/p3-frontier.solmax.md#L75-L87), [`p3-frontier.solmax.md:210-235`](/doc/research/p3-frontier.solmax.md#L210-L235)).

### 2.3 Where the paths meet

They meet **before continuation representation is selected**:

``` text
resolved async call
    + awaited result type
    + normal-success continuation
    + failure continuation
    + values live after the call
             │
             ├─ JSPI-linear: emit an ordinary call; host stack is the frame
             │
             └─ P3-stackless: spill, return WAIT, resume through callback
```

The compiler should preserve an `AwaitSite`/`await_` concept until target-driver lowering. It need not survive as a Wasm instruction. Its purpose is to keep typing, diagnostics, liveness, exception regions, DCE roots, and driver selection from becoming JSPI-specific syntax checks.

The generator split pass should accept a general suspension descriptor, as its design already anticipates, rather than an `await` implementation calling generator-only APIs. For JSPI-linear, the descriptor is discharged without a frame. For P3, its resume value becomes the resume block parameter and its live set becomes frame fields.

This is a deliberate sequencing refinement to the concurrency draft's “always generate CPS; linearize JSPI as an optimization” rule ([`concurrency.md:356-365`](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md#L356-L365)). Preserve a CPS-capable suspension representation from the start, but do not make a working CPS scheduler a prerequisite for the first retained-stack driver. Once both lowerings exist, JSPI linearization can again be understood as the cheap specialization of the common async IR.

### 2.4 What “linear await” must mean

“Linear” should describe dynamic ownership, not merely source formatting:

- At most one asynchronous operation is in flight for the current activation.
- Starting the operation and waiting for it are one compiler operation.
- The future value cannot be stored, returned, passed, joined, raced, or dropped.
- Every suspension is ultimately caused by an async host/component import.
- Branches, loops, and several serial awaits are allowed.
- A Zena helper may suspend transitively if it remains on the same promising activation and does not materialize a future.

Thus this is valid for the first driver:

``` zena
async load(): Future<Data> {
  let token = await tokenFromHost();
  if (token.isFresh()) {
    return await dataFromHost(token);
  }
  return await refreshThenLoadFromHost(token);
}
```

The first fundamentally non-linear shape is not “a second `await`.” It is the separation of **start** from **wait**:

``` zena
let user = fetchUser();       // must return a reified, running Future<User>
let posts = fetchPosts();     // both must now be in flight
return (await user, await posts);
```

With direct JSPI lowering, the first call parks the entire activation, so the second call cannot start. The upstream design identifies this exact limitation and requires CPS plus host event-loop orchestration for spawn, task groups, internal futures, and fan-out ([`concurrency.md:241-285`](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md#L241-L285), [`concurrency.md:356-365`](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md#L356-L365)).

Other early breakpoints are an async callback that outlives its caller, `race` or `select`, cancellation, detached work, and a future returned through a data structure. All require an object or handle representing work independently of the currently parked stack.

## 3. The two host contracts

### 3.1 Driver A: Promise imports through jco/JSPI

The first driver contract should be deliberately narrow:

1.  A host implementation of an async import may return a Promise or an eager value.
2.  The WIT function is marked `async`; the guest uses the ordinary flat core signature and synchronous canonical lowering.
3.  jco wraps the lowered import with `WebAssembly.Suspending`.
4.  Every host-reachable async export is async-typed and is exposed through `WebAssembly.promising`.
5.  jcona checks both APIs before instantiation and emits a capability error.
6.  Standard WASI remains Preview 2 for this slice; genuinely async operations use small custom Promise-backed interfaces.

jco already performs the wrappers based on p3 async types ([`p3-frontier.solmax.md:244-265`](/doc/research/p3-frontier.solmax.md#L244-L265)). Generated async output has no fallback: without JSPI it fails on missing `promising` or `Suspending` ([`p3-frontier.solmax.md:291-324`](/doc/research/p3-frontier.solmax.md#L291-L324)). The load-time requirement must therefore be a declared target capability, not an optimization silently selected at runtime.

This driver is attractive because it validates the language boundary with almost no async ABI machinery: no task frame, callback export, result buffer, waitable set, subtask handle, or `task.return` ([`p3-frontier.solmax.md:342-367`](/doc/research/p3-frontier.solmax.md#L342-L367)).

It has real costs:

- the complete Wasm activation remains retained;
- one direct call cannot create two in-flight operations;
- a sync-lifted component callee retains its exclusion lock across suspension;
- internal scheduling and cancellation are unavailable;
- the language implementation is only available on JSPI engines.

Accordingly, this driver must not inherit the concurrency design's memory claim for stackless tasks. It is a bootstrap profile for language and integration work, not proof that thousands of suspended Zena tasks have frame-only cost.

### 3.2 Driver B: native P3 callbacks and waitables

The second driver lowers the same await sites to the standard stackless ABI:

- async-lowered imports return packed `STARTING`, `STARTED`, or `RETURNED` status and may produce a subtask handle;
- the entry export returns `WAIT`, `YIELD`, or `EXIT`;
- a companion callback receives the completed event;
- waitables are joined to a waitable set;
- result storage remains live until completion;
- `task.return` delivers the export result;
- handles and buffers are released on success, failure, and cancellation.

The core names and signatures are known, and a hand-written Zena guest has already completed a genuinely delayed import in Node and Chrome ([`p3-frontier.solmax.md:369-410`](/doc/research/p3-frontier.solmax.md#L369-L410)). Its compact fixture nevertheless needs async-lower, waitable, subtask, task-return, entry, and callback declarations ([`.test-agent/w7/stackless-await.zena:1-59`](/.test-agent/w7/stackless-await.zena#L1-L59)).

Production lowering adds what the one-task fixture omits: per-call state, overlapping-call safety, result-lifetime ownership, cancellation cleanup, future/stream element lowering, backpressure, and reentrancy rules ([`p3-frontier.solmax.md:410-425`](/doc/research/p3-frontier.solmax.md#L410-L425)). That is why this driver should be second, and why it is the real consumer of the generalized G1 split pass.

### 3.3 Driver comparison

| Concern                 | JSPI-linear                        | Native P3 callback                           |
|-------------------------|------------------------------------|----------------------------------------------|
| Continuation storage    | engine-retained Wasm stack         | Zena-generated frame                         |
| Core call at await      | ordinary synchronous call          | async-lower + status handling                |
| Resume                  | JS engine resumes call             | host invokes callback export                 |
| Serial direct awaits    | yes                                | yes                                          |
| Reified futures/fan-out | no                                 | possible with task runtime                   |
| Cancellation cleanup    | not defined by the simple path     | must be generated                            |
| Host reach              | Node/browser with JSPI             | Component Model runtimes, including wasmtime |
| Primary value           | fastest semantic/integration slice | portability and stackless correctness        |

wasmtime is therefore essential, but not first. It independently tests the standard ABI and forces the hard lifecycle semantics; requiring it before the source contract is exercised would front-load the largest driver ([`p3-frontier.solmax.md:586-593`](/doc/research/p3-frontier.solmax.md#L586-L593)).

## 4. Minimal language and typing surface

### 4.1 Surface rules

The minimal coherent surface is:

- `async` is part of a function or method's type/effect.
- Calling an async function has static type `Future<T>`.
- The declared return annotation is `Future<T>`, because Zena annotations name the call expression's type; the body checks `return e` against `T`.
- `await e` requires `e: Future<T>` and has type `T`.
- `await` is legal only in the immediately enclosing `async` body; a nested non-async closure cannot suspend its parent.
- There is no implicit await and no implicit blocking.
- Calling an async function without consuming its future is an error in the first profile, not fire-and-forget.

The full-wrapper annotation follows the generator decision that a declared return type must honestly describe what a call produces ([`generators.md:83-103`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L83-L103)). Explicit suspension follows the concurrency design's “one rule” that `await` marks the suspension point ([`concurrency.md:459-498`](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md#L459-L498)).

For the JSPI-linear profile, `Future<T>` may initially be a compiler-known, non-reifiable type. The checker accepts it only as the immediate operand of `await`; it rejects storage, argument passing, return from a non-async wrapper, unioning, and generic abstraction over the value. This is a conspicuous restriction, but it is preferable to exposing a nominal `Future` object that does not exist at runtime.

The alternative is to define a real task handle immediately. That is a valid choice, but it commits slice 1 to a scheduler/registry and removes most of the reason to choose direct JSPI first.

### 4.2 Failure, `try`, and `finally`

The language-level goal should be driver-independent:

- fulfillment resumes `await` with `T`;
- failure resumes by throwing a Zena error;
- normal return and throw run every lexically pending `finally` exactly once;
- cancellation, once added, has an explicit policy for cleanup and failure during cleanup.

The current exception implementation catches Zena's own Wasm tag and stores its payload in a mutable global. JS exception interop is explicitly unresolved ([`exceptions.md:70-136`](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md#L70-L136), [`exceptions.md:146-149`](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md#L146-L149)). Therefore “a rejected Promise becomes a catchable Zena exception” is a required experiment and adapter design, not an assumption.

For slice 1, reject `await` anywhere inside `try`, `catch`, or `finally` until both fulfillment and normalized rejection are tested and represented in the driver-neutral IR. This matches the generator v1 restriction: suspension in an exception region is entangled with abandonment/cancellation and Wasm EH region re-entry ([`generators.md:379-409`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L379-L409)).

Later support should store the active cleanup/handler state in a CPS frame. JSPI's native stack may appear to make `finally` work automatically, but shipping JSPI-only behavior would leave the P3 driver with a different language. In particular, an abandoned or cancelled Promise does not by itself explain when a suspended `finally` runs.

### 4.3 GC references across await

The direct path has unusually strong evidence: a live WasmGC array survived a real JSPI suspension in two engines. That proves JSPI can preserve typed GC locals for this shape ([`p3-frontier.solmax.md:547-561`](/doc/research/p3-frontier.solmax.md#L547-L561)).

It does **not** prove the stackless frame path. The P3 driver must separately test nullable frame fields, spill/reload, loop-carried refs, subtype casts, exceptions, and collection while suspended. Generator G1's frame design already identifies nullable late-initialized reference fields and resume-side assertions ([`generators.md:289-323`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L289-L323)).

## 5. Compiler seam: resolution, monomorphization, and DCE

Async lowering must attach to **resolved calls**, not token spelling. This repository has already found two DCE failures where resolved operator or intrinsic-family calls survived in code but their chosen implementations were culled. The resulting Wasm was invalid or called a sentinel function index; the finding identifies DCE plus overload/operator resolution as the compiler's most fragile interaction ([`work-outline.glm53max.md:204-215`](/doc/research/work-outline.glm53max.md#L204-L215), [`work-outline.glm53max.md:290-294`](/doc/research/work-outline.glm53max.md#L290-L294)).

Async introduces the same failure class in a more distributed form:

- an await site resolves to one overload or generic specialization;
- that edge roots an async import, continuation, wrapper, and perhaps WIT item;
- DCE removes dead alternatives;
- component emission derives the surviving world and async boundary.

The required pipeline contract is:

1.  Resolve overloads and instantiate generics.
2.  Attach `maySuspend`, result type, and concrete callee identity to each call.
3.  Build the reachable call graph from those resolved edges.
4.  DCE functions, imports, and specializations together.
5.  Compute component imports/exports and async effects from the surviving graph.
6.  Select JSPI-linear or P3 lowering for each surviving async body.
7.  Verify that every await target and generated callback/wrapper is live.

This also follows the component design's recommendation that a DCE'd WIT import should not remain a host requirement ([`component-model.md:152-164`](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md#L152-L164)). It matters immediately because componentization currently relies on `--dce` to remove ambient host imports ([`zena-targets.glm53max.md:199-213`](/doc/research/zena-targets.glm53max.md#L199-L213)).

For v1, explicit `async` avoids effect inference, but transitive validation is still required: a synchronous function cannot hide a suspending call. Later effect polymorphism may make sync/async an instantiation axis; the generator design already anticipates specialization as the mechanism and says splitting generic suspension bodies should happen per instantiation ([`generators.md:575-607`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L575-L607), [`generators.md:683-687`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md#L683-L687)).

Minimum regression matrix under `--dce`:

- live async overload retained while a sync sibling is culled;
- dead async import does not add JSPI or an emitted WIT requirement;
- transitive awaited import marks a live exported entry async;
- generic async specialization retains exactly its resolved import;
- a live await never points at a sentinel/missing function index;
- generated promising/suspending boundary glue survives iff its boundary does;
- the same source lowered to P3 retains entry, callback, task-return, and cleanup.

## 6. Upstream sequencing

### Slice A — freeze the contract

- Decide whether `Future<T>` is non-reifiable in v1.
- Specify explicit `async`/`await`, annotation shape, and no implicit blocking.
- Specify Promise fulfillment and rejection mapping.
- State the protected-region and cancellation restrictions as diagnostics.
- Name the capability profile, for example `async-linear-jspi`.

### Slice B — front end and driver-neutral IR

- Parse `async` functions/methods and `await` expressions.
- Add `Future<T>` checking and immediate-consumption restrictions.
- Add a resolved suspension descriptor with success/failure continuations.
- Verify forbidden contexts before codegen.
- Add DCE and specialization tests before host integration.

### Slice C — JSPI integration driver

- Emit ordinary core calls for eligible await sites.
- Emit async WIT effects with synchronous canonical lift/lower.
- Add custom Promise-backed host imports.
- Add a pre-instantiation JSPI capability check in jcona.
- Prove serial awaits, branches, loops, transitive helpers, live GC refs, and normalized failure in Node 26 and supported Chrome.

Keep ordinary WASI on Preview 2. The Preview 3 browser shim is currently a mostly stubbed skeleton with only random operational ([`p3-frontier.solmax.md:143-177`](/doc/research/p3-frontier.solmax.md#L143-L177)). “JSPI first async driver” does not reverse the Component Model plan's “p2 HTTP before p3 HTTP” sequencing ([`component-model.md:376-408`](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md#L376-L408), [`component-model.md:637-657`](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md#L637-L657)).

### Slice D — native P3 driver

- Generalize G1 suspension descriptors to await resume values and failures.
- Synthesize per-invocation frames and callback dispatch.
- Generate async-lower, status handling, waitable sets, and `task.return`.
- Define cleanup for result buffers, subtasks, waitables, resources, and traps.
- Run the same semantic suite through jco and wasmtime-p3.
- Add overlapping calls and reentrancy tests.

### Slice E — general futures and structured concurrency

- Reify task/future handles.
- Permit start-before-wait, storage, combinators, `spawn`, `all`, and `race`.
- Define cancellation and `finally` unwinding.
- Decide whether the JS host uses a CPS event-loop driver, native P3 machinery, or both behind the same task interface.

Generator fusion G2 is not on this critical path. The plan explicitly permits async after G1 while fusion proceeds independently ([`implementation-plan.md:57-85`](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md#L57-L85)).

## 7. Risk register

| Risk                           | Consequence                                 | Control                                                            |
|--------------------------------|---------------------------------------------|--------------------------------------------------------------------|
| JSPI is a hard dependency      | immediate instantiation/runtime failure     | capability gate; target metadata; no fallback claim                |
| Chrome/Node bias               | Firefox and Safari users cannot run slice 1 | publish matrix; retain non-JS/P3 roadmap                           |
| Firefox target churn           | claimed support may precede release reality | runtime probe in CI; do not infer from proposal status             |
| Safari has no JSPI             | no universal browser target                 | require explicit browser support policy                            |
| jco async codegen churn        | generated glue changes underneath Zena      | pin jco; keep component fixtures and behavior tests                |
| preview3-shim browser gaps     | async language gets coupled to stubs        | use p2 plus custom Promise interfaces                              |
| retained-stack memory          | violates stackless scale expectations       | label profile; benchmark; make P3 the conformance driver           |
| component exclusion lock       | calls serialize or surprise reentrancy      | specify one-active-call v1; test overlapping exports               |
| Promise rejection mismatch     | failures bypass Zena `catch`                | normalize at boundary; dedicated EH tests                          |
| `finally`/cancellation skew    | cleanup differs by driver                   | reject protected suspension first; define shared unwind model      |
| DCE loses resolved async edges | invalid Wasm or incomplete world            | resolved-edge rooting and post-DCE verifier                        |
| generic effect skew            | wrong specialization or wrapper             | lower after monomorphization; include effect in identity if needed |
| GC proof is path-specific      | callback frames mishandle refs              | separate stackless GC/liveness suite                               |
| direct path becomes permanent  | no fan-out, tasks, or portability           | publish exit criteria and implement P3 second                      |
| WIT async is over-propagated   | needless Promise API and locking            | derive effects from surviving reachable boundaries                 |

The current engine baseline is concrete: Chrome shipped JSPI in 137, Node 26 works unflagged, Firefox 152 did not expose it with 153 listed as the target, and Safari has no recorded support ([`p3-frontier.solmax.md:326-340`](/doc/research/p3-frontier.solmax.md#L326-L340)). These are release-support facts, not permanent language constraints.

## 8. Decisions requested from upstream maintainers

### D1 — Is `Future<T>` reifiable in async v1?

**Recommendation:** no. Permit only immediate, non-escaping awaitables in the JSPI slice, with explicit diagnostics. This is the decision that preserves the small driver. If the answer is yes, begin with a task handle and scheduler instead of claiming direct JSPI is sufficient.

### D2 — Is retained-stack JSPI acceptable under “stackless-only”?

**Recommendation:** yes, only as a named host profile with no stackless memory claim and with the P3 driver committed as the conformance destination. If “stackless-only” is an implementation invariant rather than an architecture goal, reject this proposal and build CPS plus a JS event-loop driver first.

### D3 — What is the annotation spelling?

**Recommendation:** `async f(): Future<T>` while `return` checks against `T`. It matches the generator annotation rule and keeps call types honest. If Zena prefers `async f(): T`, revise the broader annotation principle explicitly; do not let a backend convenience choose it accidentally.

### D4 — How are async imports declared before bindgen exists?

**Recommendation:** make WIT the contract where possible. For narrow bootstrap fixtures, add an explicit `@asyncExternal`-style marker that resolves to the same internal async-import fact; never infer Promise behavior from module or function names. Retire the marker when WIT bindgen owns declarations.

### D5 — What does rejected Promise mean?

**Recommendation:** convert it to a catchable Zena `Error` at the driver boundary, preserving a message and host cause where representable. Gate async `try` support on this behavior. Fulfill-only imports may be useful experiments, but are not a sufficient language contract.

### D6 — When may suspension enter exception regions?

**Recommendation:** reject it in slice 1, then lift the restriction only with a shared cleanup-state design and tests on both drivers. Decide cancellation, await-in-finally, and failure-during-cleanup together rather than inheriting whatever a JS Promise happens to do.

### D7 — Where is async effect propagation computed?

**Recommendation:** on the resolved, monomorphized call graph, before DCE roots are finalized; recompute emitted boundary effects from surviving code. Add a post-DCE verifier. Do not use an AST scan or a separate string-keyed registry.

### D8 — What is the supported JSPI platform floor?

**Recommendation:** initially Node 26+ and Chrome 137+, feature-probed rather than user-agent-sniffed. Treat Firefox as supported only when the tested release exposes all required APIs; list Safari as unsupported. A native P3 build is the non-JSPI portability path, not a transparent fallback for one artifact.

### D9 — What proves the second driver complete?

**Recommendation:** the same source-level suite passes under jco/JSPI and wasmtime-p3; live GC references survive explicit frame spill/reload; two calls overlap safely; result buffers and waitables are reclaimed; rejection and `finally` agree; and no task state is stored in module globals.

## 9. Bottom line

JSPI gives Zena a rare opportunity to separate two risks that the current roadmap bundles together:

- **language risk** — is `async`/`await` pleasant, typed, and compatible with Zena's GC and component boundaries?;
- **scheduler/ABI risk** — can Zena correctly own continuations, task lifetime, cancellation, waitables, and P3 callbacks?

Use JSPI to retire the first risk quickly. Do not mistake the engine-retained stack for the planned G1/CPS continuation. Preserve a driver-neutral await seam, make non-reifiable futures and protected-region restrictions loud, and then use the P3 callback driver to fulfill Zena's stackless architecture.

That is what “JSPI first” should mean: **first evidence-bearing host driver, not final async representation and not the language's portability boundary.**

## References

- [`docs/design/generators.md`](file:///home/rektide/src/zena-jco-fork/docs/design/generators.md) — suspension descriptors, implemented G1 split pass, liveness, frames, and the generator-to-async boundary.
- [`docs/design/concurrency.md`](file:///home/rektide/src/zena-jco-fork/docs/design/concurrency.md) — stackless goal, Future surface, JSPI linear path, CPS driver, and structured concurrency roadmap.
- [`docs/design/implementation-plan.md`](file:///home/rektide/src/zena-jco-fork/docs/design/implementation-plan.md) — Track G sequencing and JSPI-before-P3 host-driver decision.
- [`docs/design/component-model.md`](file:///home/rektide/src/zena-jco-fork/docs/design/component-model.md) — p2-before-p3 sequencing, WIT/component stages, and DCE-derived worlds.
- [`docs/design/exceptions.md`](file:///home/rektide/src/zena-jco-fork/docs/design/exceptions.md) — current Wasm EH lowering and unresolved JS exception interop.
- [`doc/research/p3-frontier.solmax.md`](/doc/research/p3-frontier.solmax.md) — verified Zena WasmGC + JSPI experiment, engine matrix, hard dependency, and hand-written P3 callback proof.
- [`doc/research/zena-targets.glm53max.md`](/doc/research/zena-targets.glm53max.md) — current core emission, componentization, and DCE constraints.
- [`doc/research/work-outline.glm53max.md`](/doc/research/work-outline.glm53max.md) — jcona posture and the DCE/resolved-call fragility findings log.
- [JSPI proposal overview](https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md) — `WebAssembly.Suspending` and `WebAssembly.promising` semantics.
- [Component Model concurrency explainer](https://github.com/WebAssembly/component-model/blob/c7176a512c0bbe4654849f4ba221c1a71c7cf514/design/mvp/Concurrency.md) — async effects, sync and async canonical ABIs, tasks, callbacks, and waitables.
