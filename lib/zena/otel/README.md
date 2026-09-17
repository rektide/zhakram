# lib/zena/otel

Guest-side OpenTelemetry spans, hand-lowered against
`wasi:otel/tracing@0.2.0-rc.2` (WebAssembly/wasi-otel Phase 2 RC) — the
zena externals follow the shapes `wasm-tools component embed` validates for
the interface, so no bindings generator is involved.

## Use

```zena
import { cabiRealloc } from '../../lib/zena/cabi/cabi.zena';
import { startSpan, setSpanAttr, endSpan, withSpan } from '../../lib/zena/otel/otel.zena';

// required: the host lowers current-span-context results through this
export let cabi_realloc = (oldPtr: i32, oldSize: i32, align: i32,
  newSize: i32): i32 => cabiRealloc(oldPtr, oldSize, align, newSize);

export let run = (): void => {
  let span = startSpan('emoji-demo');
  setSpanAttr(span, 'example', 'otel-zena');
  // … work, possibly more startSpan/endSpan nesting …
  endSpan(span);
};
```

- `startSpan` asks the host for the current span context (wasi-otel's
  host-owns-propagation model) — nesting comes from the host's span stack,
  not guest bookkeeping. `endSpanError(span, msg)` ends with an error
  status; `withSpan(name, fn)` is start/run/end sugar.
- v1 limits (documented in
  [`otel.zena`](/lib/zena/otel/otel.zena)): LIFO span ends vs ancestors, ≤ 8
  attributes per span, empty events/links.
- Timing comes from [`wasip2/clocks`](/lib/zena/wasip2/README.md), id
  entropy from [`wasip2/random`](/lib/zena/wasip2/README.md) — the span-data
  record images are built on [`cabi`](/lib/zena/cabi/README.md).

End-to-end proof: [`examples/otel-zena`](/examples/otel-zena/README.md)
(nested spans observed by the JS host, Node + browser). Host side:
[`packages/zhakram-otel`](/packages/zhakram-otel/README.md). Vendored WIT with
the full ABI lowering table: [`examples/otel-zena/README.md`](/examples/otel-zena/README.md).
