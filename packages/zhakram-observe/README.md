# packages/zhakram-observe

Host-side visibility for jco components, in two deliberately separate tiers:

1. **`observe(imports, { sink })`** is pure JavaScript. It wraps an `-I`
   instantiation import object and emits bounded, WASI-shaped dispatch events.
2. **`_util.resourceTables.snapshot()`** is an opt-in post-transpile prototype
   for state that JavaScript import wrapping cannot see. It is guarded against
   unknown generated-code shapes and currently pinned to jco 1.33.0.

## Tier 1: imports and resources

```js
import * as io from '@bytecodealliance/preview2-shim/io';
import { observationSummary, observe } from 'zhakram-observe/observe';

const sink = {
  emit(event) {
    if (event.type !== 'call-start') console.log(event);
  },
};
const imports = observe({
  'wasi:io/streams': io.streams,
  // …the rest of this component's imports
}, { sink });

const instance = await component.instantiate(undefined, imports);
instance.run();
console.log(observationSummary(imports));
```

Every call emits `call-start` followed by `call-end` or `call-error`. Events
carry the interface, canonical kebab-case function, bounded argument/result
summaries, and completion duration in microseconds. `bigint` is rendered as a
decimal string; typed arrays report class, byte length, and at most 16 preview
bytes. Long strings and arrays are similarly bounded.

Resource constructors remain untouched so generated `instanceof` checks keep
working. Returned resource **instances** are proxied. Their calls are named
like the canonical ABI (`[method]output-stream.blocking-write-and-flush`), and
the first sighting emits `resource-acquire`. Explicit `drop`, `dispose`, or
`Symbol.dispose` calls—and flat imports already named `[resource-drop]…`—emit
`resource-drop`.

`observationSummary(imports)` is a copy, grouped per interface:

```json
{
  "totals": { "calls": 31, "inFlight": 0, "resourceCalls": 2, "dropEvents": 0 },
  "interfaces": [
    {
      "interface": "wasi:io/streams",
      "calls": 2,
      "inFlight": 0,
      "resourceCalls": 2,
      "dropEvents": 0
    }
  ]
}
```

### Shared sink with zhakram-otel

`EventSink<T> = { emit(event: T): void }` is the common sink shape. Existing
`zhakram-otel` `{ onSpan(ended) {} }` sinks remain valid; `createTracing` also
accepts `EventSink<EndedSpan>`. One `emit` sink can therefore receive guest
spans and host dispatch events in their actual interleaving. See
[`examples/observe-zena`](/examples/observe-zena/README.md).

### Tier 1 boundary

This observes calls that cross the supplied JavaScript import object. A
canonical resource drop implemented entirely inside generated glue does not
necessarily call a JS `drop` method, so Tier 1 does not claim to see every
internal handle transition. That boundary is why Tier 2 exists.

## Tier 2: guarded generated-table snapshots

The zhakram CLI wires the transform after transpilation:

```sh
zhakram transpile component.wasm -o out --expose-resources -- -I async
```

The library entry is also exported as
`exposeResourceTables(file)` / `transformResourceExposure(source)` from
`zhakram-observe/expose`. On the known shape it adds:

```js
componentModule._util.resourceTables.snapshot()
```

The returned, deeply frozen copy has this shape:

```text
{
  shape: "zhakram-observe.resource-tables.v1",
  generatedFor: "@bytecodealliance/jco@1.33.0",
  instances: [{
    id,
    resourceScopeId,
    resourceScopeTasks: { size, entries },
    asyncTasksByComponentIdx: { size, entries },
    asyncState: { size, entries },
    instanceFlags: { size, entries },
    handleTables: [{
      tableIndex, componentIdx, freeHead, createdReps,
      entries: [{ handle, state: "live", scope, rep, own } | { handle, state: "free", next }]
    }],
    captureTables: { captureTableN: { size, entries } }
  }]
}
```

No `Map`, handle slab, `WebAssembly.Global`, or host resource object escapes by
reference. In instantiation mode, each `instantiate()` has its own tables; the
module `_util` prototype therefore keeps snapshot closures in an instance
registry. This is adequate to prove the view, but an upstream API should put
the inspector on each returned instance to avoid a module-level registry and
its lifetime ambiguity.

### Version guard and failure behavior

This is intentionally a codemod, not a claim that generated JS is a stable
API. Before editing, it requires exactly one declaration for
`RESOURCE_SCOPE_ID`, `RESOURCE_SCOPE_TASKS`, `ASYNC_TASKS_BY_COMPONENT_IDX`,
`ASYNC_STATE`, `INSTANCE_FLAGS`, and `HANDLE_TABLES`, plus exactly one `_util`
export and the `"use components"` directive. If any shape is missing or
ambiguous, it prints a jco-1.33-specific warning, leaves the file byte-for-byte
unchanged, and reports `skipped`. Re-running is idempotent.

## Upstream js-component-bindgen ask

The prototype scopes a jco PR rather than making the codemod permanent. Against
archive revision `c03204df1c814253c5e88ae54ef6dbd80e961d0d`:

1. Add an opt-in bindgen/transpile option for a read-only runtime inspector.
   [`transpile_bindgen.rs:679-746`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/transpile_bindgen.rs#L679-L746)
   is the current `_util` writer and extension point.
2. Build the inspector from generated intrinsic state. Resource-scope names
   come from
   [`intrinsics/resource.rs:94-110`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/intrinsics/resource.rs#L94-L110),
   component async/flag maps from
   [`intrinsics/component.rs:89-126`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/intrinsics/component.rs#L89-L126),
   and current-task maps from
   [`intrinsics/p3/async_task.rs:306-363`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/intrinsics/p3/async_task.rs#L306-L363).
3. Register each actual `handleTableN` and imported-resource `captureTableN`
   while they are emitted at
   [`transpile_bindgen.rs:1427-1469`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/transpile_bindgen.rs#L1427-L1469).
   Return decoded immutable snapshots, never those mutable arrays/maps.
4. In `-I` mode, return a per-instance `_util`/inspector alongside component
   exports rather than collecting instances in module `_util`. The relevant
   return-object renderer is
   [`esm_bindgen.rs:202-287`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/esm_bindgen.rs#L202-L287);
   the surrounding instantiation emission is
   [`transpile_bindgen.rs:514-677`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/transpile_bindgen.rs#L514-L677).
5. Describe the opt-in inspector in generated declarations; instantiation-mode
   signatures are written at
   [`ts_bindgen.rs:425-520`](https://github.com/bytecodealliance/jco/blob/c03204df1c814253c5e88ae54ef6dbd80e961d0d/crates/js-component-bindgen/src/ts_bindgen.rs#L425-L520).

The proposed API is observational only. Mutation/forced-drop semantics need a
separate design because they can violate canonical-ABI ownership and borrow
invariants.
