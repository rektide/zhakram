# resource-tables

A standalone demo of WASI 0.2 **resource-table introspection**: a zena guest
that acquires, holds, and drops host resources across three exports, and a
host that snapshots the guest's handle table between calls to watch it
breathe. No otel anywhere — this is pure resource-table observation.

```text
== initial ==
  live handles: 0
== step1 ==
step1: acquired stream A; writing through it
  + handle 1 <OutputStream> rep=1 own=true
  live handles: 1
== step2 ==
step2: acquired stream B; A can still write
  + handle 2 <OutputStream> rep=2 own=true
  live handles: 2
== step3 ==
step3: dropped stream A; B is unaffected
  - handle 1 rep=1 now free
  live handles: 1
== final table ==
table[0] (component 0): (empty)
table[1] (component 0): 1=free, 2=live(rep 2, own)
narrative: handle 1 acquired (step1) -> held alongside handle 2 (step2, guest
wrote via 1) -> dropped (step3); handle 2 survived and served the final write.
RESOURCE-TABLES-NODE-OK: live=1 dropped=1 shape=zhakram-observe.resource-tables.v1 jco=@bytecodealliance/jco@1.33.0
```

## What a resource table is

Every component instance owns **handle tables** — one per resource type
(plus per-scope tables in async settings). A table maps a small `i32`
**handle** (the index the guest ever sees) to:

- a **rep** — the host-side identity: an index into the shim's own object
  store, pointing at the live host object (here, an `OutputStream`);
- an **own/borrow flag** — owned handles must be explicitly
  `[resource-drop]`ped; borrows are only valid for the duration of the call
  that passed them in;
- a **scope** — which async task/scope the handle belongs to (0 on this
  sync demo).

Internally each slot is two table cells: `[scope, encodedRep]`, where the
top bit of `encodedRep` marks ownership and the top bit of `scope` marks
free slots (freed entries chain into a free-list via `next`). The
`wasi:io/streams` methods the guest calls take the *handle*: `get-stdout`
returns a fresh handle into the guest's `output-stream` table, and
`[method]output-stream.blocking-write-and-flush` looks the host object back
up by handle. Dropping a handle frees the slot for reuse but (per this
shim) does not necessarily destroy the host object if another handle still
refers to it — see the browser quirk below.

State that outlives a single call must live in the guest. This demo keeps
its handles in module-level zena globals (`var heldA: i32 = 0;`) so three
separate exports act on the same table entries between host calls.

## WASI 0.2.x resource inventory

Every WASI 0.2 interface that declares a resource — i.e. everything that
can appear in a handle table. The vendored tree this example builds against
lives in [`wit/deps.wit`](wit/deps.wit) (WASI 0.2.12; copied verbatim from
`examples/interop-jshost/wasi-wit` with the demo world appended).

| Interface | Resources | Touched by our examples today |
| --- | --- | --- |
| `wasi:io/error@0.2.12` | `error` | imported for type completeness; never acquired |
| `wasi:io/poll@0.2.12` | `pollable` | not yet (`subscribe()` would mint one) |
| `wasi:io/streams@0.2.12` | `input-stream` | not yet |
| | `output-stream` | **yes** — `observe-zena`, `resource-tables`, `interop-jshost` (p2-hello) via `get-stdout` |
| `wasi:cli/terminal-input@0.2.12` | `terminal-input` | not yet |
| `wasi:cli/terminal-output@0.2.12` | `terminal-output` | not yet |
| `wasi:filesystem/types@0.2.12` | `descriptor` | not yet |
| | `directory-entry-stream` | not yet |
| `wasi:sockets/network@0.2.12` | `network` | not yet |
| `wasi:sockets/udp@0.2.12` | `udp-socket`, `incoming-datagram-stream`, `outgoing-datagram-stream` | not yet |
| `wasi:sockets/tcp@0.2.12` | `tcp-socket` | not yet |
| `wasi:sockets/ip-name-lookup@0.2.12` | `resolve-address-stream` | not yet |
| `wasi:http@0.2.x` types | `request-options`, `future-incoming-response`, `incoming-response`, `incoming-body`, `outgoing-request`, `outgoing-response`, `outgoing-body`, `future-trailers` | not vendored in this tree; not yet |

Note the asymmetry the table makes visible: `output-stream` is the only
resource any example has ever *held*, which is exactly why the step-by-step
acquire/hold/drop story fits on stdout alone.

## How `_util.resourceTables.snapshot()` works

`jco transpile` lowers a component to JS with a handle-table machinery very
like the one described above: `HANDLE_TABLES`, `RESOURCE_SCOPE_ID`,
`INSTANCE_FLAGS`, and per-resource `captureTableN` maps (rep → live host
object). These are module-internal — until the guarded codemod from
[`packages/zhakram-observe`](/packages/zhakram-observe/README.md) rewrites the
generated entry:

```sh
zhakram transpile build/resource-tour.component.wasm \
  -o build/resource-tour-out --expose-resources -- -I async
```

- `--expose-resources` injects `_util.resourceTables.snapshot()` into the
  generated `resource-tour.js`. The snapshot deep-freezes a summary of:
  `resourceScopeId`, `resourceScopeTasks`, `asyncTasksByComponentIdx`,
  `asyncState`, `instanceFlags`, `handleTables` (every slot decoded to
  `live`/`free` with `scope`, `rep`, `own`), and `captureTables` (rep →
  summarized host object — the demo uses it to print the per-handle class,
  e.g. `<OutputStream>`).
- The transform is **shape-guarded**: it only fires when the generated file
  matches the pinned `@bytecodealliance/jco@1.33.0` output (one exact match
  for each expected declaration, plus the `"use components"` header).
  Anything else is returned byte-for-byte unchanged with a warning naming
  the mismatched declarations — the codemod corrupts nothing it does not
  recognize. This repo pins jco 1.33.0; a jco upgrade that moves these
  declarations will flip the demo's transpile step to `skipped` and the
  host will fail loudly at `component._util` — that is the intended
  tripwire.
- Everything is read-only: snapshots are frozen, and the host here only
  reads them. The browser shim and Node shim each hand out the *same*
  underlying `stdoutStream` object for every `get-stdout` call, so reps 1
  and 2 in this demo point at one shared `OutputStream` — the table tracks
  the two handles independently, but the host object is shared.

## Run it

```sh
./examples/resource-tables/run.sh
```

The script: `zhakram build` (zena `--dce` → `wasm-tools component embed` →
`component new`), `zhakram transpile --expose-resources -- -I async`, the
Node host (`host.mjs` — the table diff above), then `zhakram serve ../..
--check examples/resource-tables/index.html` for the browser leg.

Browser output ends with the `#status` convention:

```text
STATUS: RESOURCE-TABLES-BROWSER-OK: live=1 dropped=1 quirk-noted tableInstances=1 — step3 post-drop write threw "closed" (browser shim closes shared stdout on dispose)
```

The browser quirk is part of the lesson, not a failure: the browser
preview2-shim's `consoleStream` closes the shared stdout object on
`[resource-drop]`, so the guest's step3 write through B throws
`{tag:"closed"}` there (Node has no such flag and writes fine — which is
why the Node leg prints B's line). The component-model table is truthful
on both legs: handle 1 free, handle 2 live. The full write-up of that shim
quirk lives in [`lib/zena/wasip2/stdout.zena`](/lib/zena/wasip2/stdout.zena),
whose "never drop stdout" rule this demo deliberately breaks to show both
sides of it.

## Files

- [`resource-tour.zena`](resource-tour.zena) — the guest: raw `@external`
  declarations for `get-stdout`, `blocking-write-and-flush`, and
  `[resource-drop]output-stream`, three step exports, handles in module
  globals.
- [`wit/deps.wit`](wit/deps.wit) — vendored WASI 0.2.12 tree plus the
  `zhakram:rtour/resource-tour@0.1.0` world (imports stdout + streams;
  exports `step1`/`step2`/`step3`).
- [`host.mjs`](host.mjs) — Node host: instantiate once, snapshot between
  calls, print added/removed handles and the live count, assert the final
  state.
- [`index.html`](index.html) — browser leg; drives the same three steps and
  reports via `#status`.
