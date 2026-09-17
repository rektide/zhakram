# packages/zhakram-otel

JS host side for `wasi:otel/tracing@0.2.0-rc.2` guests — the piece
[`lib/zena/otel`](/lib/zena/otel/otel.zena) zena components call into. jco's
transpiled glue does all canonical-ABI work (host functions receive plain JS
values, already lifted), so this package is deliberately small:

- **`createTracing({ sink })`** — the `'wasi:otel/tracing'` host object:
  a current-span stack (`on-start` pushes, `on-end` closes the matching
  span by id and emits, `current-span-context` returns the top or the
  all-zero no-context sentinel guests treat as "start a root span").
- **Sinks are pluggable.** The default `consoleSink()` logs one line per
  closed span (`formatSpanLine`: name, duration µs, status, attributes,
  depth indent). A sink receives the full `SpanData` + computed
  `depth`/`durationUs` — everything an OTLP exporter needs — so an OTLP sink
  can slot in without touching guests.
- **Sinks compose with host observation.** The original `{ onSpan(ended) }`
  shape remains supported. `createTracing` also accepts zhakram-observe's generic
  `{ emit(event) }` `EventSink`, so one sink can render guest spans and host
  dispatch/resource events in their real interleaving.
- **Runtime hosts**: Node imports `./src/index.ts` directly (node
  type-stripping); browsers import the tsdown bundle
  (`pnpm build` → `dist/tracing.mjs`) via an import-map entry — see
  [`examples/otel-zena/index.html`](/examples/otel-zena/index.html).

Wiring shape (instantiation mode, all imports from the host object):

```js
import { createTracing } from 'zhakram-otel';
const m = await import('./out/demo.js');
const inst = await m.instantiate(undefined, {
  'wasi:otel/tracing': createTracing(),
  'wasi:clocks/wall-clock': clocks.wallClock, // preview2-shim
  // …the world's other wasi imports
});
inst.run();
```

Verified output lives in
[`examples/otel-zena`](/examples/otel-zena/README.md) (Node + headless
Chrome).
