# otel-zena

A zena component emitting **observable spans** through
[`wasi:otel/tracing@0.2.0-rc.2`](https://github.com/WebAssembly/wasi-otel) —
hand-lowered externals from [`lib/zena/otel`](/lib/zena/otel/otel.zena), a JS
host implementation in [`packages/zhakram-otel`](/packages/zhakram-otel/README.md),
both wired up with [`packages/zhakram`](/packages/zhakram/README.md) tooling.

The guest picks a random emoji inside nested spans; the host sink prints one
line per closed span as the guest's `on-end` calls fire (Node and browser):

```
    span draw-index dur=0µs
    span render-emoji dur=0µs index=6
  span pick-emoji dur=3000µs emoji=😀
😀                                      ← the guest's own stdout line
span emoji-demo dur=5000µs example=otel-zena
```

`draw-index` / `render-emoji` are children of `pick-emoji`, itself a child of
the root `emoji-demo` span — nesting comes from the host's current-span stack
via `current-span-context`, per wasi-otel's host-owns-propagation model.

## Interface decision: real wasi:otel, hand-lowered (option a)

The ticket allowed either (a) hand-written zena externals against
wasi-otel's tracing interface, or (b) a minimal custom `zhakram:otel` world
with wasi-otel as a migration target. **We shipped (a)** — no custom
telemetry interface exists in this repo. A probe component exercised every
tracing function shape end-to-end before the library was written; nothing
structural blocked, and two preconceptions turned out backwards:

- **"Resources as i32 handles" doesn't apply** — wasi:otel tracing has no
  resources at all. The proven wasi:io/streams method-external pattern was
  the wrong precedent; what actually ships is flat params + hand-built
  record images.
- **Indirect import results use a trailing return-area param, not a returned
  pointer.** `wasi:clocks/wall-clock.now` and `current-span-context` both
  lower as core `[i32] -> []` (wasm-tools rejects `[] -> [i32]`): the *guest*
  allocates the return area, the host writes the record into it — nested
  strings included, allocated through the guest's exported `cabi_realloc`.
  That inversion keeps ownership simple: guests free what hosts lower.

What each function lowers to (all verified against `wasm-tools component
embed/new` and the `jco transpile` lifter):

| WIT | Core | Guest-side cost |
| --- | --- | --- |
| `on-start(span-context)` | 9 flat i32 params | lower 2 strings, pass zeros |
| `on-end(span-data)` | `(i32)` → 168-byte record image | ~25 raw stores at canonical offsets |
| `current-span-context() -> span-context` | trailing retptr param | allocate 28B, lift 2 strings, free |

The 168-byte `span-data` layout is documented field-by-field in
[`lib/zena/otel/otel.zena`](/lib/zena/otel/otel.zena) (every offset
cross-checked against the generated lifter: flags u8 @16, is-remote u8 @17,
status variant disc @104 + payload @108, scope options @124/@136, and
list-element strides — key-value 16B, event 32B, link 36B).

The wasi-otel WIT is vendored into [`wit/deps.wit`](wit/deps.wit) with one
local fix: tracing's `use wasi:clocks/wall-clock@0.2.0` repointed at the
tree's `0.2.12` (the proposal pins 0.2.0; this repo's single-file WIT tree is
all-0.2.12). Metrics/logs interfaces are omitted — the library is
tracing-only.

## Host wiring: `-I async` imports object

Transpiled in jco's instantiation mode, every import comes from the host's
`instantiate(undefined, imports)` object — `'wasi:otel/tracing'` (unversioned
key, from `createTracing()`) alongside the preview2-shim namespaces the world
imports (`wasi:clocks/wall-clock`, `wasi:random/random`, `wasi:cli/stdout`,
`wasi:io/streams`, `wasi:io/error`). This is the same pattern as
[`interop-jshost/compose.mjs`](/examples/interop-jshost/compose.mjs) and
[`interop-matrix/run.mjs`](/examples/interop-matrix/run.mjs); the sink is
therefore chosen per-instantiation with no transpile-time coupling.
(`jco transpile --map 'wasi:otel/tracing=./….js'` is the static alternative
and would work — the module shape is identical — but -I keeps hosts in
control, per the repo's host-mediated-composition posture.)

## Run

```sh
./run.sh
```

Thin `zhakram` calls: `zhakram build` → `zhakram transpile -- -I async` →
`node host.mjs` (Node) → `pnpm -C packages/zhakram-otel build` →
`zhakram serve <repo-root> --check examples/otel-zena/index.html` (headless
Chrome; the page reports `OTEL-ZENA-BROWSER-OK` + the span lines).

- [`demo.zena`](demo.zena) — the guest: `startSpan`/`setSpanAttr`/`endSpan`
  around the draw/render work, plus the `cabi_realloc` export the host needs
  to lower `current-span-context` results.
- [`host.mjs`](host.mjs) — Node host: `createTracing()` sink + shim imports.
- [`index.html`](index.html) — browser twin: shim browser builds + the
  zhakram-otel dist via import map, spans collected into `#status`.

## v1 limits

Documented in the library header: spans expected to end before their own
ancestors (sibling order is free — each span owns private copies of its
identity strings); ≤8 attributes/span; empty events/links; a non-empty host
trace-state would leak its nested allocations (this host always returns
`[]`); span/trace ids come from `get-random-u64` with the sign bit cleared
(127-bit entropy — cosmetic vs OTel's 128). Timings are wall-clock
`datetime`s per the WIT, so sub-millisecond child spans can read `0µs` on
coarse clocks.
